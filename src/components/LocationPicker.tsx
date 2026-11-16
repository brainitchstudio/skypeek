'use client';

import { Check, ChevronDown, LocateFixed, MapPin, RefreshCw, Settings2, X } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { orderPlaces } from '@/lib/places';
import { useActiveLocation } from '@/lib/useActiveLocation';
import { useSettings } from '@/lib/settings';

type LocationState = ReturnType<typeof useActiveLocation> & { openPicker: () => void };
const Context = createContext<LocationState | null>(null);
export function useLocation() {
  const value = useContext(Context);
  if (!value) throw new Error('LocationProvider is required');
  return value;
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const location = useActiveLocation();
  const { s, set } = useSettings();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const openPicker = () => { returnFocus.current = document.activeElement as HTMLElement; setOpen(true); };
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else {
      dialog.current?.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      else if (returnFocus.current) document.querySelector<HTMLButtonElement>('.mobile-nav-trigger')?.focus();
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return <Context.Provider value={{ ...location, openPicker }}>
    {children}
    <dialog ref={dialog} className="location-dialog" aria-labelledby="location-picker-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}
      onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setOpen(false); } }}>
      <div className="location-picker-heading"><h2 id="location-picker-title">Weather location</h2><button type="button" autoFocus aria-label="Close locations" onClick={() => setOpen(false)}><X size={22} /></button></div>
      <div className="location-picker-list">
        <button type="button" className="location-picker-row" onClick={() => { location.refreshLocation(); }} aria-pressed={s.gps}>
          <LocateFixed size={22} aria-hidden /><span><strong>Use my location</strong><small>{location.deviceName}</small></span>{s.gps && <Check size={20} aria-label="Selected" />}
        </button>
        {s.gps && <div className="location-picker-status" role="status"><p>{location.status}</p>{location.error && <p className="location-picker-error">{location.error}</p>}
          <button className="location-retry" type="button" disabled={location.locating} onClick={location.refreshLocation}><RefreshCw size={14} aria-hidden />{location.locating ? 'Finding location…' : 'Refresh location'}</button></div>}
        <h3>Saved places</h3>
        {orderPlaces(s.places).map(p => <button key={p.id} type="button" className="location-picker-row" aria-pressed={!s.gps && p.id === location.place.id}
          onClick={() => { location.chooseSaved(p); setOpen(false); }}>
          <MapPin size={20} aria-hidden /><span><strong>{p.name}</strong><small>{p.region}{p.id === s.defaultPlace ? ' · Main location' : ''}</small></span>
          {!s.gps && p.id === location.place.id && <Check size={20} aria-label="Selected" />}
        </button>)}
      </div>
      <button type="button" className="location-manage" onClick={() => { setOpen(false); set({ screen: 'settings', setTab: 'locations' }); }}><Settings2 size={18} aria-hidden />Find or manage locations</button>
      <div className="location-attribution">Place references: NWS · US Census. Map details: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">OpenMapTiles</a></div>
    </dialog>
  </Context.Provider>;
}

export function TodayLocation({ weekday }: { weekday?: string | false | null }) {
  const location = useLocation();
  return <div className="today-location">
    <button type="button" className="today-loc today-location-button" onClick={location.openPicker} aria-haspopup="dialog" aria-label={`Weather location: ${location.place.name}. Change location`}>
      <span>{location.place.name}</span><ChevronDown size={19} aria-hidden />
    </button>
    <div className="live-note location-detail">{[location.detail, weekday].filter(Boolean).join(' · ')}</div>
    <div className="live-note location-status" role="status">{location.status}</div>
  </div>;
}
