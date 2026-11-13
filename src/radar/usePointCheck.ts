import { useEffect, useMemo, useRef, useState } from 'react';
import { followWarning, getPointAlerts } from '@/api/layers';
import { getStormObjects, keepFeed } from '@/api/stormObjects';
import { remaining } from '@/api/budget';
import { getPointHour, type PointHour } from '@/api/weather';
import type { StormFeed, StormObject } from '@/lib/probSevere';
import type { WeatherAlert } from '@/lib/types';
import { approach, insideGeometry, type Approach } from './approach';
import { checkArrival, type Arrival } from './arrival';
import { loadPointForecast, type PointForecast } from './pointForecast';
import type { MapPoint } from './tools';
import { parseWarningMotion } from './warningMotion';

export type CheckSource = { kind: 'storm'; id: string } | { kind: 'warning'; id: string } | { kind: 'none' } | { kind: 'pick-storm'; from?: MapPoint };
export type Section<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'unavailable'; reason: string };
export type StormTrack =
  | { state: 'tracking'; storm: StormObject; arrival: Arrival | null; stale: boolean } // arrival needs a pin
  | { state: 'gone'; storm: StormObject; asOf: number };
export type WarningTrack =
  | { state: 'active'; alert: WeatherAlert; inside: boolean | null; approach: Approach | null; afterEnd: boolean; stale: boolean; motionAt: number | null; onePoint: boolean }
  | { state: 'ended'; alert: WeatherAlert };
export type PointCheck = { storm: StormTrack | null; warning: Section<WarningTrack> | null; forecast: Section<PointForecast>; hour: Section<PointHour>; arrivalHour: Section<PointHour> | null; warnings: Section<WeatherAlert[]>; asOf: number };
export type SpotDeps = {
  forecast?: (spot: MapPoint, latestScanAt: number, now: number, signal: AbortSignal) => Promise<PointForecast>;
  hour?: (spot: MapPoint) => Promise<PointHour>;
  alerts?: (spot: MapPoint) => Promise<WeatherAlert[]>;
};
type SpotData = { forecast: Section<PointForecast>; hour: Section<PointHour>; warnings: Section<WeatherAlert[]> };

const LOADING = { state: 'loading' } as const;

/**
 * Where the feed leaves this storm. Gone only when a good feed newer than `seenAt` no longer lists the ID;
 * `goneAt` keeps that answer until a good feed lists it again.
 */
export function resolveStormObject(id: string, last: StormObject, feed: StormFeed | null, fresh: boolean, seenAt: number, goneAt: number | null, alerts: WeatherAlert[] | null, spot: MapPoint | null, now: number, answer: { spot: MapPoint; arrival: Arrival } | null = null): StormTrack {
  const found = feed?.storms.find(s => s.id === id);
  // Only a successful lookup can reverse a confirmed loss. A retained feed may
  // still contain the ID while the current refresh has failed.
  if (goneAt !== null && (!fresh || !feed || !found || feed.at <= goneAt)) return { state: 'gone', storm: last, asOf: goneAt };
  if (!found) {
    if (fresh && feed && feed.at > seenAt) return { state: 'gone', storm: last, asOf: feed.at };
  }
  const storm = found && found.at >= last.at ? found : last;
  // A failed fetch keeps the last answer. Recalculating would slide an old outline on with nothing to confirm it.
  if (!fresh) return { state: 'tracking', storm, arrival: answer && answer.spot === spot ? answer.arrival : null, stale: true };
  return { state: 'tracking', storm, arrival: spot ? checkArrival(storm, alerts, spot, now) : null, stale: false };
}

/**
 * What the warning itself says about the spot. Motion and points come only from this alert.
 * `checkedAt` is when a successful lookup returned this version: only a lookup at or after the end time can say it ended.
 */
export function resolveWarning(alert: WeatherAlert, stale: boolean, spot: MapPoint, now: number, checkedAt: number | null = null): WarningTrack {
  const endsAt = alert.endsAt ?? null;
  const ended = endsAt !== null && checkedAt !== null && checkedAt >= endsAt && endsAt <= now;
  if (alert.cancelled || ended) return { state: 'ended', alert };
  const motion = parseWarningMotion(alert.motionText);
  const a = motion ? approach(motion.points, motion, spot, now) : null;
  const afterEnd = endsAt !== null && !!a && (a.kind === 'crossing' || a.kind === 'closest') && a.at > endsAt;
  return { state: 'active', alert, inside: insideGeometry(spot, alert.geometry), approach: a, afterEnd, stale, motionAt: motion?.at ?? null, onePoint: motion?.points.length === 1 };
}

