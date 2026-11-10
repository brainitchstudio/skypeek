import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

export const SLOT = 'boundary-county'; // weather overlays are stacked just beneath this layer
export const COUNTY_LOW_MAX_ZOOM = 9; // below this the vector tiles have no county lines

type Palette = {
  land: string; water: string; park: string | null; wood: string | null; urban: string | null;
  motorway: string; major: string; minor: string; rail: string; roadEdge: string;
  building: string; buildingEdge: string; path: string;
  county: string; state: string; country: string;
  label: string; labelSoft: string; halo: string; waterLabel: string;
};

const LIGHT: Palette = {
  land: '#ffffff', water: '#cfe9f8', park: null, wood: null, urban: null,
  motorway: '#ffffff', major: '#ffffff', minor: '#ffffff', rail: '#111111', roadEdge: '#111111',
  building: '#ffffff', buildingEdge: '#111111', path: '#111111',
  county: '#111111', state: '#111111', country: '#111111',
  label: '#111111', labelSoft: '#111111', halo: '#ffffff', waterLabel: '#111111',
};
const SATELLITE: Palette = {
  land: '#1d2320', water: '#1d2320', park: null, wood: null, urban: null,
  motorway: '#f2f2ee', major: '#d9d9d3', minor: '#d9d9d3', rail: '#d9d9d3',
  roadEdge: '#111111', building: '#ffffff', buildingEdge: '#ffffff', path: '#e3e3dd',
  county: '#ffffffaa', state: '#ffffff', country: '#ffffff',
  label: '#ffffff', labelSoft: '#f1f1ed', halo: '#111111', waterLabel: '#cfe2f0',
};

const name: ExpressionSpecification = ['coalesce', ['get', 'name_en'], ['get', 'name']];
const REGULAR = ['Noto Sans Regular'], BOLD = ['Noto Sans Bold'];

/** Road width in pixels, growing with zoom. */
const width = (base: number): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.5], ['zoom'], 6, base * 0.35, 10, base, 14, base * 3.5, 18, base * 12];

