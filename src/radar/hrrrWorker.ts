// Fetches, decodes and paints forecast tiles away from the map's thread.

import { createFieldStore, fetchRange, type ForecastReply, type ForecastRequest, type RequestReport } from './fieldStore';
import { reflectivityLut } from './flat';
import { paintForecastTile, sampleField } from './forecastRender';
import { decodeGrib2, GribError, type GribField } from './grib2';

const COOLDOWN_MS = 60_000;

const scope = self as unknown as { postMessage(m: ForecastReply, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<ForecastRequest>) => void) | null };
let cooldownUntil = 0;
const report = (type: RequestReport) => {
  if (type === 'bench') cooldownUntil = Date.now() + COOLDOWN_MS;
  scope.postMessage({ type });
};
const store = createFieldStore({ fetchRange: (key, signal) => fetchRange(key, signal, report), decode: decodeGrib2, blocked: () => Date.now() < cooldownUntil });
const running = new Map<number, AbortController>();

const luts = new Map<string, Uint32Array>();
function lutFor(f: GribField) {
  const key = `${f.r}/${f.e}/${f.d}/${f.maxX}`;
  let lut = luts.get(key);
  if (!lut) { lut = reflectivityLut(f); luts.set(key, lut); }
  return lut;
}

async function tile(m: Extract<ForecastRequest, { type: 'tile' }>, signal: AbortSignal) {
  const field = await store.get(m.key, signal, m.canFetch);
  signal.throwIfAborted();
  const rgba = paintForecastTile(field, lutFor(field), m.z, m.x, m.y, m.size);
  const canvas = new OffscreenCanvas(m.size, m.size);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, m.size, m.size), 0, 0);
  const data = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  scope.postMessage({ id: m.id, data }, [data]);
}

async function sample(m: Extract<ForecastRequest, { type: 'sample' }>, signal: AbortSignal) {
  const field = await store.get(m.key, signal, m.canFetch);
  signal.throwIfAborted();
  scope.postMessage({ id: m.id, sample: sampleField(field, m.lat, m.lon) });
}

scope.onmessage = ({ data: m }) => {
  if (m.type === 'cancel') { running.get(m.id)?.abort(); running.delete(m.id); return; }
  const controller = new AbortController();
  running.set(m.id, controller);
  const work = m.type === 'tile' ? tile(m, controller.signal) : m.type === 'sample' ? sample(m, controller.signal) : store.get(m.key, controller.signal, m.canFetch);
  work.catch((e: unknown) => {
    if (controller.signal.aborted) return;
    scope.postMessage({ id: m.id, error: e instanceof Error ? e.message : 'Forecast tile failed', code: e instanceof GribError ? e.code : undefined });
  }).finally(() => running.delete(m.id));
};