const abortError = () => new DOMException('Aborted', 'AbortError');
const settle = async <T,>(run: () => Promise<T>, reason: (e: unknown) => string): Promise<Section<T>> => {
  try { return { state: 'ready', value: await run() }; } catch (e) { return { state: 'unavailable', reason: reason(e) }; }
};

/** Loads the three spot sections independently, handing each to `onSection` as it settles. Rejects if the signal aborts, so a stale pin can't apply. */
export async function loadSpotData(spot: MapPoint, latestScanAt: number, now: number, signal: AbortSignal, deps: SpotDeps = {}, onSection: (part: Partial<SpotData>) => void = () => {}): Promise<SpotData> {
  const { forecast = loadPointForecast, hour = (s: MapPoint) => getPointHour(s.lat, s.lon), alerts = (s: MapPoint) => getPointAlerts(s.lat, s.lon) } = deps;
  if (signal.aborted) throw abortError();
  const publish = <K extends keyof SpotData>(key: K) => (v: SpotData[K]) => { if (!signal.aborted) onSection({ [key]: v }); return v; };
  const load = Promise.all([
    settle(() => forecast(spot, latestScanAt, now, signal), e => (e instanceof Error ? e.message : 'Forecast unavailable')).then(publish('forecast')),
    settle(() => hour(spot), () => 'NWS forecast unavailable').then(publish('hour')),
    (remaining('nwsalerts') < 1
      ? Promise.resolve<Section<WeatherAlert[]>>({ state: 'unavailable', reason: 'Warning request budget reached' })
      : settle(async () => (await alerts(spot)).filter(a => a.level === 'Warning'), () => 'Warning status unavailable')).then(publish('warnings')),
  ]);
  const aborted = new Promise<never>((_, reject) => { if (signal.aborted) reject(abortError()); else signal.addEventListener('abort', () => reject(abortError()), { once: true }); });
  const [f, h, w] = await Promise.race([load, aborted]);
  if (signal.aborted) throw abortError();
  return { forecast: f, hour: h, warnings: w };
}

/** A refresh never restarts a load already running for the same spot and scan. */
/** The storm outlines, fetched only while the mode is open. A failed fetch keeps the last feed. */
export function useStormObjects(open: boolean, tick: number): { feed: StormFeed | null; fresh: boolean; failed: boolean } {
  const [state, setState] = useState<{ feed: StormFeed | null; fresh: boolean; failed: boolean }>({ feed: null, fresh: false, failed: false });
  useEffect(() => {
    if (!open) { setState({ feed: null, fresh: false, failed: false }); return; }
    const abort = new AbortController();
    getStormObjects(abort.signal)
      .then(feed => { if (!abort.signal.aborted) setState({ feed, fresh: true, failed: false }); })
      .catch(() => { if (!abort.signal.aborted) setState(prev => ({ feed: keepFeed(prev.feed, Date.now()), fresh: false, failed: true })); });
    return () => abort.abort();
  }, [open, tick]);
  return state;
}

export const shouldStartLoad = (running: { spot: MapPoint; scan: number } | null, spot: MapPoint, scan: number) => !running || running.spot !== spot || running.scan !== scan;

