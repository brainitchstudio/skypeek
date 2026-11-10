// Tracks why extra refreshes are justified. Each kind of event is separate, and
// evidence that disappears means "unknown", never "over". Repeating the same
// source revision can't extend an event, so a stale prediction can't keep polling.

import { TRIGGERS } from './config';

export type EventKind = 'precipitation' | 'wind' | 'winter' | 'visibility' | 'temperature';
export type EventState = 'CALM' | 'WATCH' | 'ACTIVE' | 'RECOVERY' | 'UNKNOWN';
export type Evidence = { level: 'none' | 'watch' | 'active' | 'unknown'; revision: string };
export type Track = { state: EventState; capUntil: number; calmCount: number; calmSince: number; revision: string };
export type Tracks = Partial<Record<EventKind, Track>>;

export const CALM_TRACK: Track = { state: 'CALM', capUntil: 0, calmCount: 0, calmSince: 0, revision: '' };

export function step(t: Track, e: Evidence, now: number): Track {
  const fresh = e.revision !== t.revision;
  if (e.level === 'unknown') {
    return t.state === 'CALM' ? t : { ...t, state: 'UNKNOWN', calmCount: 0, calmSince: 0 };
  }
  if (e.level === 'watch' || e.level === 'active') {
    const capUntil = fresh ? now + TRIGGERS.eventCapMs : t.capUntil;
    if (now >= capUntil) return { ...t, state: 'UNKNOWN' };
    return { state: e.level === 'active' ? 'ACTIVE' : 'WATCH', capUntil, calmCount: 0, calmSince: 0, revision: e.revision };
  }
  if (t.state === 'CALM') return t;
  // Calm needs fresh evaluations: the same payload seen twice is one evaluation.
  const calmSince = t.calmSince || now;
  const calmCount = fresh || !t.calmCount ? t.calmCount + 1 : t.calmCount;
  if (calmCount >= TRIGGERS.calmEvaluations && now - calmSince >= TRIGGERS.calmMs) return { ...CALM_TRACK, revision: e.revision };
  return { state: 'RECOVERY', capUntil: t.capUntil, calmCount, calmSince, revision: e.revision };
}

/** True while extra refreshes are worth buying. RECOVERY and UNKNOWN don't accelerate. */
export const accelerating = (ts: Tracks) => Object.values(ts).some(t => t.state === 'WATCH' || t.state === 'ACTIVE');
