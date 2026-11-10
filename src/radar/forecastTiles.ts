// Connects MapLibre's tile requests to the forecast worker, and applies the
// worker's request reports to the ledger, which only exists on the main thread.

import { bench, remaining, spend } from '@/api/budget';
import type { RadarFrame } from '@/api/weather';
import { recordDiagnostic } from '@/weather/diagnostics';
import type { FieldKey, ForecastReply, ForecastRequest } from './fieldStore';
import { forecastTileSize } from './forecastRender';
import { FORECAST_SCHEME } from './hrrr';

type Pending = { resolve: (data: ArrayBuffer | number | null) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const listeners = new Set<() => void>();

function handle(reply: ForecastReply) {
  if ('type' in reply) {
    if (reply.type === 'charge') spend('hrrr');
    else bench('hrrr', 60_000);
    return;
  }
  const waiting = pending.get(reply.id);
  if ('error' in reply && reply.code) recordDiagnostic('radar_forecast', `HRRR field refused (${reply.code}): ${reply.error}`);
  if (!waiting) return;
  pending.delete(reply.id);
  if ('error' in reply) waiting.reject(new Error(reply.error));
  else waiting.resolve('sample' in reply ? reply.sample : reply.data);
}

function failWorker() {
  worker = null;
  for (const p of pending.values()) p.reject(new Error('Forecast worker stopped'));
  pending.clear();
  listeners.forEach(l => l());
}

/** False if this browser can't run the worker. */
export function startForecastWorker(): boolean {
  if (worker) return true;
  try {
    worker = new Worker(new URL('./hrrrWorker.ts', import.meta.url), { type: 'module' });
  } catch { return false; }
  worker.onmessage = e => handle(e.data as ForecastReply);
  worker.onerror = failWorker;
  return true;
}

export function onForecastWorkerFailed(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function keyOf(u: URL): FieldKey {
  const q = u.searchParams;
  return { url: q.get('u')!, start: Number(q.get('s')), end: Number(q.get('e')), run: Number(q.get('r')), leadMin: Number(q.get('l')) };
}

const post = (m: ForecastRequest) => worker!.postMessage(m);

/** MapLibre protocol handler for `hrrr-forecast://` tiles. */
export function loadForecastTile(params: { url: string }, abort: AbortController): Promise<{ data: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    if (!startForecastWorker()) { reject(new Error('Forecast worker unavailable')); return; }
    const u = new URL(params.url);
    const [z, x, y] = u.pathname.slice(1).split('/').map(Number);
    const id = nextId++;
    pending.set(id, { resolve: data => resolve({ data: data as ArrayBuffer }), reject });
    abort.signal.addEventListener('abort', () => {
      if (!pending.delete(id)) return;
      post({ id, type: 'cancel' });
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
    post({ id, type: 'tile', key: keyOf(u), z, x, y, size: forecastTileSize(globalThis.devicePixelRatio ?? 1), canFetch: remaining('hrrr') >= 1 });
  });
}

/** The forecast frame's dBZ at a point, as stored in the file; null outside the grid. */
export function sampleForecast(frame: RadarFrame, lat: number, lon: number, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve, reject) => {
    if (!frame.url || !startForecastWorker()) { reject(new Error('Forecast worker unavailable')); return; }
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const id = nextId++;
    pending.set(id, { resolve: v => resolve(v as number | null), reject });
    const abort = () => {
      if (!pending.delete(id)) return;
      post({ id, type: 'cancel' });
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    post({ id, type: 'sample', key: keyOf(new URL(frame.url)), lat, lon, canFetch: remaining('hrrr') >= 1 });
  });
}

let prefetchedRun: number | undefined;
const prefetched = new Set<string>();

/** Asks the worker to have these frames' fields ready, once per run: after that
 * the map or the worker already holds them, and a failed one isn't worth repeating. */
export function prefetchForecast(frames: RadarFrame[]) {
  for (const frame of frames) {
    if (!frame.url?.startsWith(`${FORECAST_SCHEME}://`) || remaining('hrrr') < 1 || !startForecastWorker()) continue;
    if (frame.run !== prefetchedRun) { prefetchedRun = frame.run; prefetched.clear(); }
    if (prefetched.has(frame.url)) continue;
    prefetched.add(frame.url);
    post({ id: nextId++, type: 'prefetch', key: keyOf(new URL(frame.url)), canFetch: true });
  }
}