/** `spot` must be a stable object (held in state): a new object each render would restart every load. */
export function usePointCheck({ source, startWarning, spot, feed, feedFresh, latestScanAt, tick }: {
  source: CheckSource; startWarning?: WeatherAlert; spot: MapPoint | null;
  feed: StormFeed | null; feedFresh: boolean; latestScanAt: number | undefined; tick: number;
}): PointCheck {
  const [loaded, setLoaded] = useState<{ spot: MapPoint; data: Partial<SpotData> } | null>(null);
  const [followed, setFollowed] = useState<{ id: string; alert: WeatherAlert | null; failed: boolean; checkedAt: number | null } | null>(null);
  const running = useRef<{ spot: MapPoint; scan: number; abort: AbortController } | null>(null);
  const last = useRef<{ id: string; storm: StormObject | undefined; seenAt: number; goneAt: number | null; answer: { spot: MapPoint; arrival: Arrival } | null }>({ id: '', storm: undefined, seenAt: 0, goneAt: null, answer: null });
  const [arrivalHourLoaded, setArrivalHourLoaded] = useState<{ spot: MapPoint; key: number; section: Section<PointHour> } | null>(null);

  useEffect(() => () => { running.current?.abort.abort(); running.current = null; }, [spot]); // a new pin drops the old load

  useEffect(() => {
    if (!spot) return;
    const now = Date.now();
    const scan = latestScanAt ?? now;
    if (!shouldStartLoad(running.current, spot, scan)) return;
    const abort = new AbortController();
    const mine = { spot, scan, abort };
    running.current = mine;
    const publish = (part: Partial<SpotData>) => {
      if (abort.signal.aborted || running.current !== mine) return; // a newer scan's load owns the card
      setLoaded(prev => ({ spot, data: { ...(prev?.spot === spot ? prev.data : {}), ...part } }));
    };
    loadSpotData(spot, scan, now, abort.signal, {}, publish)
      .catch(() => {}) // only an abort rejects; the new pin's load replaces it
      .finally(() => { if (running.current === mine) running.current = null; });
  }, [spot, latestScanAt, tick]);

  const warningId = source.kind === 'warning' ? source.id : null;
  useEffect(() => {
    if (warningId === null) return;
    const abort = new AbortController();
    followWarning(warningId, abort.signal)
      .then(alert => { if (!abort.signal.aborted) setFollowed({ id: warningId, alert, failed: false, checkedAt: Date.now() }); })
      .catch(() => { if (!abort.signal.aborted) setFollowed(prev => { const same = prev?.id === warningId; return { id: warningId, alert: same ? prev.alert : null, failed: true, checkedAt: same ? prev.checkedAt : null }; }); });
    return () => abort.abort();
  }, [warningId, tick]);

  // One clock for every track, taken whenever the inputs change; tick can be minutes old.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [spot, source.kind, source.kind === 'storm' || source.kind === 'warning' ? source.id : '', feed, tick]);
  const stormId = source.kind === 'storm' ? source.id : null;
  const data = loaded && loaded.spot === spot ? loaded.data : null;
  const alerts = data?.warnings?.state === 'ready' ? data.warnings.value : null;
  const storm = useMemo(() => {
    if (stormId === null) { last.current = { id: '', storm: undefined, seenAt: 0, goneAt: null, answer: null }; return null; } // reopening the same ID starts over
    if (last.current.id !== stormId) last.current = { id: stormId, storm: feed?.storms.find(s => s.id === stormId), seenAt: feed?.at ?? 0, goneAt: null, answer: null };
    if (!last.current.storm) return null;
    const track = resolveStormObject(stormId, last.current.storm, feed, feedFresh, last.current.seenAt, last.current.goneAt, alerts, spot, now, last.current.answer);
    last.current.storm = track.storm;
    if (track.state === 'tracking' && track.arrival && spot) last.current.answer = { spot, arrival: track.arrival };
    last.current.goneAt = track.state === 'gone' ? track.asOf : null;
    if (feed?.storms.some(s => s.id === stormId)) last.current.seenAt = Math.max(last.current.seenAt, feed.at);
    return track;
  }, [stormId, feed, feedFresh, alerts, spot, now]);

  const earliest = storm?.state === 'tracking' ? storm.arrival?.earliest ?? null : null;
  const hourKey = earliest === null ? null : Math.floor(earliest / 3_600_000);
  useEffect(() => {
    if (!spot || earliest === null || hourKey === null) return;
    let live = true;
    settle(() => getPointHour(spot.lat, spot.lon, earliest), () => 'NWS forecast unavailable')
      .then(section => { if (live) setArrivalHourLoaded({ spot, key: hourKey, section }); });
    return () => { live = false; };
  }, [spot, hourKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the hour, not the minute, picks the period
  const arrivalHour = hourKey === null ? null : arrivalHourLoaded?.spot === spot && arrivalHourLoaded.key === hourKey ? arrivalHourLoaded.section : LOADING;

  let warning: Section<WarningTrack> | null = null;
  if (warningId !== null) {
    const mine = followed?.id === warningId ? followed : null;
    const alert = mine?.alert ?? startWarning ?? null;
    if (!spot) warning = LOADING;
    else if (alert) warning = { state: 'ready', value: resolveWarning(alert, !!mine?.failed, spot, now, mine?.alert ? mine.checkedAt : null) };
    else warning = mine?.failed ? { state: 'unavailable', reason: 'Warning status unavailable' } : LOADING;
  }

  return { storm, warning, forecast: data?.forecast ?? LOADING, hour: data?.hour ?? LOADING, arrivalHour, warnings: data?.warnings ?? LOADING, asOf: now };
}
