import { Search, Star, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { looksLikeStreetAddress } from '@/lib/address';
import { findSaved, orderPlaces, savePlace, toggleFavorite } from '@/lib/places';
import { searchAddress } from '@/lib/searchAddress';
import { useSettings } from '@/lib/settings';
import type { Place } from '@/lib/types';
import { usePlaceSearch } from '@/lib/usePlaceSearch';

export function RadarSearch({ onPick, onClose }: { onPick: (p: Place) => void; onClose: () => void }) {
  const { s, set } = useSettings();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(false);
  const [selected, setSelected] = useState<Place | null>(null);
  const requestId = useRef(0);
  const [addressResults, setAddressResults] = useState<Place[]>([]);
  const [addressStatus, setAddressStatus] = useState<'idle' | 'searching' | 'done' | 'failed'>('idle');
  const addressQuery = looksLikeStreetAddress(query);
  const { results: cityResults, status: cityStatus } = usePlaceSearch(picked || addressQuery ? '' : query);
  const results = picked && selected ? [selected] : addressQuery ? addressResults : cityResults;
  const status = addressQuery ? addressStatus : cityStatus;

  const lookupAddress = async () => {
    if (addressStatus === 'searching') return;
    const id = ++requestId.current;
    setPicked(false);
    setSelected(null);
    setAddressResults([]);
    setAddressStatus('searching');
    try {
      const found = await searchAddress(query.trim());
      if (id !== requestId.current) return;
      setAddressResults(found);
      setAddressStatus('done');
      if (found.length === 1) pick(found[0]);
    } catch {
      if (id === requestId.current) setAddressStatus('failed');
    }
  };

  const pick = (p: Place) => {
    setQuery(p.name);
    setPicked(true);
    setSelected(p);
    onPick(p);
  };

  return (
    <div className="radar-search">
      <div className="field-row">
        <Search size={16} aria-hidden />
        <input
          autoFocus
          value={query}
          placeholder="City, ZIP, or US street address"
          aria-label="City, ZIP, or US street address"
          onChange={e => { requestId.current++; setQuery(e.target.value); setPicked(false); setSelected(null); setAddressResults([]); setAddressStatus('idle'); }}
          onKeyDown={e => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter') {
              if (addressQuery && !picked) void lookupAddress();
              else if (results[0]) pick(results[0]);
            }
          }}
        />
        <button type="button" aria-label="Close search" onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      {!query.trim() && <div className="results" aria-label="Saved places">
        <div className="note">Saved places</div>
        {orderPlaces(s.places).map(p => <button type="button" key={p.id} onClick={() => pick(p)}>{p.favorite ? '★ ' : ''}{p.name}</button>)}
      </div>}
      {addressQuery && !picked && addressStatus === 'idle' && <div className="results">
        <button type="button" className="address-action" onClick={() => void lookupAddress()}>Search this address</button>
        <div className="note">Include city and state or ZIP code. The pin is an approximate street location.</div>
      </div>}
      {query.trim().length >= 2 && (picked || !addressQuery || addressStatus !== 'idle') && (
        <div className="results">
          {results.map(p => (
            <div className="result" key={p.id}>
              <button type="button" className="go" onClick={() => pick(p)}>
                <span>{p.name}</span><span className="region">{p.region}</span>
              </button>
              <button type="button" className="main" onClick={() => {
                set(c => ({ places: savePlace(c.places, p), defaultPlace: findSaved(c.places, p)?.id ?? p.id, gps: false }));
                onClose();
              }}>Make main</button>
              <button type="button" className="save" onClick={() => set(c => ({ places: savePlace(c.places, p) }))}
                disabled={!!findSaved(s.places, p)}>{findSaved(s.places, p) ? 'Saved' : 'Save'}</button>
              <button type="button" className="star" aria-label={`Favorite ${p.name}`} aria-pressed={!!findSaved(s.places, p)?.favorite}
                onClick={() => set(c => ({ places: toggleFavorite(c.places, p) }))}>
                <Star size={16} fill={findSaved(s.places, p)?.favorite ? 'currentColor' : 'none'} aria-hidden />
              </button>
            </div>
          ))}
          {!results.length && !picked && (
            <div className="note">
              {status === 'failed' ? 'Search isn’t available right now.' : status === 'done' ? 'No US places found.' : addressQuery && status === 'idle' ? '' : 'Searching…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
