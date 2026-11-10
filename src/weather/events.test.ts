import { describe, expect, it } from 'vitest';
import { accelerating, CALM_TRACK, step, type Track } from './events';

const NOW = 1_000_000_000_000, MIN = 60_000;
const watch = { level: 'watch' as const, revision: 'r1' };

describe('event state machine', () => {
  it('enters WATCH on evidence, ACTIVE on fresh evidence', () => {
    const t = step(CALM_TRACK, watch, NOW);
    expect(t.state).toBe('WATCH');
    expect(accelerating({ precipitation: t })).toBe(true);
    expect(step(t, { level: 'active', revision: 'r2' }, NOW + MIN).state).toBe('ACTIVE');
  });

  it('needs two calm evaluations and 30 calm minutes to end', () => {
    let t: Track = step(CALM_TRACK, watch, NOW);
    t = step(t, { level: 'none', revision: 'r2' }, NOW + MIN);
    expect(t.state).toBe('RECOVERY');
    t = step(t, { level: 'none', revision: 'r3' }, NOW + 10 * MIN);
    expect(t.state).toBe('RECOVERY'); // two evaluations, not yet 30 minutes
    t = step(t, { level: 'none', revision: 'r3' }, NOW + 32 * MIN);
    expect(t.state).toBe('CALM');
  });

  it('does not count one repeated payload as two calm evaluations', () => {
    let t: Track = step(CALM_TRACK, watch, NOW);
    t = step(t, { level: 'none', revision: 'r2' }, NOW + MIN);
    t = step(t, { level: 'none', revision: 'r2' }, NOW + 40 * MIN);
    expect(t.state).toBe('RECOVERY');
  });

  it('moves to UNKNOWN, not CALM, when evidence disappears', () => {
    const t = step(step(CALM_TRACK, watch, NOW), { level: 'unknown', revision: 'r1' }, NOW + MIN);
    expect(t.state).toBe('UNKNOWN');
    expect(accelerating({ wind: t })).toBe(false);
  });

  it('caps a stale repeated trigger instead of accelerating forever', () => {
    const t = step(CALM_TRACK, watch, NOW);
    expect(step(t, watch, NOW + 60 * MIN).state).toBe('WATCH');
    expect(step(t, watch, NOW + 181 * MIN).state).toBe('UNKNOWN');
  });

  it('extends the cap on genuinely new evidence', () => {
    const t = step(CALM_TRACK, watch, NOW);
    expect(step(t, { level: 'watch', revision: 'r9' }, NOW + 181 * MIN).state).toBe('WATCH');
  });
});
