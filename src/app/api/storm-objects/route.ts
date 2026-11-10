import { NextResponse } from 'next/server';
import { joinHistory, parseFile, parseIndex, pickFiles, PROBSEVERE_BASE, type StormObject } from '@/lib/probSevere';

export const runtime = 'nodejs';

const MAX_CACHED = 8;
const cache = new Map<string, StormObject[]>(); // files never change once published

async function loadFile(name: string, at: number) {
  const hit = cache.get(name);
  if (hit) return hit;
  const response = await fetch(PROBSEVERE_BASE + name, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ProbSevere file: ${response.status}`);
  const storms = parseFile(await response.json(), at);
  cache.set(name, storms);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return storms;
}

export async function GET() {
  try {
    const index = await fetch(PROBSEVERE_BASE, { cache: 'no-store', signal: AbortSignal.timeout(15000) }) // a cached index serves stale files;
    if (!index.ok) throw new Error(`ProbSevere index: ${index.status}`);
    const [newest, ...older] = pickFiles(parseIndex(await index.text()));
    if (!newest) throw new Error('No ProbSevere files');
    const storms = await loadFile(newest.name, newest.at);
    // A missing history file only costs the observed track.
    const history = (await Promise.allSettled(older.map(f => loadFile(f.name, f.at)))).flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
    return NextResponse.json({ at: newest.at, storms: joinHistory(storms, history) }, { headers: { 'cache-control': 'public, max-age=60' } });
  } catch {
    return NextResponse.json({ error: 'Storm outlines unavailable' }, { status: 503 });
  }
}
