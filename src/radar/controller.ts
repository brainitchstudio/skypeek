import type * as GeoJSON from 'geojson';
import { addProtocol, AttributionControl, Map as GlMap, Marker, Popup, setWorkerUrl, type GeoJSONSource, type ImageSource, type LayerSpecification } from 'maplibre-gl';
import { mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { FLAT_SCHEME, loadFlatTile, PRECIP_HEX, temperatureImage } from './flat';
import type { MapPoint, RadarExtent } from './tools';
import { IMAGERY_SCHEME, loadImageryTile } from './imagery';
import { loadForecastTile } from './forecastTiles';
import { FORECAST_SCHEME } from './hrrr';
import { isForecast, layersToDrop } from './tools';
import { buildStyle, COUNTY_LOW_MAX_ZOOM, countyColor, SLOT } from './style';
import type { Bounds, GridPoint, StormCell } from '@/api/layers';
import type { StormObject } from '@/lib/probSevere';
import { outlineFeatures } from './stormOutlines';
import type { LightningStrike } from './lightning';
import type { RadarFrame } from '@/api/weather';
import { temp, type Units } from '@/lib/format';
import type { AlertLevel, Place, WeatherAlert } from '@/lib/types';
import { loadWarningCounties } from '@/lib/warningCounties';

// Next's bundler can't resolve MapLibre's worker, so `npm run dev` and `build` copy it to public/.
// Hostinger serves .mjs as text/plain; module workers require a JavaScript MIME type.
setWorkerUrl(`${location.origin}/maplibre-gl-worker.js`);
addProtocol(FLAT_SCHEME, loadFlatTile);
addProtocol(IMAGERY_SCHEME, loadImageryTile);
addProtocol(FORECAST_SCHEME, loadForecastTile);

const NOW = 5, KM = 111.32;
const C = { orange: PRECIP_HEX[2], red: PRECIP_HEX[3] };
const BAND = PRECIP_HEX;
const ALERT_COLOR: Record<AlertLevel, string> = { Warning: '#e0453a', Watch: '#f0954a', Advisory: '#d9b52c', Statement: '#378add' };
const ALERT_ICON_FG: Record<AlertLevel, string> = { Warning: '#fff', Watch: '#111', Advisory: '#111', Statement: '#fff' };
const BEARING = 68, STEP = 28; // storm motion: ENE, ~35 mph, km per 30-min frame
const VX = STEP * Math.sin((BEARING * Math.PI) / 180), VY = STEP * Math.cos((BEARING * Math.PI) / 180);
const HOME: LL = [40.6782, -73.9442]; // the demo storm is authored around here
const FORECAST_LAYERS_KEPT = 24; // each holds its tiles in GPU memory; dropped ones repaint from the worker
const FRAME_BLEND_MS = 320;
const FLAT_MAX_ZOOM = 11; // flat tiles are redrawn sharp up to here
const RADAR_OPACITY = 1; // preserve the provider palette; map labels draw above radar
const STORM_STEPS = [15, 30, 45]; // minutes ahead marked on a storm's path
const HOME_ZOOM = 8.5;
const HIT_PX = 8; // how near a click must land to a storm's dot
const DOUBLE_CLICK_MS = 250; // a double click zooms, so hold a click until it can't be one

type LL = [number, number]; // lat, lng, as the demo geometry is written
type Feature = GeoJSON.Feature;

const off = ([lat, lng]: LL, dx: number, dy: number): LL => [lat + dy / KM, lng + dx / (KM * Math.cos((lat * Math.PI) / 180))];
const move = (c: LL, f: number) => off(c, VX * (f - NOW), VY * (f - NOW));
const xy = ([lat, lng]: LL): GeoJSON.Position => [lng, lat];
const polygon = (pts: LL[], properties: Record<string, unknown> = {}): Feature =>
  ({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]].map(xy)] } });
const line = (pts: LL[]): Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(xy) } });
const point = (p: LL, properties: Record<string, unknown> = {}): Feature => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: xy(p) } });
const collection = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

function blob(c: LL, rx: number, ry: number, rot: number, seed: number, n = 64): LL[] {
  const r = (rot * Math.PI) / 180, pts: LL[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const w = 1 + 0.11 * Math.sin(3 * t + seed) + 0.06 * Math.sin(7 * t + seed * 2.3) + 0.03 * Math.sin(13 * t + seed);
    const x = rx * w * Math.cos(t), y = ry * w * Math.sin(t);
    pts.push(off(c, x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)));
  }
  return pts;
}
const circle = (c: LL, km: number): LL[] =>
  Array.from({ length: 64 }, (_, i) => off(c, km * Math.cos((i / 64) * Math.PI * 2), km * Math.sin((i / 64) * Math.PI * 2)));
const rand = (seed: number) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
function timeLabel(f: number, addMin: number) {
  let m = 15 * 60 + 30 + f * 30 + addMin;
  const h = Math.floor(m / 60) % 12 || 12;
  m %= 60;
  return `${h}:${String(m).padStart(2, '0')} PM`;
}

const CELLS: { c: LL; rot: number; seed: number; bands: [number, number][] }[] = [
  { c: [40.55, -74.55], rot: 32, seed: 1, bands: [[62, 24], [40, 14], [21, 7.5], [9, 3.5]] },
  { c: [41.2, -74.3], rot: 28, seed: 2.6, bands: [[30, 12], [15, 6], [6, 2.4]] },
  { c: [39.92, -75.3], rot: 30, seed: 4.1, bands: [[38, 14], [17, 6]] },
  { c: [41.5, -72.95], rot: 25, seed: 5.3, bands: [[22, 9]] },
];
const WATCH: LL[] = [[41.36, -74.78], [41.32, -73.52], [41.02, -73.28], [40.66, -73.3], [40.5, -73.95], [40.26, -74.38], [40.28, -74.95], [40.84, -75.12]];

