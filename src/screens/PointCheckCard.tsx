import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Row } from './RadarInfo';
import { approachPhrase } from '@/radar/approach';
import { forecastLine, lostText, nearestStep } from '@/radar/checkMode';
import { reflectivityColor } from '@/radar/flat';
import type { MapPoint } from '@/radar/tools';
import type { CheckSource, PointCheck, Section as Loaded } from '@/radar/usePointCheck';
import type { PointHour } from '@/api/weather';
import { clock as zoned, relDay, temp, type Units } from '@/lib/format';
import type { WeatherAlert } from '@/lib/types';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const NA = 'Unavailable';
const ago = (check: PointCheck, at: number) => Math.max(0, Math.round((check.asOf - at) / 60_000));
const CENTER = 'Distance is to the storm\'s center. The feed gives no storm size.';
const RULE = "This level is SkyPeek's own rule from reported and observed storm motion, not a forecast. Storms can turn, split or weaken.";
const percent = (n: number | null) => (n === null ? NA : `${n}%`);
/** "3:45 PM", with the day first when it isn't today. */
const until = (ms: number) => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone, d = new Date(ms);
  return `${relDay(d, tz) === 'Today' ? '' : relDay(d, tz) + ' '}${zoned(d, tz)}`;
};

/** Result of checking one map spot. Each section loads and fails on its own. */
export function PointCheckCard({ check, source, spot, units, warning, scanAt, onPickAgain, onClose }: {
  check: PointCheck; source: CheckSource; spot: MapPoint; units: Units; warning?: WeatherAlert; scanAt?: number; onPickAgain: () => void; onClose: () => void;
}) {
  const { storm, forecast, hour, arrivalHour, warnings } = check;
  const arrival = storm?.state === 'tracking' ? storm.arrival : null;
  const coming = arrival?.level === 'likely' || arrival?.level === 'possible' || arrival?.level === 'on-path';
  const step = coming && forecast.state === 'ready' && arrival.earliest !== null ? nearestStep(forecast.value.steps, arrival.earliest) : null;
  const stepColor = step?.dbz == null ? null : reflectivityColor(step.dbz);
  const stepKnown = step?.dbz != null;
  const kicker = source.kind === 'storm' ? `ProbSevere · Storm ${source.id}` : source.kind === 'warning' ? 'NWS alert' : 'HRRR and NWS';
  const warned = check.warning?.state === 'ready' ? check.warning.value.alert : warning;
  const title = source.kind === 'storm' ? 'Storm to this spot' : source.kind === 'warning' ? (warned?.title ?? 'Warning') : 'Forecast at this point';

  return (
    <section className="radar-card point-check" aria-label={title}>
      <div className="top">
        <div>
          <div className="kicker">{kicker}</div>
          <div className="h">{title}</div>
        </div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      <div className="storm-note">{`Latest scan · ${scanAt === undefined ? 'Unavailable' : clock(scanAt)} · ${spot.lat.toFixed(2)}°, ${spot.lon.toFixed(2)}°`}</div>

      {source.kind === 'storm' && (!storm
        ? <div className="storm-motion">Storm status unavailable</div>
        : storm.state === 'gone'
          ? <>
            <div className="storm-motion">{lostText(storm.asOf)}</div>
            <button type="button" className="check-here" onClick={onPickAgain}>Pick a storm again</button>
          </>
          : !arrival
            ? <div className="storm-coordinates">{storm.stale ? 'Storm status unavailable' : 'Checking…'}</div>
            : <>
              <div className="storm-motion">{arrival.headline}</div>
              <div className="storm-coordinates">{arrival.reported}</div>
              <div className="storm-coordinates">{arrival.observed}</div>
              <div className="storm-coordinates">{arrival.path}</div>
              <div className="storm-coordinates">{warnings.state === 'loading' ? 'Checking warnings…' : arrival.warning}</div>
              <div className="storm-coordinates">{forecast.state === 'loading' ? 'Checking forecast…' : forecast.state === 'ready' ? forecastLine(forecast.value.steps) : 'Forecast: HRRR unavailable'}</div>
              <div className="storm-coordinates">{`Storm reported ${ago(check, storm.storm.at)} min ago`}</div>
              {storm.stale && <div className="storm-coordinates">Storm status unavailable</div>}
              <div className="storm-note">{RULE}{(arrival.level === 'on-path' || arrival.level === 'far') && ' Past 60 minutes this is a straight-line estimate.'}</div>
              {coming && <>
                <Section title="If it gets there">
                  <div className="storm-note">{`Simulated radar at this spot: ${!stepKnown ? NA : stepColor ? `${Math.round(step!.dbz!)} dBZ` : 'No echo'}. HRRR model output for this spot, not a forecast of this storm.`}</div>
                </Section>
                {arrivalHour && <Section title="NWS forecast for that hour"><Hour hour={arrivalHour} units={units} /></Section>}
                <Section title="At the storm now">
                  <dl className="storm-metrics">
                    <Row label="Reflectivity">{storm.storm.dbz === null ? NA : `${storm.storm.dbz} dBZ`}</Row>
                    <Row label="VIL">{storm.storm.vil === null ? NA : `${storm.storm.vil} kg/m²`}</Row>
                    <Row label="Max hail">{storm.storm.hailIn === null ? NA : `${storm.storm.hailIn.toFixed(2)} in`}</Row>
                    <Row label="ProbSevere">{percent(storm.storm.probSevere)}</Row>
                    <Row label="Severe hail">{percent(storm.storm.probHail)}</Row>
                    <Row label="Severe wind">{percent(storm.storm.probWind)}</Row>
                    <Row label="Tornado">{percent(storm.storm.probTor)}</Row>
                  </dl>
                  <div className="storm-note">ProbSevere chances are for the storm over the next 60 minutes, not for this spot.</div>
                </Section>
              </>}
            </>)}

      {source.kind === 'warning' && (!check.warning || check.warning.state === 'loading'
        ? <div className="storm-coordinates">Checking…</div>
        : check.warning.state === 'unavailable'
          ? <div className="storm-motion">{check.warning.reason}</div>
          : check.warning.value.state === 'ended'
            ? <div className="storm-motion">This warning has ended</div>
            : <>
              <div className="storm-motion">{check.warning.value.inside === null ? 'No warning polygon published' : check.warning.value.inside ? 'Inside this warning now' : 'Outside this warning'}</div>
              <div className="storm-coordinates">{check.warning.value.alert.endsAt == null ? 'End time unavailable' : `Until ${until(check.warning.value.alert.endsAt)}`}</div>
              <div className="storm-coordinates">
                {check.warning.value.approach ? approachPhrase(check.warning.value.approach) : 'Motion unavailable'}
                {check.warning.value.afterEnd && ' · After this warning ends'}
              </div>
              {check.warning.value.motionAt !== null && <div className="storm-coordinates">{`Motion reported ${ago(check, check.warning.value.motionAt)} min ago`}</div>}
              {check.warning.value.onePoint && <div className="storm-note">{CENTER}</div>}
              {check.warning.value.stale && <div className="storm-coordinates">Warning status unavailable</div>}
            </>)}

      <>
        <Section title="Simulated radar at this spot">
          {forecast.state === 'loading' ? 'Checking…' : forecast.state === 'unavailable' ? forecast.reason === 'Outside HRRR coverage' ? forecast.reason : `Unavailable: ${forecast.reason}` : <>
            <div className="point-strip">
              {forecast.value.steps.map(step => {
                const color = step.dbz === null ? null : reflectivityColor(step.dbz);
                return (
                  <div key={step.at} className="point-step">
                    <i className={step.dbz === null ? 'gap' : undefined} style={color ? { background: color } : undefined} />
                    <span>{clock(step.at)}</span>
                    <b>{step.dbz === null ? '' : color ? `${Math.round(step.dbz)} dBZ` : 'No echo'}</b>
                  </div>
                );
              })}
            </div>
            <div className="storm-note">{`HRRR model output · Run ${clock(forecast.value.run)}`}</div>
          </>}
        </Section>
        {!arrivalHour && <Section title="NWS forecast"><Hour hour={hour} units={units} /></Section>}
      </>
      <Section title="Warnings at this spot">
        {warnings.state === 'loading' ? 'Checking…' : warnings.state === 'unavailable' ? warnings.reason
          : warnings.value.length ? warnings.value.map(w => <div key={w.id}>{w.title}</div>) : 'None active'}
      </Section>
    </section>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="point-section"><div className="storm-coordinates">{title}</div>{children}</div>
);

const Hour = ({ hour, units }: { hour: Loaded<PointHour>; units: Units }) => (
  hour.state === 'loading' ? <>Checking…</> : hour.state === 'unavailable' ? <>{hour.reason}</> : (
    <dl>
      <Row label={zoned(new Date(hour.value.startTime), Intl.DateTimeFormat().resolvedOptions().timeZone)}>{temp(hour.value.tempF, units)}</Row>
      <Row label="Wind">{hour.value.wind}</Row>
      <Row label="Rain chance">{hour.value.rainPct === null ? NA : `${hour.value.rainPct}%`}</Row>
    </dl>
  )
);
