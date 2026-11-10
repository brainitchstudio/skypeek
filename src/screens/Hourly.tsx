import { hourSources, Pending, StaleNote } from './shared';
import { Icon } from '@/components/ui';
import { hourlyOutlook } from '@/lib/forecast';
import { clock, temp, weekdayShort } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import type { Weather } from '@/lib/useWeather';

export function HourlyScreen({ weather, selected, onSelect }: { weather: Weather; selected: number | null; onSelect: (i: number) => void }) {
  const { s } = useSettings();
  const f = weather.forecast;
  if (!f || !f.hours.length) return <Pending weather={weather} />;
  const hours = f.hours.slice(0, 31);
  const sel = selected ?? 0;
  const label = (iso: string) => clock(new Date(iso), f.timeZone);

  return (
    <div className="screen hourly">
      <div className="head">
        <h1 className="title">Hourly</h1>
        <div className="sub">{hourlyOutlook(hours, label)}</div>
        <StaleNote weather={weather} />
      </div>
      <div className="hour-strip">
        {hours.map((h, i) => {
          const d = new Date(h.start);
          const newDay = i > 0 && h.start.slice(0, 10) !== hours[i - 1].start.slice(0, 10);
          return (
            <button type="button" key={h.start} onClick={() => onSelect(i)}
              className={`hour${i === sel ? ' sel' : ''}${newDay ? ' new-day' : ''}${i === 0 ? ' now' : ''}`}>
              <div className="day">{i === 0 ? 'Today' : newDay ? weekdayShort(d, f.timeZone) : ''}</div>
              <div className="time">{i === 0 ? 'Now' : label(h.start)}</div>
              <div className="ico"><Icon kind={h.icon} /></div>
              <div className="deg">{temp(h.tempF, s.units)}</div>
              <div className="foot">
                <div className="pop">{h.pop == null ? '–' : h.pop ? `${h.pop}%${h.popKind ? '*' : ''}` : ' '}</div>
                <div className="bar"><div style={{ width: `${h.pop ?? 0}%` }} /></div>
                <div className="wind">{h.windMph == null ? '–' : `${h.windVariable ? 'Var ' : ''}${h.windMph} mph`}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="provenance">{sel === 0 ? 'Now' : label(hours[sel].start)}: {hourSources(hours[sel])}{hours.some(h => h.popKind) && !hours[sel].popKind ? ' * Not a normal hourly rain chance. Select that hour for details.' : ''}</div>
    </div>
  );
}
