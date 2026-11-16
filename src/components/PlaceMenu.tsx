import { MapPin } from 'lucide-react';
import { useLocation } from './LocationPicker';
import type { Place } from '@/lib/types';

/** Opens the same location picker used by Today and mobile navigation. */
export function PlaceMenu({ place }: { place: Place }) {
  const { openPicker } = useLocation();
  return <div className="place-menu">
    <button type="button" aria-label={`Location: ${place.name}`} aria-haspopup="dialog" onClick={openPicker}>
      <MapPin size={18} aria-hidden /><span className="tip tip-up">{place.name}</span>
    </button>
  </div>;
}
