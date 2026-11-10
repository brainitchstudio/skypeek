import { Layers3, LocateFixed, Map, MapPin, Minus, Pause, Play, Plus, Ruler, RadioTower, Search, SkipBack, SkipForward, FastForward, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PointCheckCard } from './PointCheckCard';
import { LightningCard, PointCard, StormCard, WarningCard } from './RadarInfo';
import { DockCheck, DockMenu, DockTool } from './RadarDock';
import { RadarSearch } from './RadarSearch';
import type { ScreenProps } from './shared';
import { getGrid, getNearestLightning, getRadarWarnings, dedupeCells, getStormReports, getStormCellsAt, lightningTiles, type Bounds, type GridPoint, type StormCell } from '@/api/layers';
import { RateLimitError } from '@/api/budget';
import { getRadarFrames, radarSourceFor, restoredSource, type RadarFrame } from '@/api/weather';
import { PRECIP_HEX } from '@/radar/flat';
import { noaaFetch } from '@/radar/noaaTransport';
import { getNoaaFrames, nearestStation, NOAA_PRODUCTS, NOAA_STATIONS } from '@/radar/noaa';
import { alignedCells, contains, forecastBanner, frameAfterRefresh, isForecast, measure, mergeTimeline, type MapPoint, type RadarExtent } from '@/radar/tools';
import { prefetchForecast } from '@/radar/forecastTiles';
import { frameUnavailable, timelineState } from '@/radar/forecastTimeline';
import { FORECAST_HOURS } from '@/radar/hrrr';
import { useForecastFrames } from '@/radar/useForecastFrames';
import { getStationStatus, type StationStatus } from '@/radar/status';
import { imageryTiles, RAINVIEWER_SCALE } from '@/radar/imagery';
import { useSettings } from '@/lib/settings';
import type { WeatherAlert } from '@/lib/types';
import { countyFipsAt } from '@/lib/warningCounties';
import { usePointCheck, useStormObjects, type CheckSource } from '@/radar/usePointCheck';
import { checkPrompt, outlineAt } from '@/radar/checkMode';
import { RadarController, type MapPick } from '@/radar/controller';
import { arrivalPhrase, stormArrival } from '@/radar/proximity';
import { getLightningStrikes, getOpenWeatherLightning, LIGHTNING_SAFETY_MI, nearestStrike, type LightningStrike } from '@/radar/lightning';
import './radarDock.css';

const LAYERS = ['Precipitation', 'Storm tracks', 'Lightning', 'Wind', 'Temperature'] as const;
const REFRESH_MS = 5 * 60_000;
const PREFETCH_FRAMES = 3;
const DEMO_LABELS = ['3:30', '4 PM', '4:30', '5 PM', '5:30', 'Now', '6:30', '7 PM', '7:30', '8 PM'];

/** Outlives the screen, so a source that recovers while you're elsewhere still gets announced. */
let lastSource: { choice: number; swapped: string | null } | null = null;

/** A message over the map. `key` names the condition, so a dismissed one stays gone until that condition ends. */
type Notice = { key: string; text: string; tone?: 'err' | 'good' };

