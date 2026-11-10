import { noaaFetch } from './noaaTransport';
import type { RadarFrame } from '@/api/weather';
import { imageryTiles } from './imagery';
import type { RadarExtent } from './tools';
import stations from './stations.json';

export const NOAA_BASE = 'https://opengeo.ncep.noaa.gov/geoserver/';
export const NOAA_STATIONS = stations;
export const NOAA_PRODUCTS = [
  { id: 'sr_bref', name: 'Reflectivity' },
  { id: 'sr_bvel', name: 'Radial velocity' },
  { id: 'bdhc', name: 'Precipitation classification' },
  { id: 'boha', name: 'One-hour rainfall' },
  { id: 'bdsa', name: 'Storm-total rainfall' },
];

export function nearestStation(lat: number, lon: number) {
  const distance = (s: typeof stations[number]) => {
    const r = Math.PI / 180, a = (s.lat - lat) * r, b = (s.lon - lon) * r;
    return Math.sin(a / 2) ** 2 + Math.cos(lat * r) * Math.cos(s.lat * r) * Math.sin(b / 2) ** 2;
  };
  return stations.reduce((best, s) => distance(s) < distance(best) ? s : best);
}

export function noaaLayer(src: number, station: string, product: string) {
  if (src === 4) return { endpoint: 'conus/conus_bref_qcd/ows', layer: 'conus_bref_qcd' };
  if (!stations.some(s => s.id === station) || !NOAA_PRODUCTS.some(p => p.id === product)) throw new Error('Unknown NOAA radar product or station');
  const id = station.toLowerCase();
  return { endpoint: `${id}/ows`, layer: `${id}_${product}` };
}

/** Exact advertised instants only. Never manufacture intermediate scans. */
export function selectTimes(values: string, now = Date.now()): number[] {
  const all = [...new Set(values.split(',').map(s => s.trim()).filter(s => /^\d{4}-\d\d-\d\dT/.test(s) && !s.includes('/')).map(Date.parse))]
    .filter(t => Number.isFinite(t) && t <= now + 60_000 && t >= now - 3 * 3600_000).sort((a, b) => a - b);
  if (all.length <= 12) return all;
  return Array.from({ length: 12 }, (_, i) => all[Math.round(i * (all.length - 1) / 11)]);
}


const cache = new Map<string, { at: number; text: Promise<string> }>();
export async function getNoaaFrames(src: number, station: string, product: string, signal?: AbortSignal): Promise<{ frames: RadarFrame[]; now: number; legend: string; extent: RadarExtent | null }> {
  const { endpoint, layer } = noaaLayer(src, station, product);
  let hit = cache.get(endpoint);
  if (!hit || Date.now() - hit.at > 120_000) {
    // Shared metadata request has its own timeout; callers ignore obsolete results.
    const text = noaaFetch(`${NOAA_BASE}${endpoint}?service=WMS&version=1.3.0&request=GetCapabilities`).then(r => r.text());
    hit = { at: Date.now(), text }; cache.set(endpoint, hit);
    text.catch(() => cache.delete(endpoint));
    if (cache.size > 8) cache.delete(cache.keys().next().value!);
  }
  const xml = await hit.text;
  signal?.throwIfAborted();
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid NOAA metadata');
  const entry = [...doc.getElementsByTagName('Layer')].find(l => [...l.children].some(n => n.localName === 'Name' && n.textContent === layer));
  const box = entry && [...entry.children].find(n => n.localName === 'EX_GeographicBoundingBox');
  const number = (name: string) => Number(box && [...box.children].find(n => n.localName === name)?.textContent);
  const extent = box ? { west: number('westBoundLongitude'), east: number('eastBoundLongitude'), south: number('southBoundLatitude'), north: number('northBoundLatitude') } : null;
  const dim = entry && [...entry.children].find(n => n.localName === 'Dimension' && n.getAttribute('name') === 'time');
  const times = selectTimes(dim?.textContent ?? '');
  if (!times.length) throw new Error('No recent NOAA radar frames');
  const common = `${NOAA_BASE}${endpoint}?service=WMS&version=1.3.0`;
  const frames = times.map(at => {
    const params = new URLSearchParams({ request: 'GetMap', layers: layer, styles: '', format: 'image/png', transparent: 'true', crs: 'EPSG:3857', width: '256', height: '256', time: new Date(at).toISOString() });
    return { at, label: new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), maxZoom: 12,
      url: imageryTiles('noaa', `${common}&${params}&bbox={bbox-epsg-3857}`) };
  });
  return { frames, now: frames.length - 1, extent: extent && Object.values(extent).every(Number.isFinite) ? extent : null, legend: `${common}&request=GetLegendGraphic&format=image/png&layer=${layer}` };
}
