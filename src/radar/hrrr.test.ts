import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forecastTileUrl, getForecastFrames, parseIdx, runUrl } from './hrrr';
import { bench, remaining, spend } from '@/api/budget';

vi.mock('@/api/budget', () => ({ spend: vi.fn(), bench: vi.fn(), remaining: vi.fn(() => 100) }));

const IDX_F02 = readFileSync(fileURLToPath(new URL('./__fixtures__/hrrr-f02.idx', import.meta.url)), 'utf8');
const RUN = Date.UTC(2026, 10, 5, 19);
const URL_F02 = 'https://example.test/f02';
const MIN = 60_000, HOUR = 60 * MIN;

/** An idx file holding all four steps of one hourly file. */
function idxFor(run: number, hour: number) {
  const d = new Date(run), stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`;
  const lines: string[] = [];
  let n = 1, at = 0;
  for (const lead of [15, 30, 45, 60].map(m => (hour - 1) * 60 + m)) {
    for (const field of ['REFC:entire atmosphere', 'REFD:1000 m above ground', 'REFD:4000 m above ground']) {
      lines.push(`${n++}:${at}:d=${stamp}:${field}:${lead} min fcst:`);
      at += 1000;
    }
  }
  return `${lines.join('\n')}\n`;
}

/** A fetch that serves the given runs, each out to its last published hour. */
function serve(published: Record<number, number>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const hit = Object.entries(published).flatMap(([run, last]) => Array.from({ length: last }, (_, i) => ({ run: Number(run), hour: i + 1 })))
      .find(f => `${runUrl(f.run, f.hour)}.idx` === url);
    return hit ? new Response(idxFor(hit.run, hit.hour)) : new Response('', { status: 404 });
  }));
  return calls;
}

describe('parseIdx', () => {
  it('finds REFD steps', () => {
    expect(parseIdx(IDX_F02, RUN, URL_F02).map(s => s.leadMin)).toEqual([75, 90, 105, 120]);
  });

  it('ends a range one byte before the next record', () => {
    const lines = IDX_F02.trim().split('\n');
    const i = lines.findIndex(l => l.includes(':REFD:1000 m above ground:75 min'));
    expect(parseIdx(IDX_F02, RUN, URL_F02)[0]).toMatchObject({ start: Number(lines[i].split(':')[1]), end: Number(lines[i + 1].split(':')[1]) - 1 });
  });

  it('never picks REFC or another REFD level', () => {
    const text = idxFor(RUN, 2);
    expect(parseIdx(text, RUN, URL_F02).map(s => s.start)).toEqual([1000, 4000, 7000, 10000]);
  });

  it('rejects an idx from a different run', () => {
    expect(parseIdx(IDX_F02, RUN + HOUR, URL_F02)).toEqual([]);
  });

  it('drops a final record with no end offset', () => {
    expect(parseIdx('1:0:d=2026110519:REFD:1000 m above ground:75 min fcst:\n', RUN, URL_F02)).toEqual([]);
  });

  it('ignores the analysis step', () => {
    expect(parseIdx('1:0:d=2026110519:REFD:1000 m above ground:anl:\n2:9:d=2026110519:X:y:anl:\n', RUN, URL_F02)).toEqual([]);
  });
});

describe('runUrl', () => {
  it('builds paths across UTC midnight', () => {
    expect(runUrl(Date.UTC(2026, 10, 5, 23), 2)).toBe('https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20261105/conus/hrrr.t23z.wrfsubhf02.grib2');
    expect(runUrl(Date.UTC(2026, 10, 6, 0), 12)).toBe('https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20261106/conus/hrrr.t00z.wrfsubhf12.grib2');
  });
});

describe('forecastTileUrl', () => {
  it('gives each step its own tile template', () => {
    const [a, b] = parseIdx(IDX_F02, RUN, URL_F02).map(forecastTileUrl);
    expect(a).not.toBe(b);
    expect(a.startsWith('hrrr-forecast://tile/{z}/{x}/{y}?')).toBe(true);
  });
});

describe('getForecastFrames', () => {
  // Each test uses its own day, because published idx files stay cached.
  let day = 1;
  let now: number, run: number, scan: number;
  beforeEach(() => {
    vi.mocked(spend).mockClear(); vi.mocked(bench).mockClear(); vi.mocked(remaining).mockReturnValue(100);
    day += 1;
    now = Date.UTC(2026, 0, day, 12, 50);
    run = Date.UTC(2026, 0, day, 11);
    scan = now - 2 * MIN;
  });

  it('returns steps after the latest scan and within the range', async () => {
    serve({ [run]: 18 });
    const frames = await getForecastFrames(scan, 2, now);
    expect(frames.map(f => f.leadMin)).toEqual([120, 135, 150, 165, 180, 195, 210, 225]);
    expect(frames.every(f => f.kind === 'forecast' && f.run === run && f.at! > scan && f.at! <= scan + 2 * HOUR)).toBe(true);
    expect(frames[0]).toMatchObject({ at: run + 120 * MIN, maxZoom: 11 });
  });

  it('skips a newer run that has not finished publishing the range', async () => {
    const newer = run + HOUR;
    serve({ [newer]: 2, [run]: 18 });
    const frames = await getForecastFrames(scan, 6, now);
    expect(new Set(frames.map(f => f.run))).toEqual(new Set([run]));
  });

  it('uses the newest run that qualifies', async () => {
    const newer = run + HOUR;
    serve({ [newer]: 18, [run]: 18 });
    expect(new Set((await getForecastFrames(scan, 2, now)).map(f => f.run))).toEqual(new Set([newer]));
  });

  it('stops at the last step of the run', async () => {
    const old = run - 4 * HOUR;
    serve({ [old]: 18 });
    const frames = await getForecastFrames(scan, 18, now);
    expect(frames.at(-1)!.leadMin).toBe(1080);
    expect(frames.at(-1)!.at).toBe(old + 18 * HOUR);
  });

  it('returns nothing when no run has published', async () => {
    serve({});
    await expect(getForecastFrames(scan, 6, now)).resolves.toEqual([]);
  });

  it('asks for the furthest file first, so an unpublished run costs one request', async () => {
    const calls = serve({});
    await getForecastFrames(scan, 2, now);
    expect(calls.length).toBe(6);
  });

  it('fetches a published idx once', async () => {
    const calls = serve({ [run]: 18 });
    await getForecastFrames(scan, 2, now);
    const count = calls.length;
    await getForecastFrames(scan, 2, now);
    const fresh = calls.slice(count).filter(u => u.includes(`t${String(new Date(run).getUTCHours()).padStart(2, '0')}z`));
    expect(fresh).toEqual([]);
  });

  it('retries a missing idx on the next call', async () => {
    const calls = serve({});
    await getForecastFrames(scan, 2, now);
    const count = calls.length;
    await getForecastFrames(scan, 2, now);
    expect(calls.length).toBe(count * 2);
  });

  it('charges each request', async () => {
    const calls = serve({});
    await getForecastFrames(scan, 2, now);
    expect(vi.mocked(spend).mock.calls).toEqual(calls.map(() => ['hrrr']));
  });

  it('pauses for a minute on a rate limit, and reports failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(getForecastFrames(scan, 2, now)).rejects.toThrow();
    expect(bench).toHaveBeenCalledWith('hrrr', 60_000);
  });

  it('pauses for a minute on a server error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(getForecastFrames(scan, 2, now)).rejects.toThrow();
    expect(bench).toHaveBeenCalledWith('hrrr', 60_000);
  });

  it('makes no request once the budget is used', async () => {
    const calls = serve({ [run]: 18 });
    vi.mocked(remaining).mockReturnValue(0);
    await expect(getForecastFrames(scan, 2, now)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('stops at once when aborted', async () => {
    const calls = serve({});
    const abort = new AbortController();
    abort.abort();
    await expect(getForecastFrames(scan, 2, now, abort.signal)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('refuses a run with a step missing, rather than leaving a hole', async () => {
    const newer = run + HOUR;
    serve({ [run]: 18 });
    const inner = vi.mocked(fetch).getMockImplementation()!;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `${runUrl(newer, 2)}.idx`) return new Response(idxFor(newer, 2).split('\n').filter(l => !l.includes(':75 min')).join('\n'));
      if (url.startsWith(runUrl(newer, 0).split('wrfsubhf')[0])) return new Response(idxFor(newer, Number(url.match(/subhf(\d+)/)![1])));
      return inner(url, init);
    }));
    expect(new Set((await getForecastFrames(scan, 2, now)).map(f => f.run))).toEqual(new Set([run]));
  });

  it('never returns a step at or before the scan', async () => {
    serve({ [run]: 18 });
    const exact = run + 120 * MIN;
    expect((await getForecastFrames(exact, 2, now))[0].leadMin).toBe(135);
  });
});