export function RadarScreen({ weather, place, nav }: ScreenProps) {
  const { s, set } = useSettings();
  const basemap = s.basemap === 2 ? 2 : 0;
  const el = useRef<HTMLDivElement>(null);
  const ctrl = useRef<RadarController | null>(null);
  const [active, setActive] = useState([true, false, false, false, false]);
  const [frameIndex, setFrame] = useState(5);
  const [playing, setPlaying] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [speed, setSpeed] = useState(1);
  const followLatest = useRef(true);
  const selectedTime = useRef<number | undefined>(undefined);
  const forecastUrl = useRef<string | null>(null);
  const [failedForecast, setFailedForecast] = useState<ReadonlySet<string>>(new Set());
  const [ruler, setRuler] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<MapPoint[]>([]);
  const [check, setCheck] = useState<{ source: CheckSource; warning?: WeatherAlert; spot: MapPoint | null; noOutline?: boolean } | null>(null);
  const onMapPoint = useRef((_: MapPoint) => {});
  const onStormObject = useRef((_: string) => {});
  onStormObject.current = id => setCheck({ source: { kind: 'storm', id }, spot: null });
  onMapPoint.current = p => { if (check) setCheck({ ...check, spot: { ...p } }); else setRulerPoints(points => points.length < 2 ? [...points, p] : [p]); };
  const [coverage, setCoverage] = useState(false);
  const [extent, setExtent] = useState<RadarExtent | null>(null);
  const [stationHealth, setStationHealth] = useState<{ id: string; value: StationStatus | null; failed: boolean } | null>(null);
  const [mapWarnings, setMapWarnings] = useState<WeatherAlert[]>([]);
  const [placeCounty, setPlaceCounty] = useState<string | null>(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [warningsError, setWarningsError] = useState(false);
  const [warningsState, setWarningsState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [history, setHistory] = useState<{ at: number; cells: StormCell[]; phase: 'loading' | 'ready' | 'failed' | 'limited' } | null>(null);
  const [liveFrames, setLiveFrames] = useState<RadarFrame[]>([]);
  const [radarError, setRadarError] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [dockMenu, setDockMenu] = useState<string | null>(null);
  const [legend, setLegend] = useState('');
  const [legendKey, setLegendKey] = useState('');
  const [legendImageKey, setLegendImageKey] = useState('');
  const [legendImage, setLegendImage] = useState('');
  const [legendError, setLegendError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reports, setReports] = useState<StormCell[]>([]);
  const storms = useMemo(() => dedupeCells(reports), [reports]);
  const [grid, setGrid] = useState<GridPoint[]>([]);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [stormError, setStormError] = useState(false);
  const [stormLimited, setStormLimited] = useState(false);
  const [gridError, setGridError] = useState(false);
  const [gridLimited, setGridLimited] = useState(false);
  const [pick, setPick] = useState<MapPick | null>(null);
  const [lightningMi, setLightningMi] = useState<{ place: string; miles: number | null } | null>(null);
  const [lightningStrikes, setLightningStrikes] = useState<LightningStrike[]>([]);
  const [strikesError, setStrikesError] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  // A keyed source needs a verified key; without one it falls back to the demo.
  const owKey = s.verified[1] ? (s.keys[1] ?? '').trim() : '';
  const tmKey = s.verified[2] ? (s.keys[2] ?? '').trim() : '';
  const choice = (s.radarSrc === 2 && !owKey) || (s.radarSrc === 3 && !tmKey) ? 0 : s.radarSrc;
  const { src, swapped } = radarSourceFor(choice);
  const simulated = src === 0;
  const noaa = src === 4 || src === 5;
  const station = NOAA_STATIONS.find(r => r.id === s.radarStation) ?? nearestStation(place.lat, place.lon);
  const product = NOAA_PRODUCTS.find(p => p.id === s.radarProduct) ?? NOAA_PRODUCTS[0];
  const sourceName = src === 4 ? 'NOAA · National reflectivity' : src === 5 ? `NOAA · ${station.id} · ${product.name}` : src === 1 ? 'RainViewer' : src === 2 ? 'OpenWeather' : src === 3 ? 'Tomorrow.io' : 'Demo';
  const sourceKey = `${src}:${noaa ? station.id + ':' + product.id : ''}`;
  const previousSource = useRef('');

  useEffect(() => {
    const now = { choice, swapped };
    const back = restoredSource(lastSource, now);
    const changed = lastSource !== null && lastSource.choice !== choice;
    lastSource = now;
    if (back) setRestored(back);
    else if (swapped || changed) setRestored(null);
  }, [choice, swapped]);

  useEffect(() => {
    let stale = false;
    const abort = new AbortController();
    if (previousSource.current !== sourceKey) {
      setLiveFrames([]); setLegend(''); setExtent(null); setPlaying(false); setFailedForecast(new Set()); followLatest.current = true;
      previousSource.current = sourceKey;
    }
    setRadarError(false); setTileError(false); setLoading(true); setLegendError(false);
    const request = noaa ? getNoaaFrames(src, station.id, product.id, abort.signal) : getRadarFrames(src, owKey, tmKey);
    request.then(r => {
      if (stale) return;
      setLiveFrames(r.frames);
      if (!r.frames.length) setFrame(r.now);
      setExtent('extent' in r ? r.extent as RadarExtent | null : null);
      setLegend('legend' in r ? r.legend as string : '');
      setLegendKey(sourceKey);
    }).catch(() => { if (!stale) setRadarError(true); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; abort.abort(); };
  }, [src, owKey, tmKey, noaa, station.id, product.id, sourceKey, tick]);

  useEffect(() => {
    setLegendImage('');
    if (!legend) return;
    const abort = new AbortController();
    let objectUrl = '', stale = false;
    noaaFetch(legend, abort.signal).then(async r => {
      if (!r.headers.get('content-type')?.includes('image/png')) throw new Error('Invalid NOAA legend');
      const blob = await r.blob();
      if (stale) return;
      objectUrl = URL.createObjectURL(blob); setLegendImage(objectUrl); setLegendImageKey(legend);
    }).catch(() => { if (!stale) setLegendError(true); });
    return () => { stale = true; abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [legend]);

  useEffect(() => {
    const onFrameReady = (ready: boolean, clean: boolean) => {
      setFrameReady(ready);
      const url = forecastUrl.current;
      if (ready && clean && url) setFailedForecast(failed => { // the frame recovered
        if (!failed.has(url)) return failed;
        const next = new Set(failed); next.delete(url); return next;
      });
    };
    const c = new RadarController(el.current!, basemap, setBounds, setPick, () => { setTileError(true); setPlaying(false); const url = forecastUrl.current; if (url) setFailedForecast(failed => new Set(failed).add(url)); }, p => onMapPoint.current(p), onFrameReady, id => onStormObject.current(id));
    ctrl.current = c;
    return () => { ctrl.current = null; c.destroy(); };
    // The controller handles style changes without recreating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { ctrl.current?.setBasemap(basemap); }, [basemap]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) setTick(Date.now()); }, REFRESH_MS);
    const back = () => { if (!document.hidden) setTick(t0 => Date.now() - t0 >= REFRESH_MS ? Date.now() : t0); }; // hidden ticks were skipped
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, []);

  // Fetched even with the layer hidden, so an approaching storm always gets called out.
  const wantStorms = !simulated;
  useEffect(() => {
    if (!wantStorms) return;
    let stale = false;
    getStormReports().then(c => { if (!stale) { setReports(c); setStormError(false); setStormLimited(false); } }).catch(error => { if (!stale) { setStormError(true); setStormLimited(error instanceof RateLimitError); } });
    return () => { stale = true; };
  }, [wantStorms, tick]);

  const forecastHours = FORECAST_HOURS.find(h => h === s.radarForecastHours) ?? 6;
  const forecast = useForecastFrames({ enabled: src === 4, latestScanAt: liveFrames.at(-1)?.at, hours: forecastHours, tick });
  const timeline = useMemo(() => mergeTimeline(liveFrames, forecast.frames), [liveFrames, forecast.frames]);
  // Resolved while rendering, so the selected clock time is read before this
  // render can overwrite it with whatever now sits at the old index.
  const [seenTimeline, setSeenTimeline] = useState(timeline);
  const timelineChanged = timeline !== seenTimeline;
  const frame = timelineChanged && timeline.length ? frameAfterRefresh(timeline, selectedTime.current, followLatest.current) : frameIndex;
  if (timelineChanged) { setSeenTimeline(timeline); setFrame(frame); }
  const view = timelineState(timeline, frame);
  forecastUrl.current = view.forecast ? timeline[frame].url : null;

  const selectedAt = previousSource.current === sourceKey ? timeline[frame]?.at : undefined;
  selectedTime.current = selectedAt;
  useEffect(() => {
    if (!active[1] || simulated || selectedAt === undefined || view.forecast) return;
    let stale = false;
    setHistory({ at: selectedAt, cells: [], phase: 'loading' });
    const timer = setTimeout(() => {
      getStormCellsAt(selectedAt).then(cells => { if (!stale) setHistory({ at: selectedAt, cells: alignedCells(cells, selectedAt), phase: 'ready' }); })
        .catch(error => { if (!stale) setHistory({ at: selectedAt, cells: [], phase: error instanceof RateLimitError ? 'limited' : 'failed' }); });
    }, 150);
    return () => { stale = true; clearTimeout(timer); };
  }, [active[1], simulated, selectedAt, view.forecast]);
  const alignedStorms = useMemo(() => view.forecast ? [] : selectedAt === undefined ? storms : history?.at === selectedAt && history.phase === 'ready' ? history.cells : [], [view.forecast, selectedAt, storms, history]);

  useEffect(() => {
    if (!coverage || src !== 5) return;
    let stale = false;
    setStationHealth({ id: station.id, value: null, failed: false });
    getStationStatus(station.id).then(value => { if (!stale) setStationHealth({ id: station.id, value, failed: false }); })
      .catch(() => { if (!stale) setStationHealth({ id: station.id, value: null, failed: true }); });
    return () => { stale = true; };
  }, [coverage, src, station.id, tick]);
  const coverageTiles = src === 1 ? imageryTiles('rainviewer', 'https://tilecache.rainviewer.com/v2/coverage/0/256/{z}/{x}/{y}/0/0_0.png') : null;

  const wantGrid = !simulated && (active[3] || active[4]);

  useEffect(() => {
    if (simulated || !bounds) return;
    const abort = new AbortController();
    setWarningsState('loading');
    // Panning and zooming can produce several view changes; query after it settles.
    const timer = setTimeout(() => {
      getRadarWarnings(bounds, abort.signal).then(warnings => {
        if (!abort.signal.aborted) { setMapWarnings(warnings); setWarningsError(false); setWarningsState('ready'); }
      }).catch(() => {
        if (!abort.signal.aborted) { setMapWarnings([]); setWarningsError(true); setWarningsState('failed'); }
      });
    }, 350);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [bounds, simulated, tick]);

  useEffect(() => {
    if (!wantGrid || !bounds) return;
    let stale = false;
    const t = setTimeout(() => { // wait for panning to settle
      getGrid(bounds).then(g => { if (!stale) { setGrid(g); setGridError(false); setGridLimited(false); } }).catch(error => { if (!stale) { setGrid([]); setGridError(true); setGridLimited(error instanceof RateLimitError); } });
    }, 400);
    return () => { stale = true; clearTimeout(t); };
  }, [wantGrid, bounds, tick]);

  const lightning = useMemo(() => lightningTiles(tick), [tick]);

  const wantLightning = !simulated;
  useEffect(() => {
    if (!wantLightning) return;
    let stale = false;
    getNearestLightning(place.lat, place.lon, tick).then(miles => { if (!stale) setLightningMi({ place: place.id, miles }); }).catch(() => { if (!stale) setLightningMi(null); });
    return () => { stale = true; };
  }, [wantLightning, place.id, place.lat, place.lon, tick]);

  const lightningKey = (s.keys[4] ?? '').trim();
  const openWeatherLightningKey = s.verified[1] ? (s.keys[1] ?? '').trim() : '';
  useEffect(() => {
    if (simulated || (!openWeatherLightningKey && !lightningKey)) { setLightningStrikes([]); setStrikesError(false); return; }
    const abort = new AbortController();
    const load = openWeatherLightningKey
      ? getOpenWeatherLightning(place.lat, place.lon, openWeatherLightningKey, tick, abort.signal).catch(e => {
        if (!lightningKey || abort.signal.aborted) throw e;
        return getLightningStrikes(place.lat, place.lon, lightningKey, tick, abort.signal);
      })
      : getLightningStrikes(place.lat, place.lon, lightningKey, tick, abort.signal);
    load
      .then(strikes => { if (!abort.signal.aborted) { setLightningStrikes(strikes); setStrikesError(false); } })
      .catch(() => { if (!abort.signal.aborted) { setLightningStrikes([]); setStrikesError(true); } });
    return () => abort.abort();
  }, [simulated, lightningKey, openWeatherLightningKey, place.lat, place.lon, tick]);

  const arrival = useMemo(
    () => (simulated || stormError || (selectedAt !== undefined && (view.historical || view.forecast)) ? null : stormArrival(storms, place.lat, place.lon)),
    // `tick` keeps the countdown moving between storm updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simulated, stormError, storms, place.lat, place.lon, tick, selectedAt, view.historical, view.forecast],
  );

  useEffect(() => { setPick(null); }, [place.lat, place.lon]);

  useEffect(() => {
    ctrl.current?.markPick(pick && !pick.stormId ? pick : null);
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPick(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);

  const pickedStorm = pick?.stormId ? alignedStorms.find(c => c.id === pick.stormId) : undefined;

  const pickingStorm = check?.source.kind === 'pick-storm';
  const stormMode = pickingStorm || check?.source.kind === 'storm';
  const stormObjects = useStormObjects(stormMode, tick);
  const feed = stormObjects.feed;
  const pointCheck = usePointCheck({
    source: check?.source ?? { kind: 'none' }, startWarning: check?.warning, spot: check?.spot ?? null,
    feed, feedFresh: stormObjects.fresh, latestScanAt: timeline[view.latest]?.at, tick,
  });
  const selectedOutline = pointCheck.storm?.storm ?? null;
  const stormOutlines = useMemo(() => (pickingStorm ? feed?.storms ?? [] : selectedOutline ? [selectedOutline] : []), [pickingStorm, feed, selectedOutline]);
  // Only a storm draws a line, from its center.
  const checkFrom = pointCheck.storm?.state === 'tracking' ? pointCheck.storm.storm.center : null;
  const fromCell = check?.source.kind === 'pick-storm' ? check.source.from : undefined;
  useEffect(() => { // the storm card's button: find the outline holding that cell
    if (!fromCell || !feed) return;
    const found = outlineAt(feed.storms, fromCell);
    setCheck({ source: found ? { kind: 'storm', id: found.id } : { kind: 'pick-storm' }, spot: null, noOutline: !found });
  }, [fromCell, feed]);
  const prompt = stormMode ? checkPrompt({ picking: pickingStorm, hasSpot: !!check?.spot, failed: stormObjects.failed, loaded: !!feed || stormObjects.failed, count: feed?.storms.length ?? 0, noOutline: !!check?.noOutline, track: pointCheck.storm }) : null;
  const canCheck = !simulated && !view.historical && !view.forecast && view.latest >= 0;
  const startCheck = (source: CheckSource, found?: { warning?: WeatherAlert }) => { setPick(null); setRuler(false); setCheck({ source, ...found, spot: null }); };
  const pickAgain = () => setCheck({ source: { kind: 'pick-storm' }, spot: null });
  useEffect(() => {
    if (!check) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCheck(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [check !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Only one dock menu is open at a time. Leaving search drops its pin. */
  const showMenu = (next: string | null) => {
    if (dockMenu === 'search' && next !== 'search') ctrl.current?.clearPin();
    setDockMenu(next);
  };
  const toggleMenu = (id: string) => showMenu(dockMenu === id ? null : id);

  const { alerts } = weather;
  useEffect(() => {
    let stale = false;
    setPlaceCounty(null);
    void countyFipsAt(place.lat, place.lon).then(id => { if (!stale) setPlaceCounty(id); }).catch(() => {});
    return () => { stale = true; };
  }, [place.lat, place.lon]);
  const mapAlerts = useMemo(() => {
    const byId = new globalThis.Map(mapWarnings.map(alert => [alert.id, alert] as const));
    const placeVisible = bounds && place.lat >= bounds.south && place.lat <= bounds.north && place.lon >= bounds.west && place.lon <= bounds.east;
    if (placeVisible) for (const alert of alerts) {
      const current = byId.get(alert.id) ?? alert;
      byId.set(alert.id, { ...current, countyFips: current.countyFips?.length ? current.countyFips : placeCounty ? [placeCounty] : [] });
    }
    return [...byId.values()];
  }, [mapWarnings, alerts, bounds, place.lat, place.lon, placeCounty]);
  useEffect(() => {
    ctrl.current?.update({ place, active, simulated, frame, playing, liveFrames: timeline, alerts: showAlerts ? mapAlerts : [], lightning, lightningStrikes, storms: pickingStorm ? [] : alignedStorms, grid, units: s.units, selectedStormId: pick?.stormId, selectedLightningId: pick?.lightningId, mapPicking: ruler || (check !== null && !pickingStorm), pickingStorm, stormOutlines, selectedOutlineId: check?.source.kind === 'storm' ? check.source.id : null, rulerPoints: ruler ? rulerPoints : [], pointCheck: check?.spot ? { from: checkFrom, spot: check.spot } : null, showCoverage: coverage, coverageExtent: noaa ? extent : null, coverageTiles });
  }, [place, active, simulated, frame, playing, timeline, mapAlerts, showAlerts, lightning, lightningStrikes, alignedStorms, grid, s.units, pick?.stormId, pick?.lightningId, ruler, rulerPoints, check, checkFrom, pickingStorm, stormOutlines, coverage, noaa, extent, coverageTiles]);

  const labels = simulated ? DEMO_LABELS : timeline.map(f => f.label);
  const n = labels.length;
  useEffect(() => {
    if (!playing || n < 2 || (!simulated && !frameReady)) return;
    followLatest.current = false;
    const t = setTimeout(() => { if (!document.hidden) setFrame(f => (f + 1) % n); }, 700 / speed);
    return () => clearTimeout(t);
  }, [playing, n, speed, frameReady, simulated, frame]);

  useEffect(() => {
    if (playing && !document.hidden) prefetchForecast(timeline.slice(frame + 1, frame + 1 + PREFETCH_FRAMES).filter(isForecast));
  }, [playing, frame, timeline]);

  const selectFrame = (next: number) => { setPlaying(false); followLatest.current = false; setFrame(Math.max(0, Math.min(n - 1, next))); setPick(null); };
  const jumpLatest = () => { setPlaying(false); followLatest.current = true; setFrame(Math.max(0, simulated ? n - 1 : view.latest)); setPick(null); };
  const measurement = rulerPoints.length === 2 ? measure(rulerPoints[0], rulerPoints[1]) : null;
  const nearLightning = wantLightning && lightningMi?.place === place.id ? lightningMi : null;
  const closestStrike = nearestStrike(lightningStrikes, place.lat, place.lon);
  const lightningDistance = [closestStrike?.miles, nearLightning?.miles].filter((m): m is number => m !== null && m !== undefined).reduce<number | null>((best, miles) => best === null ? miles : Math.min(best, miles), null);
  const lightningDanger = lightningDistance !== null && lightningDistance <= LIGHTNING_SAFETY_MI;
  const historical = !simulated && view.historical;
  const liveOverlayNames = [...(showAlerts ? ['NWS alerts'] : []), ...(active[2] ? ['lightning'] : []), ...(active[3] ? ['wind'] : []), ...(active[4] ? ['temperature'] : []), 'spot readings'];
  const pickedWarnings = pick?.alertIds.map(id => mapAlerts.find(w => w.id === id)).filter((w): w is WeatherAlert => !!w) ?? [];
  const pickedLightning = pick?.lightningId ? lightningStrikes.find(x => x.id === pick.lightningId) : undefined;
  const notices: Notice[] = [];
  if (arrival) notices.push({
    key: `storm:${place.id}:${arrival.cell.severe}`,
    text: arrival.minutes === 0 ? `A storm is at ${place.name} now.` : `A storm may reach ${place.name} ${arrivalPhrase(arrival.minutes)}.`,
    tone: arrival.cell.severe ? 'err' : undefined,
  });
  if (strikesError && active[2]) notices.push({ key: 'strike-feed-error', text: 'Individual lightning reports are unavailable. Showing NOAA density instead.', tone: 'err' });
  if (simulated) notices.push({ key: 'demo', text: 'Demo data. Not real weather.' });
  if (swapped) notices.push({ key: `swapped:${swapped}`, text: `${swapped} is near its limit, so this is RainViewer.` });
  if (restored) notices.push({ key: `restored:${restored}`, text: `${restored} is back, so the radar is using it again.`, tone: 'good' });
  if (tileError) notices.push({ key: 'radar-tiles', text: 'Some radar tiles could not load. Coverage may be incomplete.', tone: 'err' });
  if (loading && !liveFrames.length) notices.push({ key: 'radar-loading', text: 'Loading radar…' });
  if (radarError) notices.push({ key: 'radar-error', text: liveFrames.length ? 'Radar update failed. Showing the last loaded scans.' : 'Radar imagery is unavailable right now.', tone: 'err' });
  if (forecast.failed) notices.push({ key: 'forecast-unavailable', text: 'HRRR forecast is unavailable. Radar is not affected.' });
  if (stormError && wantStorms && active[1]) notices.push(stormLimited
    ? { key: 'storm-limit', text: 'Live storm tracks paused by request limit. Radar and NWS alerts still work; tracks will retry automatically.' }
    : { key: 'storm-error', text: 'Storm tracks are unavailable right now.', tone: 'err' });
  if (history && history.at === selectedAt && history.phase === 'limited' && active[1] && !view.forecast) notices.push({ key: 'storm-history-limit', text: 'Storm replay paused by request limit. Live radar and NWS alerts still work.' });
  if (gridError && wantGrid) notices.push(gridLimited
    ? { key: 'grid-limit', text: 'Wind and temperature paused by request limit. Radar and NWS alerts still work; the overlay will retry automatically.' }
    : { key: 'grid-error', text: 'Wind and temperature are unavailable right now.', tone: 'err' });
  if (warningsError) notices.push({ key: 'map-warnings-error', text: 'Map-wide NWS alerts are unavailable right now.', tone: 'err' });

  const noticeKeys = notices.map(x => x.key).join();
  useEffect(() => { setDismissed(d => d.filter(k => noticeKeys.split(',').includes(k))); }, [noticeKeys]);

  const observedAt = selectedAt;
  const age = observedAt ? Math.max(0, Math.floor((Date.now() - observedAt) / 60_000)) : null;
  const pct = n > 1 ? `${(Math.min(frame, n - 1) / (n - 1)) * 100}%` : '0%';

  return (
    <div className="screen radar">
      <div ref={el} className="radar-map" />

      <div className="radar-left">
        <div className="radar-dock" role="toolbar" aria-label="Radar tools">
          <button type="button" className="dock-search-trigger" aria-label="Search for a city, address, or county" aria-expanded={dockMenu === 'search'} onClick={() => toggleMenu('search')}>
            <Search size={19} aria-hidden /><span>Search city, address, or county</span>
          </button>
          <div className="dock-zoom" role="group" aria-label="Map zoom">
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => ctrl.current?.zoom(1)}><Plus size={21} aria-hidden /></button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => ctrl.current?.zoom(-1)}><Minus size={21} aria-hidden /></button>
          </div>
          <button type="button" className="dock-control" aria-label="Back to my location" title="Back to my location" onClick={() => ctrl.current?.recenter()}><LocateFixed size={21} aria-hidden /></button>
          <DockTool label="Layers" ariaLabel={`Layers menu${alerts.length ? `, ${alerts.length} active alert${alerts.length === 1 ? '' : 's'} at ${place.name}` : ''}`} icon={Layers3} tone="tool-source" open={dockMenu === 'layers'} onClick={() => toggleMenu('layers')}>
            {alerts.length > 0 && <span className="count">{alerts.length}</span>}
          </DockTool>
          <DockTool label="Radar source" icon={RadioTower} tone="tool-source" open={dockMenu === 'source'} onClick={() => toggleMenu('source')} />
          {canCheck && <DockTool label="SpotCheck" icon={MapPin} tone="tool-ruler" toggle on={check !== null} onClick={() => { showMenu(null); if (check) setCheck(null); else startCheck({ kind: 'pick-storm' }); }} />}
          <DockTool label="Measure" icon={Ruler} tone="tool-ruler" toggle on={ruler} open={dockMenu === 'ruler'} onClick={() => {
            if (ruler) { setRuler(false); showMenu(null); }
            else { setRuler(true); setPick(null); setCheck(null); showMenu('ruler'); }
          }} />
        </div>
        {dockMenu === 'layers' && <DockMenu kicker="MAP OVERLAYS" title="Layers" onClose={() => showMenu(null)}>
          {LAYERS.map((name, i) => <DockCheck key={name} label={name} checked={active[i]} onToggle={() => setActive(current => current.map((value, index) => index === i ? !value : value))} />)}
          <DockCheck label={`Alerts${alerts.length ? ` · ${alerts.length} at ${place.name}` : ''}`} checked={showAlerts} onToggle={() => { setShowAlerts(value => !value); setPick(null); }} />
          <small>{showAlerts ? warningsState === 'loading' && !mapAlerts.length ? 'Loading NWS alerts…' : warningsState === 'failed' && !mapAlerts.length ? 'NWS alerts unavailable.' : mapAlerts.length ? `${mapAlerts.length} alert${mapAlerts.length === 1 ? '' : 's'} in this map view. Highlighted counties have alert icons; tap one for the NWS text. County shading can extend beyond a published polygon.` : 'No NWS alerts in this map view.' : 'Turn on Alerts to highlight affected counties and show NWS alert polygons where available.'}</small>
          {alerts.length > 0 && <div className="dock-layer-alerts"><strong>Active at {place.name}</strong>{alerts.map(a => (
            <button type="button" key={a.id} className="dock-alert" onClick={() => nav('alertDetail', { alertId: a.id })}>
              <i style={{ background: a.color }} />
              <div><strong>{a.title}</strong><small>{a.area} · {a.when}</small></div>
              <span style={{ background: a.color, color: a.fg }}>{a.level}</span>
            </button>
          ))}</div>}
        </DockMenu>}
        {dockMenu === 'ruler' && <DockMenu kicker="RADAR TOOL" title="Measure" onClose={() => showMenu(null)}>
          <DockCheck label="Measure on map" checked={ruler} onToggle={() => { setRuler(v => !v); setPick(null); setCheck(null); }} />
          {ruler && measurement && <div className="ruler-value">{(s.units === 'F' ? measurement.miles : measurement.km).toFixed(1)} {s.units === 'F' ? 'mi' : 'km'} · {Math.round(measurement.bearing)}°</div>}
          <small>{!ruler ? 'Measure the distance and bearing between two points.' : measurement ? 'Initial bearing from the first point. Click again to start a new line.' : rulerPoints.length ? 'Click the second point on the map.' : 'Click two points on the map to measure.'}</small>
          {ruler && <button type="button" onClick={() => setRulerPoints([])} disabled={!rulerPoints.length}>Clear measurement</button>}
        </DockMenu>}
        {dockMenu === 'source' && <DockMenu kicker="RADAR TOOL" title="Radar source" onClose={() => showMenu(null)}>
          <label>Source<select value={s.radarSrc} onChange={e => set({ radarSrc: Number(e.target.value) })}>
            <option value={4}>NOAA · National radar</option><option value={5}>NOAA · Radar station</option>
            <option value={1}>RainViewer</option><option value={0}>Demo</option>
            {owKey && <option value={2}>OpenWeather</option>}{tmKey && <option value={3}>Tomorrow.io</option>}
          </select></label>
          <div className="dock-menu-divider" />
          <DockCheck label="Show radar coverage" checked={coverage} onToggle={() => setCoverage(v => !v)} />
          {coverage && <div className="dock-coverage-details">
          <span>{loading ? 'Checking imagery…' : radarError ? 'Imagery update unavailable' : tileError ? 'Some imagery tiles failed' : liveFrames.length ? 'Imagery metadata available' : simulated ? 'Demo imagery' : 'No imagery available'}</span>
          <small>{liveFrames.at(-1)?.at ? `Latest frame: ${new Date(liveFrames.at(-1)!.at!).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} · ${Math.max(0, Math.floor((Date.now()-liveFrames.at(-1)!.at!)/60000))} min old` : 'Image acquisition time unavailable'}</small>
          <small>{src === 1 ? 'Shaded areas are outside RainViewer’s published coverage mask.' : noaa ? 'Shaded areas are outside the published product extent. Unshaded areas do not guarantee a usable radar return.' : 'No verified coverage mask for this source.'}</small>
          {noaa && extent && bounds && <span>{contains(extent, {lat:(bounds.south+bounds.north)/2,lon:(bounds.west+bounds.east)/2}) ? 'Map center inside product extent' : 'Map center outside product extent'}</span>}
          </div>}
          {src === 5 && <>
            <span>NWS {station.id}: {stationHealth?.id === station.id ? stationHealth.failed ? 'Status unavailable' : stationHealth.value ? `${stationHealth.value.status} · ${stationHealth.value.mode}` : 'Checking…' : 'Checking…'}</span>
            {stationHealth?.id === station.id && stationHealth.value && <small>{stationHealth.value.at ? `Status report ${new Date(stationHealth.value.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}${Date.now()-stationHealth.value.at > 20*60000 || stationHealth.value.at > Date.now()+60000 ? ' · timing uncertain or stale' : ''}` : 'Status report time unavailable'}{stationHealth.value.alarm ? ` · Reported alarm: ${stationHealth.value.alarm}` : ''}</small>}
          </>}
          {src === 5 && <>
            <label>Station<select value={s.radarStation} onChange={e => set({ radarStation: e.target.value })}>
              <option value="">Nearest to {place.name} · {nearestStation(place.lat, place.lon).id}</option>
              {NOAA_STATIONS.map(r => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
            </select></label>
            <label>Product<select value={product.id} onChange={e => set({ radarProduct: e.target.value })}>
              {NOAA_PRODUCTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
            <button type="button" className="station-view" onClick={() => ctrl.current?.showPlace({ ...station, region: 'NOAA radar station' })}>View {station.id} on map</button>
          </>}
          <small>{src === 5 && product.id === 'sr_bvel' ? 'Velocity toward or away from the radar, not surface wind.' : noaa ? 'Original NOAA imagery. Blank areas can be outside coverage.' : 'Original provider imagery.'}</small>
        </DockMenu>}
        {dockMenu === 'search' && <RadarSearch onPick={p => ctrl.current?.showPlace(p)} onClose={() => showMenu(null)} />}
        {pickedStorm && active[1] && <StormCard storm={pickedStorm} place={place} at={selectedAt} onCheck={canCheck ? () => startCheck({ kind: 'pick-storm', from: { lat: pickedStorm.lat, lon: pickedStorm.lon } }) : undefined} onClose={() => setPick(null)} />}
        {pickedLightning && active[2] && <LightningCard strike={pickedLightning} place={place} onClose={() => setPick(null)} />}
        {active[1] && !simulated && <div className="radar-source-status" role="status"><small>{view.forecast ? 'Storm tracks are hidden on forecast frames.' : selectedAt === undefined ? 'Storm tracks: latest reports; imagery time unavailable.' : history?.at !== selectedAt || history.phase === 'loading' ? 'Loading storm reports for this frame…' : history.phase === 'limited' ? 'Storm replay paused by request limit.' : history.phase === 'failed' ? 'Storm reports unavailable for this frame.' : `${alignedStorms.length} storm cells within 5 minutes of this frame.`}</small></div>}
        {!simulated && showAlerts && <div className="radar-source-status" role="status"><small>{warningsState === 'loading' && !mapAlerts.length ? 'Checking live NWS alerts across this map…' : warningsState === 'failed' && !mapAlerts.length ? 'Map-wide NWS alert status unavailable.' : mapAlerts.length ? `${mapAlerts.length} live NWS alerts in this map view. Tap a county icon for details.` : 'No active NWS alerts in this map view.'}</small></div>}
        {pick && !pick.stormId && !pick.lightningId && pickedWarnings.length > 0 && <WarningCard key={pickedWarnings.map(w => w.id).join()} warnings={pickedWarnings} onCheck={canCheck ? w => startCheck({ kind: 'warning', id: w.id }, { warning: w }) : undefined} onClose={() => setPick(null)} />}
        {pick && !pick.stormId && !pick.lightningId && pickedWarnings.length === 0 && (
          <PointCard key={`${pick.lat},${pick.lon}`} pick={pick} storms={stormError ? null : storms} alerts={alerts} units={s.units} stamp={tick} historical={historical}
            nav={nav} onClose={() => setPick(null)} />
        )}
        {check && !check.spot && !stormMode && <div className="radar-source-status" role="status"><small>Click a spot on the map</small></div>}
        {prompt && <div className="radar-source-status check-prompt" role="status">
          <small>{prompt.text}</small>
          {prompt.skip && <button type="button" onClick={() => setCheck({ source: { kind: 'none' }, spot: null })}>Skip, just check a spot</button>}
          {prompt.again && <button type="button" onClick={pickAgain}>Pick a storm again</button>}
        </div>}
        {check?.spot && <PointCheckCard check={pointCheck} source={check.source} spot={check.spot} units={s.units} warning={check.warning} scanAt={timeline[view.latest]?.at} onPickAgain={pickAgain} onClose={() => setCheck(null)} />}
        {notices.filter(x => !dismissed.includes(x.key)).map(x => (
          <div key={x.key} className={`radar-pill${x.tone ? ` ${x.tone}` : ''}`} role="status">
            <span>{x.text}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setDismissed(d => [...d, x.key])}><X size={14} aria-hidden /></button>
          </div>
        ))}
      </div>

      {lightningDanger && <div className="radar-lightning-banner" role="alert">
        <Zap size={20} aria-hidden />
        <div><strong>Lightning near {place.name}</strong><span>Activity detected about {Math.max(0, Math.round(lightningDistance!))} miles from your active location in the last 15 minutes. Go indoors or into a hard-topped vehicle. Wait 30 minutes after the last thunder before returning outside.</span></div>
      </div>}

      <div className="radar-source-status radar-imagery-status" role="status">
        <strong>{view.forecast ? 'NOAA · HRRR forecast' : sourceName}</strong>
        {(observedAt || noaa || src === 1) && <small>
          {observedAt && <>{new Date(observedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {view.forecast ? forecastBanner(timeline[frame]) : <>{age} min ago{view.historical ? ' · Historical' : age !== null && age > 20 ? ' · Delayed' : ''}</>}{(noaa || src === 1) && ' · '}</>}
          {noaa ? 'NOAA / NWS' : src === 1 ? 'RainViewer' : ''}
        </small>}
      </div>
      {historical && <div className="radar-playback-context" role="status">
        <strong>Historical radar frame</strong>
        {active[1] && <span>{selectedAt === undefined ? 'Storm tracks use latest reports because this frame has no scan time.' : 'Storm tracks use reports within five minutes of this frame, when available.'}</span>}
        <span>{liveOverlayNames.join(', ')} are live.</span>
      </div>}

      {view.forecast && <div className="radar-playback-context" role="status">
        <strong>{forecastBanner(timeline[frame])}</strong>
        <span>{active[1] && 'Storm tracks are hidden. '}{liveOverlayNames.join(', ')} are live.</span>
      </div>}

      <div className="radar-right">
        <button type="button" className="radar-map-style" aria-label={basemap === 2 ? 'Show flat map' : 'Show satellite imagery'}
          title={basemap === 2 ? 'Show flat map' : 'Show satellite imagery'} onClick={() => set({ basemap: basemap === 2 ? 0 : 2 })}>
          <Map size={20} aria-hidden />{basemap === 2 ? 'Flat' : 'Satellite'}
        </button>
        {active[0] && (noaa || src === 1 || simulated) && <div
          className={`legend radar-legend${noaa ? ' noaa-key' : ''}`}
          aria-label={noaa ? `${src === 4 ? 'Reflectivity' : product.name} scale from NOAA` : src === 1 ? 'RainViewer rain reflectivity in dBZ' : 'Demo intensity bands'}
          title={noaa ? `${src === 4 ? 'Reflectivity' : product.name} · NOAA` : src === 1 ? 'RainViewer rain reflectivity · dBZ; snow uses separate colors' : 'Demo intensity bands'}
          aria-busy={noaa && !legendError && !(legendKey === sourceKey && legendImageKey === legend && legendImage)}>
          {noaa ? <>
            {legendKey === sourceKey && legendImageKey === legend && legendImage && !legendError
              ? <img className="noaa-legend" src={legendImage} alt={`${src === 4 ? 'Reflectivity' : product.name} color scale from NOAA`} onError={() => setLegendError(true)} />
              : <span className="legend-placeholder" role="status" aria-label={legendError ? 'Legend unavailable' : 'Loading matching legend'} />}
          </> : <div className="radar-color-key">
            {(src === 1 ? RAINVIEWER_SCALE : PRECIP_HEX.map((color, i) => ({ value: i + 1, color }))).slice().reverse().map(({ value, color }) =>
              <div key={value}><i style={{ background: color }} /><span>{value}</span></div>)}
          </div>}
        </div>}
      </div>

      {n > 1 && (
        <div className="scrub">
          <button type="button" className="play" aria-label="Previous radar frame" disabled={frame <= 0} onClick={() => selectFrame(frame - 1)}><SkipBack size={14} aria-hidden /></button>
          <button type="button" className="play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={14} fill="currentColor" aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}</button>
          <button type="button" className="play" aria-label="Next radar frame" disabled={frame >= n - 1} onClick={() => selectFrame(frame + 1)}><SkipForward size={14} aria-hidden /></button>
          <label className="playback-speed"><select aria-label="Playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={0.5}>½×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
          {forecast.frames.length > 0 && <label className="playback-speed"><select aria-label="Forecast range" value={forecastHours} onChange={e => set({ radarForecastHours: Number(e.target.value) })}>{FORECAST_HOURS.map(h => <option key={h} value={h}>{h} h</option>)}</select></label>}
          {playing && !simulated && !frameReady && <span className="frame-loading" role="status">Loading</span>}
          <div className="rail">
            <div className="line" />
            {view.nowPct !== null && <div className="forecast-line" style={{ left: `${view.nowPct}%` }} />}
            <div className="fill" style={{ width: view.nowPct !== null ? `min(${pct}, ${view.nowPct}%)` : pct }} />
            {view.forecast && view.nowPct !== null && <div className="forecast-fill" style={{ left: `${view.nowPct}%`, width: `calc(${pct} - ${view.nowPct}%)` }} />}
            {view.nowPct !== null && <div className="now-mark" style={{ left: `${view.nowPct}%` }}>Now</div>}
            <div className="knob" style={{ left: pct }} />
            <div className="stamp" style={{ left: pct }}>{labels[frame]}</div>
            <div className="hit" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {labels.map((l, i) => {
                const unavailable = frameUnavailable(timeline[i], failedForecast);
                return <button type="button" key={i} title={l} className={unavailable ? 'unavailable' : undefined} aria-label={unavailable ? `Forecast frame unavailable, ${l}` : `Show ${l}`} aria-pressed={frame === i} onClick={() => selectFrame(i)} />;
              })}
            </div>
          </div>
          <button type="button" className="latest-frame" aria-label="Jump to latest radar scan" onClick={jumpLatest}><FastForward size={14} aria-hidden />Latest</button>
        </div>
      )}
    </div>
  );
}
