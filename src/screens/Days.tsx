import { useMemo, useRef, useState } from 'react';
import { Pending, StaleNote } from './shared';
import { Icon } from '@/components/ui';
import { dailyOutlook } from '@/lib/forecast';
import { COLORS, temp } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import type { Day } from '@/lib/types';
import type { Weather } from '@/lib/useWeather';

const TRANSITION = 'opacity .4s ease, transform .4s cubic-bezier(.2,.7,.2,1)';

/** Two stacked panes: the new day slides in as the old one slides out. */
function useDayPanes(start: number) {
  const [p, setP] = useState({ slots: [start, start], active: 0, x: [0, 0], noTr: -1 });
  const cur = useRef(start);
  const pick = (i: number) => {
    if (i === cur.current) return;
    const dir = i > cur.current ? 1 : -1;
    cur.current = i;
    setP(s => {
      const n = 1 - s.active, slots = [...s.slots], x = [0, 0];
      slots[n] = i;
      x[n] = dir * 40;
      return { ...s, slots, x, noTr: n };
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setP(s => {
        const n = 1 - s.active, x = [0, 0];
        x[s.active] = -dir * 40;
        return { ...s, active: n, x, noTr: -1 };
      });
    }));
  };
  return { p, pick };
}

export function DaysScreen({ weather }: { weather: Weather }) {
  const { s, set } = useSettings();
  const f = weather.forecast;
  const days = f?.days ?? [];
  const sel = Math.min(s.day, Math.max(0, days.length - 1));
  const { p, pick } = useDayPanes(sel);
  const range = useMemo(() => {
    const v = days.flatMap(d => [d.hiF, d.loF]).filter((x): x is number => x != null);
    return v.length ? { mn: Math.min(...v), mx: Math.max(...v) } : { mn: 0, mx: 1 };
  }, [days]);
  if (!f || !days.length) return <Pending weather={weather} />;

  const span = range.mx - range.mn || 1;
  const row = (d: Day) => {
    const lo = d.loF ?? d.hiF ?? range.mn, hi = d.hiF ?? lo;
    return { left: `${((lo - range.mn) / span) * 100}%`, width: `${((hi - lo) / span) * 100}%`, background: hi >= 62 ? COLORS.yellow : COLORS.blue };
  };

  return (
    <div className="screen days">
      <div className="days-head">
        <h1 className="title">{days.length} Day</h1>
        <div className="sub">{dailyOutlook(days, x => temp(x, s.units))}</div>
      </div>
      <StaleNote weather={weather} />
      <div className="days-body">
        <div className="day-list">
          {days.map((d, i) => (
            <button type="button" key={d.date} className={`day-row${i === sel ? ' sel' : ''}`} onClick={() => { pick(i); set({ day: i }); }}>
              <div className="d">{d.short}</div>
              <Icon kind={d.icon} />
              <div className="pop">{d.pop == null ? '–' : d.pop ? `${d.pop}%` : ''}</div>
              <div className="lo">{temp(d.loF, s.units)}</div>
              <div className="range"><div style={row(d)} /></div>
              <div className="hi">{d.hiEstimated ? '~' : ''}{temp(d.hiF, s.units)}</div>
            </button>
          ))}
        </div>
        <div className="day-panel">
          {p.slots.map((di, k) => {
            const d = days[Math.min(di, days.length - 1)];
            return (
              <div key={k} className="pane" style={{
                opacity: k === p.active ? 1 : 0, transform: `translateX(${p.x[k]}px)`,
                transition: p.noTr === k ? 'none' : TRANSITION, pointerEvents: k === p.active ? 'auto' : 'none',
              }}>
                <div className="date">{d.dateLabel}</div>
                <div className="name">{d.name}</div>
                <div className="big-icon"><Icon kind={d.icon} /></div>
                <div className="temps"><div className="h">{d.hiEstimated ? '~' : ''}{temp(d.hiF, s.units)}</div><div className="l">{temp(d.loF, s.units)}</div></div>
                <div className="summary">{d.summary}</div>
                {d.source && <div className="provenance">{d.highFrom ? `Text from ${d.source}. High from ${d.highFrom}.` : `From ${d.source}.`}</div>}
                <div className="stats">
                  <div><div className="cap">Rain</div><div className="val pop">{d.pop == null ? '–' : `${d.pop}%`}</div></div>
                  <div><div className="cap">Wind</div><div className="val">{d.windMph == null ? '–' : `${d.windMph} mph`}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
