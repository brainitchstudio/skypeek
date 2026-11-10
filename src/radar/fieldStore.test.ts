import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFieldStore, fetchRange, type FieldKey } from './fieldStore';
import { GribError, type GribField } from './grib2';

const key = (n: number): FieldKey => ({ url: 'https://example.test/f', start: n * 10, end: n * 10 + 9, run: 1000, leadMin: 15 });
const fieldFor = (over: Partial<GribField> = {}) => ({ refTime: 1000, leadMin: 15, ...over }) as GribField;
const never = new AbortController().signal;

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function store(max = 12) {
  const fetched: FieldKey[] = [];
  const decode = vi.fn(() => fieldFor());
  const s = createFieldStore({ fetchRange: async k => { fetched.push(k); return new Uint8Array(1); }, decode, max });
  return { s, decode, fetched };
}

describe('createFieldStore', () => {
  it('decodes once for two gets of one field', async () => {
    const { s, decode } = store();
    await Promise.all([s.get(key(1), never), s.get(key(1), never)]);
    await s.get(key(1), never);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('holds at most twelve fields by default', async () => {
    const s = createFieldStore({ fetchRange: async () => new Uint8Array(1), decode: () => fieldFor() });
    for (let i = 0; i < 13; i++) await s.get(key(i), never);
    expect(s.size()).toBe(12);
  });

  it('drops the least recently used field', async () => {
    const fetched: FieldKey[] = [];
    const s = createFieldStore({ fetchRange: async k => { fetched.push(k); return new Uint8Array(1); }, decode: () => fieldFor(), max: 2, bytesHeld: 0 });
    await s.get(key(1), never); await s.get(key(2), never);
    await s.get(key(1), never); // now the newer of the two
    await s.get(key(3), never);
    await s.get(key(1), never);
    expect(fetched.filter(k => k.start === 10).length).toBe(1);
    await s.get(key(2), never);
    expect(fetched.filter(k => k.start === 20).length).toBe(2);
  });

  it('runs at most two downloads at once by default', async () => {
    const gates = [deferred<Uint8Array>(), deferred<Uint8Array>(), deferred<Uint8Array>()];
    let started = 0;
    const s = createFieldStore({ fetchRange: () => gates[started++].promise, decode: () => fieldFor() });
    const all = [0, 1, 2].map(i => s.get(key(i), never));
    await Promise.resolve();
    expect(started).toBe(2);
    gates[0].resolve(new Uint8Array(1));
    await all[0];
    await vi.waitFor(() => expect(started).toBe(3));
    gates[1].resolve(new Uint8Array(1)); gates[2].resolve(new Uint8Array(1));
    await Promise.all(all);
  });

  it('retries after a failure', async () => {
    let tries = 0;
    const s = createFieldStore({
      fetchRange: async () => { if (!tries++) throw new Error('offline'); return new Uint8Array(1); },
      decode: () => fieldFor(),
    });
    await expect(s.get(key(1), never)).rejects.toThrow('offline');
    await expect(s.get(key(1), never)).resolves.toBeTruthy();
  });

  it('keeps a download another waiter still needs', async () => {
    const gate = deferred<Uint8Array>();
    let signal: AbortSignal | undefined;
    const s = createFieldStore({ fetchRange: (_k, sig) => { signal = sig; return gate.promise; }, decode: () => fieldFor() });
    const leaving = new AbortController();
    const a = s.get(key(1), leaving.signal), b = s.get(key(1), never);
    leaving.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal!.aborted).toBe(false);
    gate.resolve(new Uint8Array(1));
    await expect(b).resolves.toBeTruthy();
  });

  it('cancels a download nobody is waiting for', async () => {
    const gate = deferred<Uint8Array>();
    let signal: AbortSignal | undefined;
    const s = createFieldStore({ fetchRange: (_k, sig) => { signal = sig; sig.addEventListener('abort', () => gate.reject(new Error('stopped'))); return gate.promise; }, decode: () => fieldFor() });
    const leaving = new AbortController();
    const a = s.get(key(1), leaving.signal);
    await Promise.resolve();
    leaving.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    expect(signal!.aborted).toBe(true);
  });

  it('refuses a field from a different step, and does not keep it', async () => {
    const s = createFieldStore({ fetchRange: async () => new Uint8Array(1), decode: () => fieldFor({ leadMin: 30 }) });
    await expect(s.get(key(1), never)).rejects.toMatchObject({ code: 'bad-data' });
    expect(s.size()).toBe(0);
  });

  it('refuses a field from a different run', async () => {
    const s = createFieldStore({ fetchRange: async () => new Uint8Array(1), decode: () => fieldFor({ refTime: 2000 }) });
    await expect(s.get(key(1), never)).rejects.toBeInstanceOf(GribError);
  });

  it('frees its download slot after a cancelled wait', async () => {
    const gates = [deferred<Uint8Array>()];
    let started = 0;
    const s = createFieldStore({ fetchRange: (_k, sig) => { const g = gates[started++] ?? deferred<Uint8Array>(); sig.addEventListener('abort', () => g.reject(new Error('stopped'))); return g.promise; }, decode: () => fieldFor(), concurrency: 1 });
    const leaving = new AbortController();
    const a = s.get(key(1), leaving.signal);
    const b = s.get(key(2), never);
    leaving.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(started).toBe(2));
    void b.catch(() => undefined);
  });
});

