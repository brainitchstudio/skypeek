import { CalendarDays, ChartNoAxesColumn, Radar, Settings, Sun, TriangleAlert, type LucideIcon } from 'lucide-react';
import { PlaceMenu } from './PlaceMenu';
import type { Screen } from '@/lib/settings';
import type { Place } from '@/lib/types';

export const NAV_ITEMS: [Exclude<Screen, 'alertDetail'>, string, LucideIcon][] = [
  ['today', 'Today', Sun], ['hourly', 'Hourly', ChartNoAxesColumn], ['days', '10 Day', CalendarDays],
  ['radar', 'Radar', Radar], ['alerts', 'Alerts', TriangleAlert], ['settings', 'Settings', Settings],
];

export function Switcher({ active, badge, onSelect, place, onManagePlaces }: {
  active: string; badge: boolean; onSelect: (k: Screen) => void; place: Place; onManagePlaces: () => void;
}) {
  return (
    <nav className="switcher" aria-label="Main">
      <PlaceMenu place={place} onManage={onManagePlaces} />
      <span className="dock-sep" />
      {NAV_ITEMS.map(([k, label, Glyph]) => {
        const on = k === active;
        return (
          <button key={k} type="button" className={on ? 'on' : ''} aria-label={label} aria-current={on ? 'page' : undefined} onClick={() => onSelect(k)}>
            <Glyph size={18} aria-hidden />
            {k === 'alerts' && badge && !on && <span className="dot" />}
            <span className="tip tip-up">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
