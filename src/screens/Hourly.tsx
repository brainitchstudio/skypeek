import { hourSources, Pending, StaleNote } from './shared';
import { Icon } from '@/components/ui';
import { hourlyOutlook } from '@/lib/forecast';
import { clock, dateKey, temp, weekdayShort } from '@/lib/format';
import { Fragment, useEffect, useRef } from 'react';
import { useSettings } from '@/lib/settings';
import type { Weather } from '@/lib/useWeather';

export function HourlyScreen({ weather, selected, onSelect }: { weather: Weather; selected: number | null; onSelect: (i: number) => void }) {
  const { s } = useSettings();
  const f = weather.forecast;
  const selectedHourRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (window.matchMedia('(max-width: 700px)').matches) {
      selectedHourRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [selected, f]);
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
          const newDay = i > 0 && dateKey(d, f.timeZone) !== dateKey(new Date(hours[i - 1].start), f.timeZone);
          const dayName = i === 0 ? 'Today' : weekdayShort(d, f.timeZone);
          return (
            <Fragment key={h.start}>
            {(i === 0 || newDay) && <div className="hour-day-heading">{dayName}</div>}
            <button type="button" ref={i === sel ? selectedHourRef : undefined} onClick={() => onSelect(i)} aria-pressed={i === sel}
              aria-label={`${dayName} ${i === 0 ? 'now' : label(h.start)}, ${temp(h.tempF, s.units)}, ${h.condition}, rain chance ${h.pop == null ? 'unavailable' : `${h.pop}%`}, wind ${h.windMph == null ? 'unavailable' : `${h.windMph} miles per hour`}${i === sel ? `. ${hourSources(h)}` : ''}`}
              className={`hour${i === sel ? ' sel' : ''}${newDay ? ' new-day' : ''}${i === 0 ? ' now' : ''}`}>
              <div className="day">{i === 0 ? 'Today' : newDay ? dayName : ''}</div>
              <div className="time">{i === 0 ? 'Now' : label(h.start)}</div>
              <div className="ico"><Icon kind={h.icon} /></div>
              <div className="deg">{temp(h.tempF, s.units)}</div>
              <div className="foot">
                <div className="pop"><span className="hour-metric-label">Rain </span>{h.pop == null ? '–' : `${h.pop}%${h.popKind ? '*' : ''}`}</div>
                <div className="bar"><div style={{ width: `${h.pop ?? 0}%` }} /></div>
                <div className="wind"><span className="hour-metric-label">Wind </span>{h.windMph == null ? '–' : `${h.windVariable ? 'Var ' : ''}${h.windMph} mph`}</div>
              </div>
              <div className="hour-mobile-detail" aria-hidden={i !== sel}>
                <div className="hour-mobile-detail-inner"><strong>{h.condition}</strong><span>{hourSources(h)}</span></div>
              </div>
            </button>
            </Fragment>
          );
        })}
      </div>
      <div className="provenance">{sel === 0 ? 'Now' : label(hours[sel].start)}: {hourSources(hours[sel])}{hours.some(h => h.popKind) && !hours[sel].popKind ? ' * Not a normal hourly rain chance. Select that hour for details.' : ''}</div>
    </div>
  );
}
