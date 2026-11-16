import { Bell, CalendarDays, Radar, Sun, Wind } from 'lucide-react';

export type MockupScreen = 'Today' | 'Hourly' | '10 Day' | 'Radar' | 'Alerts' | 'Settings';

export function IOSMockupTabBar({ active }: { active: MockupScreen }) {
  const tabs = [
    ['Today', Sun], ['Hourly', Wind], ['10 Day', CalendarDays],
    ['Radar', Radar], ['Alerts', Bell],
  ] as const;

  return <nav className="ios-tabs" aria-label={`${active} mockup tabs`}>
    {tabs.map(([label, Glyph]) => <div className={active === label ? 'selected' : ''} key={label}>
      <Glyph size={21} strokeWidth={active === label ? 2.4 : 1.8}/>
      <span>{label}</span>{label === 'Alerts' && <i/>}
    </div>)}
  </nav>;
}
