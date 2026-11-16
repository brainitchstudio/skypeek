import { ChevronDown, MapPin, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NAV_ITEMS } from './Switcher';
import { useLocation } from './LocationPicker';
import type { Screen } from '@/lib/settings';
import type { Place } from '@/lib/types';

export function MobileNav({ active, badge, place, onSelect }: {
  active: Screen; badge: boolean; place: Place; onSelect: (screen: Screen) => void;
}) {
  const { openPicker } = useLocation();
  const [open, setOpen] = useState(false);
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

  const close = () => setOpen(false);

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
            <button type="button" className="mobile-nav-place-toggle" aria-haspopup="dialog" onClick={() => { close(); openPicker(); }}>
              <MapPin size={20} aria-hidden /><span><small>LOCATION</small>{place.name}</span><ChevronDown size={18} aria-hidden />
            </button>
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