/** All US county borders as one line feature. Census data, loaded on first use. */
let countyLines: Promise<GeoJSON.Feature> | null = null;
function loadCountyLines() {
  countyLines ??= import('us-atlas/counties-10m.json').then(m => {
    const topo = m.default as unknown as Topology<{ counties: GeometryCollection }>;
    return { type: 'Feature', properties: {}, geometry: mesh(topo, topo.objects.counties, (a, b) => a !== b) };
  });
  return countyLines;
}

/** A small arrow image for the wind layer, pointing right. */
function arrowImage() {
  const size = 28, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(2, 13, 18, 2);
  g.beginPath(); g.moveTo(26, 14); g.lineTo(19, 9.5); g.lineTo(19, 18.5); g.closePath(); g.fill();
  return g.getImageData(0, 0, size, size);
}

/** A click on the map: a storm if one was hit, otherwise a spot and any alerts drawn there. */
export type MapPick = { lat: number; lon: number; stormId: string | null; alertIds: string[]; lightningId?: string | null };

export type RadarState = {
  place: Place;
  active: boolean[]; // precip, tracks, lightning, wind, temperature
  simulated: boolean;
  selectedStormId?: string | null;
  selectedLightningId?: string | null;
  mapPicking?: boolean;
  pickingStorm?: boolean; // only storm outlines answer clicks
  stormOutlines?: StormObject[];
  selectedOutlineId?: string | null;
  rulerPoints?: MapPoint[];
  pointCheck?: { from: MapPoint | null; spot: MapPoint } | null;
  showCoverage?: boolean;
  coverageExtent?: RadarExtent | null;
  coverageTiles?: string | null;
  frame: number;
  playing?: boolean;
  liveFrames: RadarFrame[];
  alerts: WeatherAlert[];
  lightning: string;
  lightningStrikes: LightningStrike[];
  storms: StormCell[];
  grid: GridPoint[];
  units: Units;
};

const SOURCES = ['temp', 'precip', 'watch', 'alerts', 'warning-counties', 'warning-county-icons', 'tracks', 'track-dots', 'wind', 'storm-lines', 'storm-dots', 'grid', 'ruler', 'storm-outlines', 'point-check', 'coverage-area'] as const;
type SourceName = (typeof SOURCES)[number];

/** Owns the MapLibre map; React only pushes state into it. */
export class RadarController {
  private map: GlMap;
  private stormMarkers = new Map<string, Marker>();
  private lightningMarkers = new Map<string, Marker>();
  private currentFrameSource: string | null = null;
  private displayedFrameSource: string | null = null;
  private fadingFrameSource: string | null = null;
  private prewarmedFrameSource: string | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private preparedFrames = new Set<string>();
  private frameReadyCallback?: (ready: boolean, clean: boolean) => void;
  private failedSources = new Set<string>(); // refetched on the next visit
  private visitedForecasts: string[] = []; // oldest first
  private readyReported = false;
  private mapPoint?: (p: MapPoint) => void;
  private coverageUrl: string | null = null;
  private toolKey = '';
  private pickStorm: (p: MapPick) => void;
  private me: Marker;
  private ro: ResizeObserver;
  private markers: Marker[] = [];
  private pin: Marker | null = null;
  private picked: Marker | null = null;
  private clickTimer: ReturnType<typeof setTimeout> | undefined;
  private frames = new Map<string, string>(); // tile url -> layer id
  private nextFrame = 0;
  private basemap: number;
  private ready = false;
  private last: RadarState | null = null;
  private placeKey = '';
  private shift: LL = [0, 0];
  private alertKey = '';
  private alertPopup: Popup | null = null;
  private lastDraw = '';
  private lightningUrl: string | null = null;
  private tempUrl = '';
  private drawn: unknown[] = [];

