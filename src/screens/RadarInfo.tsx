import { ArrowRight, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { ScreenProps } from './shared';
import { getNearestLightning, getPointAlerts, getPointWeather, type StormCell } from '@/api/layers';
import { temp, wmoText, type Units } from '@/lib/format';
import type { Place, WeatherAlert } from '@/lib/types';
import type { MapPick } from '@/radar/controller';
import { arrivalPhrase, lightningPhrase, stormArrival } from '@/radar/proximity';
import { degToCompass } from '@/weather/units';
import { type LightningStrike } from '@/radar/lightning';
import { milesBetween } from '@/radar/proximity';

type Lookup<T> = { state: 'loading' } | { state: 'failed' } | { state: 'done'; value: T };

/** One lookup for the life of a card; a new spot gets a new card. */
function useLookup<T>(load: () => Promise<T>): Lookup<T> {
  const [result, setResult] = useState<Lookup<T>>({ state: 'loading' });
  useEffect(() => {
    let stale = false;
    load().then(value => { if (!stale) setResult({ state: 'done', value }); }).catch(() => { if (!stale) setResult({ state: 'failed' }); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return result;
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => <div><dt>{label}</dt><dd>{children}</dd></div>;

function shown<T>(r: Lookup<T>, text: (v: T) => ReactNode) {
  return r.state === 'loading' ? 'Checking…' : r.state === 'failed' ? 'Unavailable' : text(r.value);
}

function Card({ kicker, title, onClose, children }: { kicker: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <section className="radar-card" aria-label={title}>
      <div className="top">
        <div>
          <div className="kicker">{kicker}</div>
          <div className="h">{title}</div>
        </div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      {children}
    </section>
  );
}

/** What's going on at a clicked spot. */
export function PointCard({ pick, storms, alerts, units, stamp, nav, onClose, historical = false }: {
  pick: MapPick; storms: StormCell[] | null; alerts: WeatherAlert[]; units: Units; stamp: number;
  nav: ScreenProps['nav']; onClose: () => void; historical?: boolean;
}) {
  const { lat, lon } = pick;
  const weather = useLookup(() => getPointWeather(lat, lon));
  const nearby = useLookup(() => getPointAlerts(lat, lon));
  const lightning = useLookup(() => getNearestLightning(lat, lon, stamp));

  const arrival = storms && stormArrival(storms, lat, lon);
  const drawn = alerts.filter(a => pick.alertIds.includes(a.id));
  const fetched = nearby.state === 'done' ? nearby.value : [];
  const here = [...drawn, ...fetched.filter(a => !drawn.some(d => d.id === a.id))];
  const known = (a: WeatherAlert) => alerts.some(k => k.id === a.id); // others have no detail screen

  const title = weather.state === 'done' ? `${temp(weather.value.tempF, units)} · ${wmoText(weather.value.code)}` : 'This spot';

  return (
    <Card kicker={`Live spot conditions · ${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`} title={title} onClose={onClose}>
      <dl>
        <Row label="Feels like">{shown(weather, w => temp(w.feelsF, units))}</Row>
        <Row label="Wind">{shown(weather, w => `${Math.round(w.windMph)} mph from ${degToCompass(w.windFrom)}`)}</Row>
        <Row label="Rain, next hour">{shown(weather, w => (w.rainPct === null ? 'Unknown' : `${w.rainPct}%`))}</Row>
        <Row label="Storms">
          {!storms ? 'Unavailable' : !arrival ? 'None due within an hour' : arrival.minutes === 0 ? 'Here now' : `May arrive ${arrivalPhrase(arrival.minutes)}`}
        </Row>
        <Row label="Lightning">{shown(lightning, lightningPhrase)}</Row>
        {here.length === 0 && <Row label="Alerts">{shown(nearby, () => 'None')}</Row>}
      </dl>
      {here.length > 0 && (
        <div className="alerts-at">
          {here.map(a => {
            const body = <><i style={{ background: a.color }} /><span>{a.title}<small>{a.when}</small></span></>;
            return known(a)
              ? <button type="button" key={a.id} className="alert-at" onClick={() => nav('alertDetail', { alertId: a.id })}>{body}<ArrowRight size={16} aria-hidden /></button>
              : <div key={a.id} className="alert-at">{body}</div>;
          })}
        </div>
      )}
      {historical && <p className="warning-footnote">These spot readings, alerts, and lightning are current, not observations from the selected radar frame.</p>}
    </Card>
  );
}

export function LightningCard({ strike, place, onClose }: { strike: LightningStrike; place: Place; onClose: () => void }) {
  const miles = milesBetween(place.lat, place.lon, strike.lat, strike.lon);
  return <Card kicker="Individual lightning report · live" title="Lightning detected" onClose={onClose}>
    <dl>
      <Row label="Detected">{new Date(strike.at).toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</Row>
      <Row label="Type">{strike.kind === 'ground' ? 'Cloud to ground' : strike.kind === 'cloud' ? 'Cloud to cloud' : 'Not specified'}</Row>
      <Row label="From active location">{miles.toFixed(1)} mi</Row>
      <Row label="Reported position">{strike.lat.toFixed(4)}°, {strike.lon.toFixed(4)}°</Row>
      {strike.intensity !== null && <Row label="Peak current">{Math.abs(strike.intensity).toLocaleString()} A {strike.intensity < 0 ? 'negative' : 'positive'}</Row>}
      {strike.accuracyMi !== null && <Row label="Location uncertainty">About {strike.accuracyMi.toFixed(1)} mi</Row>}
      {strike.quality && <Row label="Detection quality">{strike.quality}</Row>}
    </dl>
    <p className="warning-footnote">Source: {strike.source}. Reports may be delayed; locations have measurement uncertainty. This is live data, independent of radar playback.</p>
  </Card>;
}

/** Full text for warnings selected from the visible map, including warnings away from home. */
export function WarningCard({ warnings, onCheck, onClose }: { warnings: WeatherAlert[]; onCheck?: (warning: WeatherAlert) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(warnings[0]?.id);
  const warning = warnings.find(w => w.id === selected) ?? warnings[0];
  if (!warning) return null;
  return (
    <Card kicker="Live NWS alert · current conditions" title={warning.title} onClose={onClose}>
      {warnings.length > 1 && <label className="warning-choice">Warnings here
        <select value={warning.id} onChange={e => setSelected(e.target.value)}>
          {warnings.map(w => <option key={w.id} value={w.id}>{w.title} · {w.area}</option>)}
        </select>
      </label>}
      <dl>
        <Row label="When">{warning.when}</Row>
        <Row label="Area">{warning.area || 'See warning polygon'}</Row>
        <Row label="Issued by">{warning.sender}</Row>
      </dl>
      {warning.body && <p className="warning-body">{warning.body}</p>}
      {warning.instructionText && <div className="warning-instructions"><strong>What to do</strong><p>{warning.instructionText}</p></div>}
      {onCheck && <button type="button" className="check-here" onClick={() => onCheck(warning)}>SpotCheck</button>}
      <p className="warning-footnote">Official NWS alert. This polygon is current even when a historical radar frame is selected.</p>
    </Card>
  );
}

/** What the radar says about one storm. */
export function StormCard({ storm, place, at, onCheck, onClose }: { storm: StormCell; place: Place; at?: number; onCheck?: () => void; onClose: () => void }) {
  const arrival = stormArrival([storm], place.lat, place.lon, at ?? Date.now());
  const seen = new Date(storm.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <Card kicker={`Storm tracks · ${storm.id} · ${seen}`} title={storm.tornado ? 'Rotation signature' : storm.severe ? 'Strong storm' : 'Storm'} onClose={onClose}>
      <div className="storm-motion">{storm.motionKnown === false ? 'Motion unavailable' : storm.mph >= 1 ? `Moving ${degToCompass(storm.heading)} at ${Math.round(storm.mph)} mph` : 'Stationary'}</div>
      <div className="storm-coordinates">{storm.lat.toFixed(2)}°, {storm.lon.toFixed(2)}° · Radar {storm.radar}</div>
      <dl className="storm-metrics">
        <Row label="Max hail">{storm.hailIn == null ? 'Unavailable' : `${storm.hailIn.toFixed(2)} in`}</Row>
        <Row label="Severe hail">{storm.severeHailPct == null ? 'Unavailable' : `${storm.severeHailPct}%`}</Row>
        <Row label="Hail chance">{storm.hailPct == null ? 'Unavailable' : `${storm.hailPct}%`}</Row>
        <Row label="Reflectivity">{storm.dbz == null ? 'Unavailable' : `${storm.dbz} dBZ`}</Row>
        <Row label="Echo top">{storm.echoTopFt == null ? 'Unavailable' : `${Math.round(storm.echoTopFt).toLocaleString()} ft`}</Row>
        <Row label="VIL">{storm.vil == null ? 'Unavailable' : <>{storm.vil} kg/m²</>}</Row>
      </dl>
      <dl>
        {storm.rotation && <Row label="Rotation">Radar signature</Row>}
        {storm.tornado && <Row label="Vortex">Radar signature</Row>}
        <Row label={place.name}>
          {!arrival ? 'No projected arrival' : arrival.minutes === 0 ? 'Nearby now' : `May arrive ${arrivalPhrase(arrival.minutes)}`}
        </Row>
      </dl>
      {onCheck && <button type="button" className="check-here" onClick={onCheck}>SpotCheck</button>}
      <p className="storm-note">Radar estimates via NWS / IEM. Track dots mark 15-minute steps from the report time. Signatures are not confirmed tornado reports.</p>
    </Card>
  );
}