export function buildStyle(basemap: number): StyleSpecification {
  const satellite = basemap === 2;
  const p = satellite ? SATELLITE : LIGHT;
  const om = { source: 'openmaptiles' };
  const road = (id: string, classes: string[], color: string, base: number, minzoom: number): LayerSpecification => ({
    ...om, id, type: 'line', 'source-layer': 'transportation', minzoom,
    filter: ['all', ['match', ['get', 'class'], classes, true, false], ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width(base), ...(satellite ? { 'line-opacity': 0.55 } : {}) },
  });
  const roadPair = (id: string, classes: string[], color: string, base: number, minzoom: number): LayerSpecification[] =>
    satellite ? [road(id, classes, color, base, minzoom)] : [
      road(`${id}-edge`, classes, p.roadEdge, base + 0.45, minzoom),
      road(id, classes, color, base, minzoom),
    ];
  const place = (id: string, cls: string, minzoom: number, font: string[], sizes: number[], color: string): LayerSpecification => ({
    ...om, id, type: 'symbol', 'source-layer': 'place', minzoom,
    filter: ['==', ['get', 'class'], cls],
    layout: {
      'text-field': name, 'text-font': font, 'text-max-width': 8,
      'text-size': ['interpolate', ['linear'], ['zoom'], ...sizes] as ExpressionSpecification,
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: { 'text-color': color, 'text-halo-color': p.halo, 'text-halo-width': 1.5 },
  });

  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': p.land } },
    ...(satellite ? [{ id: 'imagery', type: 'raster', source: 'imagery' } as LayerSpecification] : []),
    ...(p.urban ? [{ ...om, id: 'urban', type: 'fill', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'residential'], paint: { 'fill-color': p.urban } } as LayerSpecification] : []),
    ...(p.wood ? [{ ...om, id: 'wood', type: 'fill', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': p.wood } } as LayerSpecification] : []),
    ...(p.park ? [{ ...om, id: 'park', type: 'fill', 'source-layer': 'park', paint: { 'fill-color': p.park } } as LayerSpecification] : []),
    ...(!satellite ? [
      { ...om, id: 'water', type: 'fill', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': p.water } } as LayerSpecification,
      { ...om, id: 'waterway', type: 'line', 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': p.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2.5] } } as LayerSpecification,
    ] : []),
    ...(!satellite ? [
      { ...om, id: 'building-fill', type: 'fill', 'source-layer': 'building', minzoom: 13,
        paint: { 'fill-color': p.building, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.55, 15, 0.9] } } as LayerSpecification,
      { ...om, id: 'path', type: 'line', 'source-layer': 'transportation', minzoom: 13,
        filter: ['==', ['get', 'class'], 'path'],
        paint: { 'line-color': p.path, 'line-width': width(0.35), 'line-dasharray': [2, 2] } } as LayerSpecification,
    ] : []),
    ...roadPair('road-service', ['service'], p.minor, 0.6, 13),
    ...roadPair('road-minor', ['minor'], p.minor, 0.95, 11),
    ...roadPair('road-tertiary', ['tertiary'], p.minor, 1.2, 9),
    ...roadPair('road-major', ['primary', 'secondary', 'trunk'], p.major, 1.7, 7),
    { ...om, id: 'rail', type: 'line', 'source-layer': 'transportation', minzoom: 11, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': p.rail, 'line-width': 1 } },
    ...roadPair('road-motorway', ['motorway'], p.motorway, 2, 5),

    // Everything from here up draws over radar.
    { ...om, id: SLOT, type: 'line', 'source-layer': 'boundary', minzoom: COUNTY_LOW_MAX_ZOOM,
      filter: ['all', ['==', ['get', 'admin_level'], 6], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.county, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.25] } },
    { ...om, id: 'boundary-state', type: 'line', 'source-layer': 'boundary',
      filter: ['all', ['in', ['get', 'admin_level'], ['literal', [3, 4]]], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.state, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.75, 12, 1.75] } },
    { ...om, id: 'boundary-country', type: 'line', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.country, 'line-width': 1.5 } },

    ...(!satellite ? [{ ...om, id: 'local-street-detail', type: 'line', 'source-layer': 'transportation', minzoom: 15,
      filter: ['match', ['get', 'class'], ['minor', 'service', 'tertiary'], true, false],
      paint: { 'line-color': p.roadEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.7, 18, 1.4], 'line-opacity': 0.8 } } as LayerSpecification] : []),
    ...(!satellite ? [{ ...om, id: 'building-outline', type: 'line', 'source-layer': 'building', minzoom: 15,
      paint: { 'line-color': p.buildingEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 17, 1.2], 'line-opacity': 0.85 } } as LayerSpecification] : []),

    { ...om, id: 'water-name', type: 'symbol', 'source-layer': 'water_name', minzoom: 5,
      layout: { 'text-field': name, 'text-font': REGULAR, 'text-size': 12, 'text-letter-spacing': 0.1, 'text-max-width': 7 },
      paint: { 'text-color': p.waterLabel, 'text-halo-color': p.halo, 'text-halo-width': satellite ? 1 : 0 } },
    { ...om, id: 'road-name', type: 'symbol', 'source-layer': 'transportation_name', minzoom: 12,
      filter: ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'trunk', 'minor', 'service'], true, false],
      layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': REGULAR,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 13], 'symbol-spacing': 230 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1.25 } },
    ...(!satellite ? [{ ...om, id: 'house-number', type: 'symbol', 'source-layer': 'housenumber', minzoom: 16,
      layout: { 'text-field': ['get', 'housenumber'], 'text-font': REGULAR, 'text-size': 10,
        'text-allow-overlap': false, 'text-padding': 2 },
      paint: { 'text-color': p.labelSoft, 'text-halo-color': p.halo, 'text-halo-width': 1 } } as LayerSpecification] : []),
    { ...om, id: 'road-shield', type: 'symbol', 'source-layer': 'transportation_name', minzoom: 8,
      filter: ['all', ['has', 'ref_length'], ['<=', ['to-number', ['get', 'ref_length']], 6], ['match', ['get', 'network'], ['us-interstate', 'us-highway', 'us-state'], true, false]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 280, 'icon-rotation-alignment': 'viewport',
        'text-rotation-alignment': 'viewport', 'icon-image': ['concat', ['get', 'network'], '_', ['get', 'ref_length']],
        'text-field': ['to-string', ['get', 'ref']], 'text-font': REGULAR, 'text-size': 10,
      } },
    place('place-village', 'village', 10, REGULAR, [10, 11, 14, 13], p.labelSoft),
    place('place-town', 'town', 8, REGULAR, [8, 11, 12, 14], p.label),
    place('place-state', 'state', 4, BOLD, [4, 11, 8, 14], p.labelSoft),
    place('place-city', 'city', 4, BOLD, [4, 11, 8, 14, 12, 18], p.label),
  ];

  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    sources: {
      openmaptiles: {
        type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a>',
      },
      ...(satellite ? { imagery: {
        type: 'raster' as const, tileSize: 256, maxzoom: 17,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: '<a href="https://goto.arcgisonline.com/maps/World_Imagery" target="_blank" rel="noopener noreferrer">Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community</a>',
      } } : {}),
    },
    layers,
  };
}

/** The county line color for a base map, shared with the low-zoom Census lines. */
export const countyColor = (basemap: number) => (basemap === 2 ? SATELLITE : LIGHT).county;
