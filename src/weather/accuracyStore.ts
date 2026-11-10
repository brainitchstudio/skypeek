// Accuracy records live in IndexedDB: there are far too many for localStorage.
// Where IndexedDB isn't available the log stays in memory, and the app is unaffected.

import type { ForecastRow, TruthRow } from './accuracy';
import { mergeEvent, type SafeguardEvent } from './safeguards';

export type AccuracyMeta = { scope: string; trackingStart: number; truthThrough: number; lastCapture: string; noStation?: boolean };

export type AccuracyStore = {
  putForecasts(rows: ForecastRow[]): Promise<void>;
  putTruth(rows: TruthRow[]): Promise<void>;
  forecasts(scope: string, from: number): Promise<ForecastRow[]>;
  truth(scope: string, from: number): Promise<TruthRow[]>;
  meta(scope: string): Promise<AccuracyMeta | null>;
  setMeta(m: AccuracyMeta): Promise<void>;
  addSafeguards(events: SafeguardEvent[]): Promise<void>;
  safeguards(scope: string, from: number): Promise<SafeguardEvent[]>;
  prune(before: number): Promise<void>;
};

const RETAIN_MS = 400 * 86_400_000; // the spec's 13 months, plus a little

export function memoryStore(): AccuracyStore {
  const f = new Map<string, ForecastRow>(), t = new Map<string, TruthRow>(), m = new Map<string, AccuracyMeta>(), g = new Map<string, SafeguardEvent>();
  return {
    async putForecasts(rows) { rows.forEach(r => f.set(r.id, r)); },
    async putTruth(rows) { rows.forEach(r => t.set(r.id, r)); },
    async forecasts(scope, from) { return [...f.values()].filter(r => r.scope === scope && r.target >= from); },
    async truth(scope, from) { return [...t.values()].filter(r => r.scope === scope && r.target >= from); },
    async meta(scope) { return m.get(scope) ?? null; },
    async setMeta(v) { m.set(v.scope, v); },
    async addSafeguards(events) { events.forEach(e => g.set(e.id, mergeEvent(g.get(e.id), e))); },
    async safeguards(scope, from) { return [...g.values()].filter(e => e.scope === scope && e.lastAt >= from); },
    async prune(before) {
      for (const [k, r] of f) if (r.target < before) f.delete(k);
      for (const [k, r] of t) if (r.target < before) t.delete(k);
      for (const [k, e] of g) if (e.lastAt < before) g.delete(k);
    },
  };
}

const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = tx.onabort = () => rej(tx.error);
});

const value = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

function open(): Promise<IDBDatabase> {
  const r = indexedDB.open('sky-peek-accuracy', 1);
  r.onupgradeneeded = () => {
    for (const name of ['forecasts', 'truth']) {
      r.result.createObjectStore(name, { keyPath: 'id' }).createIndex('scope_target', ['scope', 'target']);
    }
    r.result.createObjectStore('meta', { keyPath: 'scope' });
  };
  return value(r);
}

// A separate database, so adding this log can't be blocked by an open tab holding the old one.
function openSafeguards(): Promise<IDBDatabase> {
  const r = indexedDB.open('sky-peek-safeguards', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('events', { keyPath: 'id' }).createIndex('scope', 'scope'); };
  return value(r);
}

function idbStore(): AccuracyStore {
  let db: Promise<IDBDatabase> | null = null;
  let guards: Promise<IDBDatabase> | null = null;
  const conn = () => (db ??= open());
  const put = async (name: string, rows: unknown[]) => {
    const tx = (await conn()).transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    rows.forEach(r => s.put(r));
    await done(tx);
  };
  const range = async <T,>(name: string, scope: string, from: number) => {
    const s = (await conn()).transaction(name).objectStore(name).index('scope_target');
    return value(s.getAll(IDBKeyRange.bound([scope, from], [scope, Infinity]))) as Promise<T[]>;
  };
  return {
    putForecasts: rows => put('forecasts', rows),
    putTruth: rows => put('truth', rows),
    forecasts: (scope, from) => range<ForecastRow>('forecasts', scope, from),
    truth: (scope, from) => range<TruthRow>('truth', scope, from),
    async meta(scope) { return (await value((await conn()).transaction('meta').objectStore('meta').get(scope))) ?? null; },
    setMeta: m => put('meta', [m]),
    async addSafeguards(events) {
      if (!events.length) return;
      const tx = (await (guards ??= openSafeguards())).transaction('events', 'readwrite');
      const s = tx.objectStore('events');
      for (const e of events) {
        const get = s.get(e.id);
        get.onsuccess = () => { s.put(mergeEvent(get.result, e)); };
      }
      await done(tx);
    },
    async safeguards(scope, from) {
      const s = (await (guards ??= openSafeguards())).transaction('events').objectStore('events').index('scope');
      const all = await value(s.getAll(scope)) as SafeguardEvent[];
      return all.filter(e => e.lastAt >= from);
    },
    async prune(before) {
      const tx = (await conn()).transaction(['forecasts', 'truth'], 'readwrite');
      for (const name of ['forecasts', 'truth']) {
        const cur = tx.objectStore(name).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return;
          if ((c.value as { target: number }).target < before) c.delete();
          c.continue();
        };
      }
      await done(tx);
      const gt = (await (guards ??= openSafeguards())).transaction('events', 'readwrite');
      const cursor = gt.objectStore('events').openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (c.value.lastAt < before) c.delete(); c.continue(); };
      await done(gt);
    },
  };
}

let store: AccuracyStore | null = null;

export function accuracyStore(): AccuracyStore {
  return (store ??= typeof indexedDB === 'undefined' ? memoryStore() : idbStore());
}

export const pruneCutoff = (now: number) => now - RETAIN_MS;
