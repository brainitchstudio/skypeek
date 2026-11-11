import { ChevronRight, TriangleAlert } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { TodayBackground } from '@/components/TodayBackground';
import { Pending, StaleNote, type ScreenProps } from './shared';
import { Icon } from '@/components/ui';
import { todaySummary } from '@/lib/forecast';
import { clock, iconFor, temp, weekdayLong } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { todayScene } from '@/lib/todayScene';
import type { WeatherAlert } from '@/lib/types';
import { PROVIDER_NAMES, type NowConditions } from '@/weather/service';

/** Says where the big number came from, so an estimate never reads as a measurement. */
function nowNote(c: NowConditions, tz: string): string {
  const at = clock(new Date(c.at), tz);
  if (c.kind === 'observation') return `Observed at ${c.stationId}, ${Math.round((c.distanceKm ?? 0) * 0.621)} mi away · ${at}`;
  if (c.kind === 'analysis') return `Estimated from ${c.sources.map(p => PROVIDER_NAMES[p]).join(', ')} · ${at}`;
  return 'Forecast for this hour';
}

export function TodayScreen({ weather, place, nav, banner, onHour }: ScreenProps & { banner?: WeatherAlert; onHour: (i: number) => void }) {
  const { s } = useSettings();
  const { forecast: f, now: current } = weather;
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const weekday = useMemo(() => f && weekdayLong(clockNow, f.timeZone), [f, clockNow]);
  if (!f || !f.hours.length) return <Pending weather={weather} />;

  const now = f.hours[0];
  const today = f.days[0];
  const condition = current?.condition || now.condition;
  const scene = todayScene(clockNow, f.timeZone, condition, current?.windMph ?? now.windMph, current?.tempF ?? now.tempF,
    !current || current.kind === 'forecast', now.isDaytime);
  const note = current && nowNote(current, f.timeZone);
  const mixed = now.agreement === 'low' ? 'Forecast sources disagree on the next few hours.' : null;

  return (
    <div className={`screen today today-${scene.time}`} data-weather={scene.weather}>
      <TodayBackground scene={scene} />
      {mixed && <div className="live-note">{mixed}</div>}
      <StaleNote weather={weather} />
      {banner && (
        <button type="button" className="banner" style={{ background: banner.color, color: banner.fg }} onClick={() => nav('alertDetail', { alertId: banner.id })}>
          <TriangleAlert size={16} aria-hidden /><span>{banner.title}{banner.until && ` · ${banner.until}`}</span><ChevronRight size={16} aria-hidden />
        </button>
      )}
      <div className="today-hero">
        <div className="today-temp">{temp(current?.tempF ?? now.tempF, s.units)}</div>
        <div className="today-location">
          <div className="today-loc">{place.name} · {weekday}</div>
          {note && <div className="live-note">{current?.kind === 'observation' && <i />}{note}</div>}
        </div>
        <div className="today-cond">
          <Icon kind={current && current.kind !== 'forecast' ? iconFor(current.condition, now.isDaytime) : now.icon} />
          <div className="capitalize">{condition}</div>
          <div className="muted">{today?.hiEstimated ? '~' : ''}{temp(today?.hiF, s.units)} / {temp(today?.loF, s.units)}</div>
        </div>
        <div className="today-summary">
          {todaySummary(f, s.units).map((sentence, i) => <Fragment key={i}>{i > 0 && ' '}<span>{sentence}</span></Fragment>)}
        </div>
      </div>
      <div className="today-hours">
        {f.hours.slice(0, 6).map((h, i) => (
          <button type="button" key={h.start} onClick={() => onHour(i)}>
            <div className="t">{i === 0 ? 'Now' : clock(new Date(h.start), f.timeZone)}</div>
            <Icon kind={h.icon} />
            <div className="v">{temp(h.tempF, s.units)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
