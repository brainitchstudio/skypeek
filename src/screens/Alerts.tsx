import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Pending, StaleNote, type ScreenProps } from './shared';
import { Label } from '@/components/ui';
import { useSettings } from '@/lib/settings';
import type { WeatherAlert } from '@/lib/types';

function useCurrent(alerts: WeatherAlert[]) {
  const { s, set } = useSettings();
  const cur = alerts.find(a => a.id === s.alertId) ?? alerts[0];
  return { cur, select: (id: string) => set({ alertId: id }) };
}

/** "Nothing active", "we can't tell" and "not covered here" must never look alike. */
function Empty({ place, weather }: Pick<ScreenProps, 'place' | 'weather'>) {
  const { status } = weather.alertFeed;
  const [h, p] = status === 'fresh' ? ['No active alerts', `The National Weather Service has nothing active for ${place.name}.`]
    : status === 'stale' ? ['Alert status is out of date', `Sky Peek can’t reach the National Weather Service, so there may be alerts for ${place.name} that aren’t shown.`]
    : status === 'unsupported' ? ['Alerts aren’t available here', `National Weather Service alerts cover the US. Sky Peek has no alert source for ${place.name}.`]
    : ['Checking for alerts', `Waiting on the National Weather Service for ${place.name}.`];
  return (
    <div className="alert-empty">
      <div className="h">{h}</div>
      <div className="p">{p}</div>
      <StaleNote weather={weather} />
    </div>
  );
}

const paragraphs = (t: string) => <div className="body">{t}</div>;

export function AlertsScreen({ weather, place, nav }: ScreenProps) {
  const { alerts } = weather;
  const { cur, select } = useCurrent(alerts);
  if (!weather.forecast && weather.loading) return <Pending weather={weather} />;
  if (!weather.forecast && weather.error) return <Pending weather={weather} />;
  return (
    <div className="screen alerts">
      <aside>
        <div className="row-between">
          <h1 className="title">Alerts</h1>
          <button type="button" className="link quiet" onClick={() => nav('settings', { setTab: 'alerts' })}>Settings</button>
        </div>
        <div className="alert-list">
          {alerts.map(a => (
            <button type="button" key={a.id} className={a.id === cur?.id ? 'sel' : ''} onClick={() => select(a.id)}>
              <i style={{ background: a.color }} />
              <div><div className="t">{a.title}</div><div className="w">{a.when}</div></div>
            </button>
          ))}
        </div>
      </aside>
      <section>
        {!cur ? <Empty place={place} weather={weather} /> : <>
          <StaleNote weather={weather} />
          <div className="alert-head">
            <div className="tags">
              <span style={{ background: cur.color, color: cur.fg }}>{cur.level}</span>
              {cur.area && <span className="area">{cur.area}</span>}
            </div>
            <h2>{cur.title}</h2>
            <div className="by">{cur.when} · {cur.sender}</div>
          </div>
          <div className="timeline">
            <div className="track">
              <div style={{ background: cur.color, left: cur.timeline.left, width: cur.timeline.width }} />
              <i style={{ left: cur.timeline.now }} />
            </div>
            <div className="ticks">{cur.timeline.ticks.map((t, i) => <div key={i}>{t}</div>)}</div>
          </div>
          {paragraphs(cur.body)}
          {cur.todo.length > 0 && (
            <div className="todo">
              <Label>What to do</Label>
              {cur.todo.map(t => <div key={t}><i />{t}</div>)}
            </div>
          )}
          <div className="alert-actions">
            <button type="button" onClick={() => nav('alertDetail', { alertId: cur.id })}>Open full alert <ArrowRight size={16} aria-hidden /></button>
            <button type="button" onClick={() => nav('radar')}>View on radar <ArrowRight size={16} aria-hidden /></button>
          </div>
        </>}
      </section>
    </div>
  );
}

export function AlertDetailScreen({ weather, place, nav }: ScreenProps) {
  const { alerts } = weather;
  const { cur, select } = useCurrent(alerts);
  if (!cur) {
    return (
      <div className="screen scroll detail-empty">
        <button type="button" className="link quiet back" onClick={() => nav('alerts')}><ArrowLeft size={16} aria-hidden /> All alerts</button>
        <Empty place={place} weather={weather} />
      </div>
    );
  }
  return (
    <div className="screen scroll alert-detail">
      <div className="stripe" style={{ background: cur.color }} />
      <div className="top">
        <div className="main">
          <button type="button" className="link quiet back" onClick={() => nav('alerts')}><ArrowLeft size={16} aria-hidden /> All alerts</button>
          <div className="lvl">{cur.level}{cur.area && ` · ${cur.area}`}</div>
          <h1>{cur.title}</h1>
          <div className="when">{cur.when}</div>
          {paragraphs(cur.body)}
        </div>
        {cur.todo.length > 0 && (
          <div className="steps">
            <Label>What to do</Label>
            {cur.todo.map(t => <div key={t}>{t}</div>)}
          </div>
        )}
      </div>
      <div className="others">
        <div className="row-between">
          <Label>All active alerts</Label>
          <button type="button" className="link quiet" onClick={() => nav('settings', { setTab: 'alerts' })}>Alert settings</button>
        </div>
        <div className="cards">
          {alerts.map(a => (
            <button type="button" key={a.id} style={{ borderColor: a.id === cur.id ? '#111' : '#e6e6e2' }} onClick={() => select(a.id)}>
              <div className="lv"><i style={{ background: a.color }} />{a.level}</div>
              <div className="t">{a.title}</div>
              <div className="w">{a.when}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