describe('createFieldStore without network access', () => {
  it('still serves a field it holds', async () => {
    const { s } = store();
    await s.get(key(1), never);
    await expect(s.get(key(1), never, false)).resolves.toBeTruthy();
  });

  it('refuses a field it would have to download', async () => {
    const { s, fetched } = store();
    await expect(s.get(key(1), never, false)).rejects.toThrow('budget');
    expect(fetched).toEqual([]);
  });

  it('stops a queued download if a cooldown began while it waited', async () => {
    const gate = deferred<Uint8Array>();
    let blocked = false, started = 0;
    const s = createFieldStore({ fetchRange: () => { started++; return gate.promise; }, decode: () => fieldFor(), concurrency: 1, blocked: () => blocked });
    const first = s.get(key(1), never), second = s.get(key(2), never);
    blocked = true;
    gate.resolve(new Uint8Array(1));
    await first;
    await expect(second).rejects.toThrow('budget');
    expect(started).toBe(1);
  });
});

describe('createFieldStore compressed bytes', () => {
  it('rebuilds a dropped field without downloading it again', async () => {
    const { s, fetched, decode } = store(1);
    await s.get(key(1), never); await s.get(key(2), never);
    await s.get(key(1), never);
    expect(fetched.length).toBe(2);
    expect(decode).toHaveBeenCalledTimes(3);
  });

  it('rebuilds a dropped field during a cooldown', async () => {
    const { s } = store(1);
    await s.get(key(1), never); await s.get(key(2), never);
    await expect(s.get(key(1), never, false)).resolves.toBeTruthy();
  });

  it('keeps bytes for a limited number of frames', async () => {
    const fetched: FieldKey[] = [];
    const s = createFieldStore({ fetchRange: async k => { fetched.push(k); return new Uint8Array(1); }, decode: () => fieldFor(), max: 1, bytesHeld: 2 });
    for (const i of [1, 2, 3, 1]) await s.get(key(i), never);
    expect(fetched.length).toBe(4);
  });
});

describe('fetchRange', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const k = key(1);
  const partial = (body = new Uint8Array(10), range = 'bytes 10-19/999') => new Response(body, { status: 206, headers: { 'Content-Range': range } });

  it('asks for exactly the field', async () => {
    const f = vi.fn(async () => partial());
    vi.stubGlobal('fetch', f);
    const report = vi.fn();
    await expect(fetchRange(k, never, report)).resolves.toHaveLength(10);
    expect(new Headers((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('Range')).toBe('bytes=10-19');
    expect(report.mock.calls).toEqual([['charge']]);
  });

  it('stops without reading a full file sent instead of a range', async () => {
    let pulled = 0;
    const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1000)); }, cancel() { pulled = -1000; } }, { highWaterMark: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    await expect(fetchRange(k, never, () => undefined)).rejects.toThrow('range');
    expect(pulled).toBeLessThan(1);
  });

  it('refuses the wrong byte range', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => partial(new Uint8Array(10), 'bytes 20-29/999')));
    await expect(fetchRange(k, never, () => undefined)).rejects.toThrow('range');
  });

  it('accepts a range response when the browser hides Content-Range', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(10), { status: 206 })));
    await expect(fetchRange(k, never, () => undefined)).resolves.toHaveLength(10);
  });

  it('refuses a short body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => partial(new Uint8Array(4))));
    await expect(fetchRange(k, never, () => undefined)).rejects.toThrow('range');
  });

  it.each([429, 500, 503])('reports a pause on %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
    const report = vi.fn();
    await expect(fetchRange(k, never, report)).rejects.toThrow();
    expect(report).toHaveBeenCalledWith('bench');
  });

  it('gives up after thirty seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_a, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })));
    const out = fetchRange(k, never, () => undefined).catch(e => e);
    await vi.advanceTimersByTimeAsync(29_999);
    let done = false; void out.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
