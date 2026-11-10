import { noaaFetch } from './noaaTransport';
import { bench, spend } from '@/api/budget';

export const IMAGERY_SCHEME = 'radar-image';
export type ImagerySource = 'rainviewer' | 'openweather' | 'tomorrow' | 'noaa';

/** Keep provider colors, alpha and precipitation types intact. MapLibre overzooms
 * the original pixels; a flat map does not require flattening weather values. */
export const imageryTiles = (source: ImagerySource, template: string) =>
  `${IMAGERY_SCHEME}://${source}/{z}/{x}/{y}?u=${encodeURIComponent(template)}`;

export async function loadImageryTile(params: { url: string }, abort: AbortController) {
  const u = new URL(params.url);
  const source = u.hostname as ImagerySource;
  if (!['rainviewer', 'openweather', 'tomorrow', 'noaa'].includes(source)) throw new Error('Unknown radar source');
  const [z, x, y] = u.pathname.slice(1).split('/');
  const template = u.searchParams.get('u');
  if (!template) throw new Error('Missing radar URL');
  const m = 20037508.342789244, span = 2 * m / 2 ** Number(z);
  const bbox = [-m + Number(x) * span, m - (Number(y) + 1) * span, -m + (Number(x) + 1) * span, m - Number(y) * span].join(',');
  const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{bbox-epsg-3857}', bbox);
  abort.signal.throwIfAborted();
  let response: Response;
  if (source === 'noaa') response = await noaaFetch(url, abort.signal);
  else {
    spend(source);
    response = await fetch(url, { signal: abort.signal });
    if (response.status === 429) bench(source);
    if (!response.ok) throw new Error(`Radar image failed: ${response.status}`);
  }
  if (source === 'noaa' && !response.headers.get('content-type')?.includes('image/png')) throw new Error('NOAA returned an invalid radar image');
  return { data: await response.arrayBuffer() };
}

// RainViewer Universal Blue rain scale, sampled from the published RGBA table.
// Snow uses a separate palette, so this legend explicitly describes rain only.
export const RAINVIEWER_SCALE = [
  { value: 15, color: '#88ddee' }, { value: 20, color: '#00a3e0' },
  { value: 30, color: '#005588' }, { value: 35, color: '#ffee00' },
  { value: 40, color: '#ffaa00' }, { value: 45, color: '#ff4400' },
  { value: 50, color: '#c10000' }, { value: 55, color: '#ffaaff' },
  { value: 60, color: '#ff77ff' },
];
