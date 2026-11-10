import { Check, MapPin, Search, Settings2, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { findSaved, orderPlaces, savePlace } from '@/lib/places';
import { useSettings } from '@/lib/settings';
import type { Place } from '@/lib/types';
import { usePlaceSearch } from '@/lib/usePlaceSearch';

/** The dock's location tool: switches the main location, or finds and adds a new one. */
export function PlaceMenu({ place, onManage }: { place: Place; onManage: () => void }) {
  const { s, set } = useSettings();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const { results, status } = usePlaceSearch(query);
  const searching = query.trim().length >= 2;

  const close = () => { setOpen(false); setQuery(''); };
  const choose = (p: Place) => {
    set(c => ({ places: savePlace(c.places, p), defaultPlace: findSaved(c.places, p)?.id ?? p.id, gps: false }));
    close();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  return (
    <div className="place-menu" ref={root}>
      <button type="button" className={open ? 'on' : ''} aria-label={`Location: ${place.name}`} aria-expanded={open} aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}>
        <MapPin size={18} aria-hidden />
        {!open && <span className="tip tip-up">{place.name}</span>}
      </button>
      {open && (
        <div className="place-pop" role="dialog" aria-label="Choose a location">
          <div className="place-field">
            <Search size={16} aria-hidden />
            <input
              autoFocus
              value={query}
              placeholder="Find a city or ZIP code"
              aria-label="Find a city or ZIP code"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') close();
                if (e.key === 'Enter' && searching && results[0]) choose(results[0]);
              }}
            />
          </div>
          <div className="place-list">
            {searching ? (
              <>
                {results.map(p => (
                  <button type="button" key={p.id} onClick={() => choose(p)}>
                    <i />
                    <span className="place-row"><span>{p.name}</span><span className="region">{p.region}</span></span>
                  </button>
                ))}
                {!results.length && (
                  <div className="note">
                    {status === 'failed' ? 'Search isn’t available right now.' : status === 'done' ? 'No US places found.' : 'Searching…'}
                  </div>
                )}
              </>
            ) : orderPlaces(s.places).map(p => (
              <button type="button" key={p.id} onClick={() => choose(p)}>
                {p.favorite ? <Star size={14} fill="currentColor" aria-label="Favorite" /> : <i />}
                <span>{p.name}</span>
                {p.id === place.id && <Check size={16} aria-label="Main location" />}
              </button>
            ))}
          </div>
          <button type="button" className="manage" onClick={() => { close(); onManage(); }}>
            <Settings2 size={14} aria-hidden /><span>Manage locations</span>
          </button>
        </div>
      )}
    </div>
  );
}