  constructor(el: HTMLElement, basemap: number, onView: (b: Bounds) => void, onPick: (p: MapPick) => void, onRadarError?: () => void, onMapPoint?: (p: MapPoint) => void, onFrameReady?: (ready: boolean, clean: boolean) => void, onStormObject?: (id: string) => void) {
    this.pickStorm = onPick;
    this.mapPoint = onMapPoint;
    this.frameReadyCallback = onFrameReady;
    this.basemap = basemap;
    this.map = new GlMap({
      container: el, style: buildStyle(basemap), center: [HOME[1], HOME[0]], zoom: HOME_ZOOM, minZoom: 4, maxZoom: 16,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, attributionControl: false,
    });
    this.map.addControl(new AttributionControl(), 'bottom-left');
    this.map.on('sourcedata', e => { if (e.sourceId === this.currentFrameSource) this.reportFrameReady(); });
    this.map.on('movestart', () => { this.preparedFrames.clear(); this.reportFrameReady(); });
    this.map.on('idle', () => {
      if (!this.ready) return;
      for (const id of this.frames.values()) {
        if (this.map.getLayer(id) && this.map.getLayoutProperty(id, 'visibility') === 'visible' && this.map.isSourceLoaded(id)) this.preparedFrames.add(id);
      }
      this.reportFrameReady();
    });
    this.map.on('error', e => {
      const source = (e as { sourceId?: string }).sourceId;
      if (source?.startsWith('frame-')) this.failedSources.add(source);
      if (source?.startsWith('frame-') || e.error?.message.includes('NOAA')) onRadarError?.();
      if (source === this.currentFrameSource) this.reportFrameReady(); // an errored tile sends no sourcedata
    });
    this.map.touchZoomRotate.disableRotation();
    this.me = new Marker({ element: Object.assign(document.createElement('div'), { className: 'rm-me' }) })
      .setLngLat([HOME[1], HOME[0]]).addTo(this.map);
    this.map.on('style.load', this.onStyle);
    this.map.on('moveend', () => {
      const b = this.map.getBounds();
      onView({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    });
    this.map.on('click', e => {
      clearTimeout(this.clickTimer);
      if (!this.ready) return;
      const countyIcon = this.map.queryRenderedFeatures(e.point, { layers: ['warning-county-icon'] })[0];
      if (countyIcon && !this.last?.pickingStorm && !this.last?.mapPicking) {
        this.showCountyAlert(String(countyIcon.properties.id), String(countyIcon.properties.name), [e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (this.last?.pickingStorm) {
        const hit = this.map.queryRenderedFeatures(e.point, { layers: ['storm-outlines-fill'] })[0];
        if (hit) onStormObject?.(String(hit.properties.id));
        return;
      }
      if (this.last?.mapPicking) { const w = e.lngLat.wrap(); onMapPoint?.({ lat: w.lat, lon: w.lng }); return; }
      if (this.last?.simulated) return; // nothing real to report on the demo
      const { x, y } = e.point, { lat, lng: lon } = e.lngLat;
      const storm = this.map.queryRenderedFeatures([[x - HIT_PX, y - HIT_PX], [x + HIT_PX, y + HIT_PX]], { layers: ['storm-cells'] })[0];
      const alertIds = this.map.queryRenderedFeatures(e.point, { layers: ['alerts-fill'] }).map(f => String(f.properties.id));
      const stormId = storm ? String(storm.properties.id) : null;
      this.clickTimer = setTimeout(() => onPick({ lat, lon, stormId, alertIds }), DOUBLE_CLICK_MS);
    });
    this.map.on('dblclick', () => clearTimeout(this.clickTimer));
    this.ro = new ResizeObserver(() => this.map.resize());
    this.ro.observe(el);
  }

  zoom(dir: number) { if (dir > 0) this.map.zoomIn(); else this.map.zoomOut(); }

  /** Switch base imagery while preserving the current view and search pin. */
  setBasemap(basemap: number) {
    if (basemap === this.basemap) return;
    this.basemap = basemap;
    this.ready = false;
    this.frames.clear();
    this.preparedFrames.clear();
    this.currentFrameSource = null;
    this.displayedFrameSource = null;
    this.prewarmedFrameSource = null;
    this.cancelFrameFade();
    this.readyReported = false;
    this.frameReadyCallback?.(false, true);
    this.toolKey = '';
    this.alertKey = '';
    this.alertPopup?.remove();
    this.alertPopup = null;
    this.coverageUrl = null;
    this.lightningUrl = null;
    this.tempUrl = '';
    this.drawn = [];
    this.alertKey = '';
    this.lastDraw = '';
    this.map.setStyle(buildStyle(basemap));
  }

  /** Back to the forecast place, from wherever the map has been moved. */
  recenter() {
    const p = this.last?.place;
    if (p) this.map.flyTo({ center: [p.lon, p.lat], zoom: HOME_ZOOM });
  }

  /** Marks the spot the details card is describing. */
  markPick(p: { lat: number; lon: number } | null) {
    this.picked?.remove();
    this.picked = null;
    if (!p) return;
    this.picked = new Marker({ element: Object.assign(document.createElement('div'), { className: 'rm-pick' }) })
      .setLngLat([p.lon, p.lat]).addTo(this.map);
  }

  /** Moves the view to a searched place and marks it, without changing the forecast place. */
  showPlace(p: Place) {
    this.clearPin();
    const address = p.id.startsWith('census:');
    const el = Object.assign(document.createElement('div'), { className: 'rm-pin', textContent: address ? '' : p.name, title: p.name });
    this.pin = new Marker({ element: el, anchor: 'left', offset: [-6, 0] }).setLngLat([p.lon, p.lat]).addTo(this.map);
    this.map.flyTo({ center: [p.lon, p.lat], zoom: address ? 16 : 10 });
  }

  clearPin() {
    this.pin?.remove();
    this.pin = null;
  }

  destroy() {
    clearTimeout(this.clickTimer);
    this.cancelFrameFade();
    this.alertPopup?.remove();
    this.stormMarkers.forEach(m => m.remove());
    this.stormMarkers.clear();
    this.lightningMarkers.forEach(m => m.remove());
    this.lightningMarkers.clear();
    this.ro.disconnect();
    this.map.remove();
  }

  /** Adds the overlays once the base style is ready, then applies any waiting state. */
  private onStyle = () => {
    const m = this.map;
    SOURCES.forEach(s => m.addSource(s, { type: 'geojson', data: collection([]) }));
    m.addSource('counties', { type: 'geojson', data: collection([]) });
    m.addLayer({ id: 'counties-low', type: 'line', source: 'counties', minzoom: 6, maxzoom: COUNTY_LOW_MAX_ZOOM, paint: {
      'line-color': countyColor(this.basemap), 'line-width': 0.6,
    } }, 'boundary-state');
    void loadCountyLines().then(f => (m.getSource('counties') as GeoJSONSource | undefined)?.setData(f));
    m.addImage('wind-arrow', arrowImage());
    const under = (l: LayerSpecification) => m.addLayer(l, SLOT);
    under({ id: 'temp', type: 'fill', source: 'temp', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } });
    under({ id: 'precip', type: 'fill', source: 'precip', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.78 } });
    under({ id: 'watch-fill', type: 'fill', source: 'watch', paint: { 'fill-color': C.orange, 'fill-opacity': 0.08 } });
    under({ id: 'watch-line', type: 'line', source: 'watch', paint: { 'line-color': '#d97a2b', 'line-width': 2, 'line-dasharray': [3, 3] } });
    under({ id: 'warning-county-fill', type: 'fill', source: 'warning-counties', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 } });
    under({ id: 'warning-county-line', type: 'line', source: 'warning-counties', paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 } });
    under({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } });
    under({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 3] } });
    under({ id: 'tracks-fill', type: 'fill', source: 'tracks', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': C.red, 'fill-opacity': 0.14 } });
    under({ id: 'tracks-line', type: 'line', source: 'tracks', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#111', 'line-width': 2, 'line-dasharray': [2.5, 3] } });
    m.addLayer({ id: 'track-dots', type: 'circle', source: 'track-dots', paint: {
      'circle-radius': ['get', 'radius'], 'circle-color': ['get', 'fill'], 'circle-opacity': ['get', 'fillOpacity'],
      'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': ['get', 'strokeWidth'],
    } });
    m.addLayer({ id: 'wind', type: 'symbol', source: 'wind', layout: {
      'icon-image': 'wind-arrow', 'icon-rotate': ['get', 'angle'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    }, paint: { 'icon-opacity': 0.45 } });
    under({ id: 'storm-lines', type: 'line', source: 'storm-lines', paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 8, 2], 'line-dasharray': [2.5, 2] } });
    m.addLayer({ id: 'storm-steps', type: 'circle', source: 'storm-dots', minzoom: 7, filter: ['==', ['get', 'kind'], 'step'], paint: {
      'circle-radius': 3, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
    } });
    m.addLayer({ id: 'storm-cells', type: 'circle', source: 'storm-dots', filter: ['==', ['get', 'kind'], 'cell'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 8, 6], 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 8, 2],
    } });
    under({ id: 'coverage-outside', type: 'fill', source: 'coverage-area', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#374151', 'fill-opacity': 0.18 } });
    m.addLayer({ id: 'coverage-edge', type: 'line', source: 'coverage-area', paint: { 'line-color': '#555', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
    m.addLayer({ id: 'ruler-line', type: 'line', source: 'ruler', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#111', 'line-width': 3, 'line-dasharray': [3, 2] } });
    m.addLayer({ id: 'ruler-points', type: 'circle', source: 'ruler', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#111', 'circle-stroke-width': 3 } });
    m.addLayer({ id: 'storm-outlines-fill', type: 'fill', source: 'storm-outlines', paint: { 'fill-color': '#111', 'fill-opacity': 0.15 } });
    m.addLayer({ id: 'storm-outlines-line', type: 'line', source: 'storm-outlines', paint: { 'line-color': '#111', 'line-width': ['case', ['get', 'selected'], 3, 2] } });
    m.addLayer({ id: 'point-check-line', type: 'line', source: 'point-check', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#111', 'line-width': 3 } });
    m.addLayer({ id: 'point-check-pin', type: 'circle', source: 'point-check', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#111', 'circle-stroke-width': 3 } });
    m.addLayer({ id: 'grid-wind', type: 'symbol', source: 'grid', filter: ['has', 'angle'], layout: {
      'icon-image': 'wind-arrow', 'icon-rotate': ['get', 'angle'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'text-field': ['get', 'speed'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-allow-overlap': true, 'text-ignore-placement': true,
    }, paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
    m.addLayer({ id: 'grid-temp', type: 'symbol', source: 'grid', filter: ['has', 'label'], layout: {
      'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-offset': [0, -1.3], 'text-allow-overlap': true, 'text-ignore-placement': true,
    }, paint: { 'text-color': '#111', 'text-halo-color': '#fff', 'text-halo-width': 2 } });
    m.addLayer({ id: 'warning-county-icon', type: 'circle', source: 'warning-county-icons', paint: {
      'circle-radius': 11, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
    } });
    m.addLayer({ id: 'warning-county-glyph', type: 'symbol', source: 'warning-county-icons', layout: {
      'text-field': '!', 'text-font': ['Noto Sans Bold'], 'text-size': 16, 'text-allow-overlap': true, 'text-ignore-placement': true,
    }, paint: { 'text-color': ['get', 'fg'] } });
    this.ready = true;
    if (this.last) this.update(this.last);
  };

  private data(name: SourceName, features: Feature[]) {
    (this.map.getSource(name) as GeoJSONSource).setData(collection(features));
  }

  update(s: RadarState) {
    this.last = s;
    const key = `${s.place.lat},${s.place.lon}`;
    if (key !== this.placeKey) {
      this.placeKey = key;
      this.shift = [s.place.lat - HOME[0], s.place.lon - HOME[1]];
      this.map.jumpTo({ center: [s.place.lon, s.place.lat], zoom: HOME_ZOOM });
      this.me.setLngLat([s.place.lon, s.place.lat]);
      this.lastDraw = '';
    }
    if (!this.ready) return;
    this.drawLive(s);
    this.drawTools(s);
    this.drawLightning(s);
    this.drawLightningStrikes(s);
    this.drawReal(s);
    this.drawAlerts(s);
    const draw = JSON.stringify([s.simulated, s.active, s.frame, key]);
    if (draw !== this.lastDraw) {
      this.lastDraw = draw;
      this.drawDemo(s);
    }
  }

  /** Keep the previous image until all tiles for the selected frame are ready. */
  private drawLive(s: RadarState) {
    const m = this.map;
    const list = s.simulated || !s.active[0] ? [] : s.liveFrames;
    const wanted = new Set(list.map(f => f.url));
    for (const [url, id] of this.frames) {
      if (!wanted.has(url) && id !== this.displayedFrameSource && id !== this.currentFrameSource && id !== this.fadingFrameSource && id !== this.prewarmedFrameSource) this.dropFrame(url, id);
    }
    const cur = list[s.frame];
    for (const [url, id] of this.frames) {
      if (this.failedSources.has(id) && url !== cur?.url && id !== this.displayedFrameSource && id !== this.fadingFrameSource && id !== this.prewarmedFrameSource) this.dropFrame(url, id);
    }
    if (cur?.url && isForecast(cur)) {
      this.visitedForecasts = [...this.visitedForecasts.filter(u => u !== cur.url && this.frames.has(u)), cur.url];
      for (const url of layersToDrop(this.visitedForecasts, FORECAST_LAYERS_KEPT, cur.url)) {
        const id = this.frames.get(url);
        if (id && id !== this.displayedFrameSource && id !== this.currentFrameSource && id !== this.fadingFrameSource && id !== this.prewarmedFrameSource) this.dropFrame(url, id);
      }
      this.visitedForecasts = this.visitedForecasts.slice(-FORECAST_LAYERS_KEPT);
    }
    if (!cur?.url) {
      this.cancelFrameFade();
      this.frames.forEach(id => { m.setPaintProperty(id, 'raster-opacity', 0); m.setLayoutProperty(id, 'visibility', 'none'); });
      this.currentFrameSource = this.displayedFrameSource = null;
      this.prewarmedFrameSource = null;
      this.reportFrameReady();
      return;
    }
    const id = this.ensureFrame(cur);
    if (this.currentFrameSource !== id) {
      const abandoned = this.currentFrameSource;
      this.cancelFrameFade();
      if (abandoned && abandoned !== this.displayedFrameSource && abandoned !== this.prewarmedFrameSource && m.getLayer(abandoned)) {
        m.setLayoutProperty(abandoned, 'visibility', 'none');
      }
      this.readyReported = false;
      this.frameReadyCallback?.(false, true);
    }
    if (this.prewarmedFrameSource === id) this.prewarmedFrameSource = null;
    this.currentFrameSource = id;
    if (m.getLayoutProperty(id, 'visibility') !== 'visible') m.setLayoutProperty(id, 'visibility', 'visible');
    this.reportFrameReady();
  }

  private ensureFrame(frame: RadarFrame): string {
    const url = frame.url;
    if (!url) throw new Error('Cannot render a radar frame without imagery');
    const existing = this.frames.get(url);
    if (existing) return existing;
    const id = `frame-${this.nextFrame++}`;
    this.map.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, maxzoom: frame.maxZoom ?? FLAT_MAX_ZOOM });
    this.map.addLayer({ id, type: 'raster', source: id, paint: {
      'raster-opacity': 0, 'raster-opacity-transition': { duration: FRAME_BLEND_MS, delay: 0 },
      'raster-fade-duration': 0, 'raster-resampling': 'nearest',
    } }, 'watch-fill');
    this.frames.set(url, id);
    return id;
  }

  private dropFrame(url: string, id: string) {
    this.map.removeLayer(id); this.map.removeSource(id);
    this.preparedFrames.delete(id);
    this.frames.delete(url); this.failedSources.delete(id);
  }

  private reportFrameReady() {
    const id = this.currentFrameSource;
    const failed = !!id && this.failedSources.has(id);
    const ready = !!id && (failed || (this.preparedFrames.has(id) && this.map.isSourceLoaded(id)));
    if (ready && !failed && id !== this.displayedFrameSource) this.revealFrame(id!);
    if (ready) this.prewarmNextFrame();
    if (ready !== this.readyReported) { this.readyReported = ready; this.frameReadyCallback?.(ready, !this.failedSources.has(this.currentFrameSource!)); }
  }

  private prewarmNextFrame() {
    const state = this.last;
    const next = state?.playing && state.liveFrames.length > 1 ? state.liveFrames[(state.frame + 1) % state.liveFrames.length] : null;
    const wanted = next?.url && isForecast(next) ? this.ensureFrame(next) : null;
    if (this.prewarmedFrameSource && this.prewarmedFrameSource !== wanted && this.prewarmedFrameSource !== this.currentFrameSource && this.map.getLayer(this.prewarmedFrameSource)) {
      this.map.setLayoutProperty(this.prewarmedFrameSource, 'visibility', 'none');
    }
    this.prewarmedFrameSource = wanted;
    if (wanted && this.map.getLayoutProperty(wanted, 'visibility') !== 'visible') this.map.setLayoutProperty(wanted, 'visibility', 'visible');
  }

  private cancelFrameFade() {
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    if (this.fadingFrameSource && this.map.getLayer(this.fadingFrameSource)) {
      this.map.setPaintProperty(this.fadingFrameSource, 'raster-opacity', 0);
      this.map.setLayoutProperty(this.fadingFrameSource, 'visibility', 'none');
    }
    this.fadingFrameSource = null;
  }

  private revealFrame(next: string) {
    const previous = this.displayedFrameSource;
    this.displayedFrameSource = next;
    this.map.setLayoutProperty(next, 'visibility', 'visible');
    this.map.setPaintProperty(next, 'raster-opacity', RADAR_OPACITY);
    if (!previous || previous === next || !this.map.getLayer(previous)) return;
    this.map.setPaintProperty(previous, 'raster-opacity', 0);
    this.fadingFrameSource = previous;
    this.fadeTimer = setTimeout(() => {
      if (this.fadingFrameSource !== previous || !this.map.getLayer(previous)) return;
      this.map.setLayoutProperty(previous, 'visibility', 'none');
      this.fadingFrameSource = null;
      this.fadeTimer = null;
      const oldUrl = [...this.frames].find(([, id]) => id === previous)?.[0];
      if (oldUrl && !this.last?.liveFrames.some(frame => frame.url === oldUrl)) this.dropFrame(oldUrl, previous);
    }, FRAME_BLEND_MS + 40);
  }

  private drawTools(s: RadarState) {
    const m = this.map;
    const picking = s.mapPicking || s.pickingStorm;
    if (picking) m.doubleClickZoom.disable(); else m.doubleClickZoom.enable();
    const key = JSON.stringify([s.rulerPoints, s.pointCheck, s.showCoverage, s.coverageExtent, s.stormOutlines?.map(o => [o.id, o.at]), s.selectedOutlineId]);
    if (key !== this.toolKey) {
      this.toolKey = key;
      const pts = s.rulerPoints ?? [];
      const features = pts.map(p => point([p.lat, p.lon]));
      if (pts.length === 2) features.push(line(pts.map(p => [p.lat, p.lon] as LL)));
      this.data('ruler', features);
      this.data('storm-outlines', outlineFeatures(s.stormOutlines ?? [], s.selectedOutlineId ?? null));
      const pc = s.pointCheck;
      this.data('point-check', pc ? [point([pc.spot.lat, pc.spot.lon]), ...(pc.from ? [line([[pc.from.lat, pc.from.lon], [pc.spot.lat, pc.spot.lon]])] : [])] : []);
      const e = s.showCoverage ? s.coverageExtent : null;
      this.data('coverage-area', e ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
        [[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]],
        [[e.west,e.south],[e.west,e.north],[e.east,e.north],[e.east,e.south],[e.west,e.south]],
      ] } }] : []);
    }
    const url = s.showCoverage ? s.coverageTiles ?? null : null, id = 'coverage-mask';
    if (url === this.coverageUrl) return;
    if (m.getLayer(id)) { m.removeLayer(id); m.removeSource(id); }
    this.coverageUrl = url;
    if (url) {
      m.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, maxzoom: 7 });
      m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.3, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 'watch-fill');
    }
  }

  private drawLightning(s: RadarState) {
    const m = this.map, url = !s.simulated && s.active[2] ? s.lightning : null, id = 'lightning-tiles';
    if (url === this.lightningUrl) return;
    if (this.lightningUrl) { m.removeLayer(id); m.removeSource(id); }
    this.lightningUrl = url;
    if (!url) return;
    m.addSource(id, { type: 'raster', tiles: [url], tileSize: 256, maxzoom: FLAT_MAX_ZOOM });
    m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0, 'raster-resampling': 'nearest' } }, 'watch-fill');
  }

  private drawLightningStrikes(s: RadarState) {
    const visible = new Set(!s.simulated && s.active[2] ? s.lightningStrikes.map(x => x.id) : []);
    for (const [id, marker] of this.lightningMarkers) if (!visible.has(id)) { marker.remove(); this.lightningMarkers.delete(id); }
    if (s.simulated || !s.active[2]) return;
    for (const strike of s.lightningStrikes) {
      let marker = this.lightningMarkers.get(strike.id);
      if (!marker) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'rm-lightning-icon';
        button.textContent = '⚡';
        button.addEventListener('click', e => {
          e.stopPropagation();
          if (this.last?.pickingStorm) return;
          if (this.last?.mapPicking) { this.mapPoint?.({ lat: strike.lat, lon: strike.lon }); return; }
          const current = this.last?.lightningStrikes.find(x => x.id === strike.id);
          if (current) this.pickStorm({ lat: current.lat, lon: current.lon, stormId: null, alertIds: [], lightningId: current.id });
        });
        button.addEventListener('dblclick', e => e.stopPropagation());
        marker = new Marker({ element: button }).setLngLat([strike.lon, strike.lat]).addTo(this.map);
        this.lightningMarkers.set(strike.id, marker);
      }
      marker.setLngLat([strike.lon, strike.lat]);
      const button = marker.getElement();
      button.setAttribute('aria-label', `Lightning reported ${new Date(strike.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
      button.classList.toggle('selected', this.last?.selectedLightningId === strike.id);
    }
  }

  /** Flat temperature bands, under the radar. */
  private drawTemperature(s: RadarState) {
    const m = this.map, id = 'temp-bands';
    const image = !s.simulated && s.active[4] ? temperatureImage(s.grid) : null;
    if (!image) {
      if (m.getLayer(id)) { m.removeLayer(id); m.removeSource(id); }
      this.tempUrl = '';
      return;
    }
    if (image.url === this.tempUrl) return;
    this.tempUrl = image.url;
    const src = m.getSource(id) as ImageSource | undefined;
    if (src) { src.updateImage(image); return; }
    m.addSource(id, { type: 'image', ...image });
    m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } }, 'temp');
  }

  /** Storm paths and the temperature and wind grid, from live data. */
  private drawReal(s: RadarState) {
    const next = [s.simulated, s.active[1], s.active[3], s.active[4], s.storms, s.grid, s.units, s.selectedStormId];
    if (next.every((v, i) => v === this.drawn[i])) return;
    this.drawn = next;

    const visible = new Set(!s.simulated && s.active[1] ? s.storms.map(c => c.id) : []);
    for (const [id, marker] of this.stormMarkers) if (!visible.has(id)) { marker.remove(); this.stormMarkers.delete(id); }
    const lines: Feature[] = [], dots: Feature[] = [];
    if (!s.simulated && s.active[1]) {
      for (const c of s.storms) {
        const from: LL = [c.lat, c.lon], color = c.tornado ? '#8b3ab8' : c.severe ? '#2563a6' : '#5ca33a';
        let marker = this.stormMarkers.get(c.id);
        if (!marker) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'rm-storm-icon';
          button.addEventListener('click', e => {
            e.stopPropagation();
            if (this.last?.pickingStorm) return;
            if (this.last?.mapPicking) { this.mapPoint?.({ lat: c.lat, lon: c.lon }); return; }
            const cell = this.last?.storms.find(item => item.id === c.id);
            if (cell) this.pickStorm({ lat: cell.lat, lon: cell.lon, stormId: cell.id, alertIds: [] });
          });
          button.addEventListener('dblclick', e => e.stopPropagation());
          marker = new Marker({ element: button }).setLngLat([c.lon, c.lat]).addTo(this.map);
          this.stormMarkers.set(c.id, marker);
        }
        marker.setLngLat([c.lon, c.lat]);
        const button = marker.getElement();
        button.style.setProperty('--storm-color', color);
        button.classList.toggle('selected', s.selectedStormId === c.id);
        button.setAttribute('aria-pressed', String(s.selectedStormId === c.id));
        const label = `${c.tornado ? 'Rotation signature' : c.severe ? 'Strong storm' : 'Storm'} ${c.id}`;
        button.setAttribute('aria-label', label); button.title = label;
        button.innerHTML = c.tornado
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18M5 8h14M7 12h10M9 16h6M11 20h2"/></svg>'
          : c.severe ? '<span aria-hidden="true">!!!</span>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13a4 4 0 0 1 0-8 6 6 0 0 1 11-1 4 4 0 1 1 2 9M7 16l-2 4M12 16l-2 4M17 16l-2 4"/></svg>';
        const rad = (c.heading * Math.PI) / 180;
        const at = (min: number) => { const km = c.mph * 1.60934 * (min / 60); return off(from, km * Math.sin(rad), km * Math.cos(rad)); };
        if (c.mph > 0) {
          lines.push({ ...line([from, at(45)]), properties: { color } });
          STORM_STEPS.forEach(min => dots.push(point(at(min), { kind: 'step', color })));
        }
        dots.push(point(from, { kind: 'cell', color, id: c.id }));
      }
    }
    this.data('storm-lines', lines);
    this.data('storm-dots', dots);

    const grid: Feature[] = [];
    if (!s.simulated && (s.active[3] || s.active[4])) {
      for (const p of s.grid) {
        grid.push(point([p.lat, p.lon], {
          ...(s.active[3] ? { angle: p.windFrom + 90, speed: `${Math.round(p.windMph)} mph` } : {}), // the arrow image points east
          ...(s.active[4] ? { label: temp(p.tempF, s.units) } : {}),
        }));
      }
    }
    this.data('grid', grid);
    this.drawTemperature(s);
  }

  private drawAlerts(s: RadarState) {
    const list = s.simulated ? [] : s.alerts.filter(a => a.geometry);
    const countyAlerts = s.simulated ? [] : s.alerts.filter(a => a.countyFips?.length);
    const key = JSON.stringify(s.simulated ? [] : s.alerts.map(a => [a.id, a.geometry, a.countyFips]));
    if (key === this.alertKey) return;
    this.alertKey = key;
    this.alertPopup?.remove();
    this.alertPopup = null;
    this.data('alerts', list.map(a => ({ type: 'Feature', properties: { color: ALERT_COLOR[a.level], id: a.id }, geometry: a.geometry! })));
    this.data('warning-counties', []);
    this.data('warning-county-icons', []);
    if (!countyAlerts.length) return;
    void loadWarningCounties().then(counties => {
      if (!this.ready || key !== this.alertKey) return;
      const byCounty = new Map<string, WeatherAlert[]>();
      for (const alert of countyAlerts) for (const id of alert.countyFips ?? []) {
        if (!counties.has(id)) continue;
        byCounty.set(id, [...(byCounty.get(id) ?? []), alert]);
      }
      const highlighted: Feature[] = [], icons: Feature[] = [];
      for (const [id, alerts] of byCounty) {
        const county = counties.get(id)!;
        const color = ALERT_COLOR[alerts[0].level];
        highlighted.push({ type: 'Feature', properties: { id, color }, geometry: county.geometry });
        icons.push({ type: 'Feature', properties: { id, name: county.name, color, fg: ALERT_ICON_FG[alerts[0].level] }, geometry: { type: 'Point', coordinates: county.icon } });
      }
      this.data('warning-counties', highlighted);
      this.data('warning-county-icons', icons);
    }).catch(() => {});
  }

  private showCountyAlert(id: string, countyName: string, at: [number, number]) {
    const alerts = this.last?.alerts.filter(alert => alert.countyFips?.includes(id)) ?? [];
    if (!alerts.length) return;
    this.alertPopup?.remove();
    const root = document.createElement('div');
    root.className = 'warning-county-popup';
    const heading = document.createElement('div');
    heading.className = 'county-name';
    heading.textContent = `${countyName} · NWS alerts`;
    root.append(heading);
    for (const alert of alerts) {
      const section = document.createElement('section');
      const title = document.createElement('strong');
      title.textContent = alert.title;
      section.append(title);
      for (const value of [alert.area, alert.when, alert.sender, alert.body]) {
        if (!value) continue;
        const paragraph = document.createElement('p');
        paragraph.textContent = value;
        section.append(paragraph);
      }
      if (alert.instructionText) {
        const instruction = document.createElement('p');
        instruction.textContent = `What to do: ${alert.instructionText}`;
        section.append(instruction);
      }
      root.append(section);
    }
    const note = document.createElement('p');
    note.className = 'county-warning-note';
    note.textContent = 'County shading shows where an alert lists the county. Use the NWS text and any published polygon for the specific affected area.';
    root.append(note);
    this.alertPopup = new Popup({ closeButton: true, closeOnClick: false, maxWidth: '360px', className: 'nws-warning-popup' })
      .setLngLat(at).setDOMContent(root).addTo(this.map);
  }

  private marker(p: LL, className: string, text = '', opacity = 1, anchor: 'center' | 'top-left' = 'center', offset: [number, number] = [0, 0]) {
    const el = Object.assign(document.createElement('div'), { className, textContent: text });
    el.style.opacity = String(opacity);
    this.markers.push(new Marker({ element: el, anchor, offset }).setLngLat(xy(p) as [number, number]).addTo(this.map));
  }

  private drawDemo(s: RadarState) {
    this.markers.forEach(x => x.remove());
    this.markers = [];
    const at = (c: LL): LL => [c[0] + this.shift[0], c[1] + this.shift[1]];
    const f = s.frame, a = s.active, on = s.simulated;

    this.data('watch', on ? [polygon(WATCH.map(at))] : []);
    if (on) this.marker(at([40.27, -74.7]), 'rm-watch', 'Demo watch area', 1, 'top-left');

    const grow = 1 + 0.04 * (f - NOW);
    const precip: Feature[] = [];
    if (on && (a[0] || a[1] || a[2])) {
      this.map.setPaintProperty('precip', 'fill-opacity', a[0] ? 0.78 : a[1] ? 0.45 : 0.28);
      CELLS.forEach(cell => {
        const c = move(at(cell.c), f);
        cell.bands.forEach(([rx, ry], i) => precip.push(polygon(blob(c, rx * grow, ry * grow, cell.rot, cell.seed + i * 0.7), { color: BAND[i] })));
      });
    }
    this.data('precip', precip);

    const tracks: Feature[] = [], dots: Feature[] = [];
    if (on && a[1]) {
      [CELLS[0], CELLS[1]].forEach((cell, k) => {
        const p = move(at(cell.c), f), len = k ? 35 : 62, rad = (BEARING * Math.PI) / 180;
        if (!k) {
          const l = ((BEARING - 17) * Math.PI) / 180, r = ((BEARING + 17) * Math.PI) / 180;
          tracks.push(polygon([p, off(p, len * Math.sin(l), len * Math.cos(l)), off(p, len * Math.sin(r), len * Math.cos(r))]));
        }
        tracks.push(line([p, off(p, len * Math.sin(rad), len * Math.cos(rad))]));
        dots.push(point(p, { radius: k ? 10 : 14, fill: '#111', fillOpacity: 0, stroke: '#111', strokeWidth: 3 }));
        (k ? [[25, 0.9]] : [[20, 2 / 3], [50, 5 / 3]]).forEach(([min, fr]) => {
          const q = off(p, VX * fr, VY * fr);
          dots.push(point(q, { radius: 5, fill: '#111', fillOpacity: 1, stroke: '#fff', strokeWidth: 2 }));
          this.marker(q, 'rm-tag', timeLabel(f, min), 1, 'top-left', [8, -22]);
        });
      });
    }
    this.data('tracks', tracks);
    this.data('track-dots', dots);

    if (on && a[2]) {
      const R = rand(97 + f * 13);
      ([[CELLS[0], 26, 9, 22], [CELLS[1], 12, 5, 7], [CELLS[2], 10, 4, 3]] as const).forEach(([cell, rx, ry, n]) => {
        const c = move(at(cell.c), f), r = (cell.rot * Math.PI) / 180;
        for (let i = 0; i < n; i++) {
          const t = R() * Math.PI * 2, d = Math.sqrt(R()), x = rx * d * Math.cos(t), y = ry * d * Math.sin(t);
          const pt = off(c, x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)), age = R();
          this.marker(pt, `rm-strike${age < 0.25 ? ' big' : ''}`, '', 1 - age * 0.65);
        }
      });
    }

    const arrows: Feature[] = [];
    if (on && a[3]) {
      for (let lat = 39.1; lat < 42.5; lat += 0.2) {
        for (let lng = -76.8 + ((lat * 5) % 2 ? 0.13 : 0); lng < -71; lng += 0.26) {
          arrows.push(point(at([lat, lng]), { angle: -22 + 14 * Math.sin(lat * 3 + lng * 2) }));
        }
      }
    }
    this.data('wind', arrows);

    const temp: Feature[] = [];
    if (on && a[4]) {
      ([[[39.5, -75.9], 190, '#f0954a'], [[40.45, -74.6], 120, '#f2d65a'], [[41.9, -72.3], 200, '#8fb4e8'], [[41.6, -75.4], 110, '#b9d3f0']] as [LL, number, string][])
        .forEach(([c, km, color]) => temp.push(polygon(circle(at(c), km), { color, opacity: 0.28 })));
      temp.push(polygon(blob(move(at(CELLS[0].c), f), 30, 14, 32, 8), { color: '#8fb4e8', opacity: 0.35 }));
      ([[[40.73, -73.99], 72], [[40.74, -74.17], 74], [[39.95, -75.16], 79], [[40.22, -74.76], 68], [[41.31, -72.92], 67], [[41.76, -72.68], 65], [[41.41, -75.66], 63], [[40.79, -73.2], 69]] as [LL, number][])
        .forEach(([c, t]) => this.marker(at(c), 'rm-temp', `${t}°`));
    }
    this.data('temp', temp);
  }
}
