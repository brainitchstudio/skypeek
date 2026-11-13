import { Check, ChevronDown, MapPin, Menu, Settings2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NAV_ITEMS } from './Switcher';
import { findSaved, orderPlaces, savePlace } from '@/lib/places';
import { useSettings, type Screen } from '@/lib/settings';
import type { Place } from '@/lib/types';

export function MobileNav({ active, badge, place, onSelect, onManagePlaces }: {
  active: Screen; badge: boolean; place: Place; onSelect: (screen: Screen) => void; onManagePlaces: () => void;
}) {
  const { s, set } = useSettings();
  const [open, setOpen] = useState(false);
  const [showPlaces, setShowPlaces] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const current = active === 'alertDetail' ? 'alerts' : active;

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const close = () => { setOpen(false); setShowPlaces(false); };
  const choosePlace = (chosen: Place) => {
    set(settings => ({
      places: savePlace(settings.places, chosen),
      defaultPlace: findSaved(settings.places, chosen)?.id ?? chosen.id,
      gps: false,
    }));
    close();
  };

  return (
    <div className="mobile-nav">
      {open && <button className="mobile-nav-backdrop" type="button" aria-label="Close menu" onClick={close} />}
      {open && (
        <nav className="mobile-nav-panel" aria-label="Mobile main">
          <div className="mobile-nav-heading"><strong>Menu</strong></div>
          <div className="mobile-nav-links">
            {NAV_ITEMS.map(([screen, label, Glyph], index) => (
              <button key={screen} ref={index === 0 ? firstItem : undefined} type="button" className={current === screen ? 'on' : ''}
                aria-current={current === screen ? 'page' : undefined} onClick={() => { close(); onSelect(screen); }}>
                <Glyph size={20} aria-hidden /><span>{label}</span>
                {screen === 'alerts' && badge && <i className="mobile-nav-alert-dot" aria-label="Active alerts" />}
              </button>
            ))}
          </div>
          <div className="mobile-nav-places">
            <button type="button" className="mobile-nav-place-toggle" aria-expanded={showPlaces} onClick={() => setShowPlaces(value => !value)}>
              <MapPin size={20} aria-hidden /><span><small>LOCATION</small>{place.name}</span><ChevronDown size={18} className={showPlaces ? 'open' : ''} aria-hidden />
            </button>
            {showPlaces && <div className="mobile-nav-place-list">
              {orderPlaces(s.places).map(saved => <button type="button" key={saved.id} onClick={() => choosePlace(saved)}>
                <span>{saved.name}</span>{saved.id === place.id && <Check size={18} aria-label="Current location" />}
              </button>)}
              <button type="button" onClick={() => { close(); onManagePlaces(); }}><Settings2 size={18} aria-hidden />Find or manage locations</button>
            </div>}
          </div>
        </nav>
      )}
      <button ref={trigger} type="button" className="mobile-nav-trigger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}
        onClick={() => { if (open) close(); else setOpen(true); }}>
        {open ? <X size={23} aria-hidden /> : <Menu size={23} aria-hidden />}
        {badge && !open && <i className="mobile-nav-alert-dot" aria-label="Active alerts" />}
      </button>
    </div>
  );
}
