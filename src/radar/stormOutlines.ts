import type { Feature, Polygon } from 'geojson';
import type { StormObject } from '@/lib/probSevere';

export function outlineFeatures(storms: StormObject[], selectedId: string | null): Feature<Polygon, { id: string; selected: boolean }>[] {
  return storms.map(s => ({ type: 'Feature', properties: { id: s.id, selected: s.id === selectedId }, geometry: { type: 'Polygon', coordinates: [s.ring] } }));
}
