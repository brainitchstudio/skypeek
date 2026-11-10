// Downloads and decoded fields for forecast frames. Runs inside the worker, so it
// reports requests instead of touching the ledger, which lives on the main thread.

import { GribError, type GribErrorCode, type GribField } from './grib2';

export type FieldKey = { url: string; start: number; end: number; run: number; leadMin: number };
export type FetchRange = (key: FieldKey, signal: AbortSignal) => Promise<Uint8Array>;
export type RequestReport = 'charge' | 'bench';

export type ForecastRequest =
  | { id: number; type: 'tile'; key: FieldKey; z: number; x: number; y: number; size: number; canFetch: boolean }
  | { id: number; type: 'sample'; key: FieldKey; lat: number; lon: number; canFetch: boolean }
  | { id: number; type: 'prefetch'; key: FieldKey; canFetch: boolean }
  | { id: number; type: 'cancel' };
export type ForecastReply =
  | { id: number; data: ArrayBuffer }
  | { id: number; sample: number | null }
  | { id: number; error: string; code?: GribErrorCode }
  | { type: RequestReport };

const FIELDS_HELD = 12;
const BYTES_HELD = 84; // about a quarter MB each, so a looping timeline stays off the network
const DOWNLOADS_AT_ONCE = 2;
const DOWNLOAD_TIMEOUT_MS = 30_000;

type Entry = { waiters: number; controller: AbortController; promise: Promise<GribField>; field?: GribField };

const noNetwork = () => new Error('HRRR request budget or cooldown reached');

export function createFieldStore({ fetchRange: download, decode, max = FIELDS_HELD, bytesHeld = BYTES_HELD, concurrency = DOWNLOADS_AT_ONCE, blocked = () => false }: {
  fetchRange: FetchRange; decode: (b: Uint8Array) => GribField; max?: number; bytesHeld?: number; concurrency?: number; blocked?: () => boolean;
}) {
  const entries = new Map<string, Entry>();
  const bytes = new Map<string, Uint8Array>();
  const waiting: (() => void)[] = [];
  let active = 0;

  const release = () => {
    const next = waiting.shift();
    if (next) next(); else active--;
  };
  const prune = () => {
    let held = [...entries.values()].filter(e => e.field).length;
    for (const [id, e] of entries) {
      if (held <= max) return;
      if (e.field) { entries.delete(id); held--; }
    }
  };

  async function compressed(id: string, key: FieldKey, signal: AbortSignal) {
    const saved = bytes.get(id);
    if (saved) {
      bytes.delete(id); bytes.set(id, saved);
      return saved;
    }
    if (active < concurrency) active++;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      signal.throwIfAborted();
      if (blocked()) throw noNetwork();
      return await download(key, signal);
    } finally { release(); }
  }

  async function load(id: string, key: FieldKey, entry: Entry) {
    try {
      const message = await compressed(id, key, entry.controller.signal);
      const field = decode(message);
      if (field.refTime !== key.run || field.leadMin !== key.leadMin) throw new GribError('bad-data', 'Field is not the step that was requested');
      bytes.set(id, message);
      if (bytes.size > bytesHeld) bytes.delete(bytes.keys().next().value!);
      entry.field = field;
      entries.delete(id); entries.set(id, entry);
      prune();
      return field;
    } catch (e) {
      if (entries.get(id) === entry) entries.delete(id);
      throw e;
    }
  }

  return {
    get(key: FieldKey, signal: AbortSignal, canFetch = true): Promise<GribField> {
      const id = `${key.url}#${key.start}-${key.end}`;
      let entry = entries.get(id);
      if (entry?.field) {
        entries.delete(id); entries.set(id, entry);
        return Promise.resolve(entry.field);
      }
      if (!entry) {
        if (!canFetch && !bytes.has(id)) return Promise.reject(noNetwork());
        const fresh: Entry = { waiters: 0, controller: new AbortController(), promise: Promise.resolve(null as unknown as GribField) };
        fresh.promise = load(id, key, fresh);
        fresh.promise.catch(() => undefined); // every waiter may already have left
        entries.set(id, fresh);
        entry = fresh;
      }
      const shared = entry;
      shared.waiters++;
      return new Promise((resolve, reject) => {
        const leave = () => {
          reject(new DOMException('Aborted', 'AbortError'));
          if (--shared.waiters === 0 && !shared.field) {
            shared.controller.abort();
            if (entries.get(id) === shared) entries.delete(id);
          }
        };
        if (signal.aborted) { leave(); return; }
        signal.addEventListener('abort', leave, { once: true });
        shared.promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', leave));
      });
    },
    size: () => [...entries.values()].filter(e => e.field).length,
  };
}

/** One field's bytes. A server that ignores the range is refused unread: the whole file is 220 MB. */
export async function fetchRange(key: FieldKey, signal: AbortSignal, report: (kind: RequestReport) => void): Promise<Uint8Array> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new DOMException('Timed out', 'TimeoutError')), DOWNLOAD_TIMEOUT_MS);
  try {
    report('charge');
    const r = await fetch(key.url, { headers: { Range: `bytes=${key.start}-${key.end}` }, signal: AbortSignal.any([signal, timeout.signal]) });
    if (r.status === 429 || r.status >= 500) {
      report('bench');
      throw new Error(`HRRR field failed: ${r.status}`);
    }
    if (r.status !== 206) {
      await r.body?.cancel();
      throw new Error(`HRRR did not honor the byte range: ${r.status}`);
    }
    // S3 doesn't expose this header cross-origin, so it's only checked when visible.
    // Length here, then the message's own markers, run and step, confirm the rest.
    const range = r.headers.get('Content-Range');
    if (range && !range.startsWith(`bytes ${key.start}-${key.end}/`)) {
      await r.body?.cancel();
      throw new Error('HRRR returned the wrong byte range');
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length !== key.end - key.start + 1) throw new Error('HRRR returned the wrong byte range length');
    return bytes;
  } finally { clearTimeout(timer); }
}
