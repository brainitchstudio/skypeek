import { bench, remaining, spend } from '@/api/budget';

let active = 0;
const waiting: (() => void)[] = [];
async function acquire() {
  if (active < 4) active++;
  else await new Promise<void>(resolve => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else active--;
}

/** Four concurrent NOAA downloads, counted at dispatch, with timeout and cooldown. */
export async function noaaFetch(url: string, signal?: AbortSignal) {
  await acquire();
  try {
    signal?.throwIfAborted();
    if (remaining('noaa') < 1) throw new Error('NOAA radar request budget or cooldown reached');
    spend('noaa');
    const r = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (r.status === 429 || r.status >= 500) bench('noaa', 60_000);
    if (!r.ok) throw new Error(`NOAA radar failed: ${r.status}`);
    // Consume the body under the concurrency limit, including stalled downloads.
    const body = await r.arrayBuffer();
    return new Response(body, { status: r.status, headers: r.headers });
  } finally { release(); }
}
