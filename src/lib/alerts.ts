import type { Geometry } from 'geojson';
import { clock, dateKey, joinTimeRange, LEVEL_STYLE, relDay } from './format';
import type { AlertLevel, WeatherAlert } from './types';

export type NwsAlertFeature = {
  id: string;
  geometry: Geometry | null;
  properties: {
    id?: string;
    event: string;
    areaDesc?: string;
    effective?: string | null;
    onset?: string | null;
    ends?: string | null;
    expires?: string | null;
    senderName?: string;
    description?: string | null;
    instruction?: string | null;
    status?: string; // Actual, Exercise, System, Test, Draft
    messageType?: string; // Alert, Update, Cancel
    severity?: string;
    references?: { identifier: string }[];
    parameters?: { eventMotionDescription?: string[] };
    geocode?: { SAME?: string[] };
    replacedBy?: string;
  };
};

export function levelOf(event: string): AlertLevel {
  const m = /(Warning|Watch|Advisory)\b/.exec(event);
  return (m?.[1] as AlertLevel) ?? 'Statement';
}

export function countyFipsOf(f: NwsAlertFeature): string[] {
  return [...new Set((f.properties.geocode?.SAME ?? []).filter(code => /^\d{6}$/.test(code)).map(code => code.slice(1)))];
}

/** Undoes NWS's hard line wrapping while keeping paragraph breaks. */
export function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/\r/g, '').replace(/\n{2,}/g, '\u0000').replace(/\n/g, ' ')
    .replace(/\u0000/g, '\n\n').replace(/ {2,}/g, ' ').trim();
}

export function splitInstructions(s: string | null | undefined): string[] {
  return cleanText(s).split(/\n\n+|(?<=[.!])\s+(?=[A-Z])/).map(x => x.trim()).filter(Boolean).slice(0, 5);
}

const pct = (x: number) => `${Math.min(100, Math.max(0, x))}%`;

const DAY = 86_400_000;

/** A bar from local midnight on the start day, one to three days wide to fit the alert. */
function timeline(start: Date, end: Date | null, tz: string, now: Date) {
  // Find local midnight: step back from `start` by its local time of day.
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(start).split(':').map(Number);
  const dayStart = start.getTime() - (h * 3600 + m * 60) * 1000 - start.getSeconds() * 1000;
  const lastMs = Math.max(end?.getTime() ?? 0, now.getTime());
  const days = Math.min(3, Math.max(1, Math.ceil((lastMs - dayStart) / DAY)));
  const range = days * DAY;
  const left = ((start.getTime() - dayStart) / range) * 100;
  const span = end ? ((end.getTime() - start.getTime()) / range) * 100 : 100 - left;
  const today = dateKey(start, tz) === dateKey(now, tz);
  const ticks = [0, 1, 2, 3, 4].map(i => {
    const at = new Date(dayStart + (i * range) / 4);
    const prefix = i < 4 && Number.isInteger((i * days) / 4) && (i > 0 || days > 1 || !today);
    return `${prefix ? relDay(at, tz, now) + ' ' : ''}${clock(at, tz)}`;
  });
  return {
    left: pct(left),
    width: pct(Math.min(span, 100 - left)),
    now: pct(((now.getTime() - dayStart) / range) * 100),
    ticks,
  };
}

export function mapAlert(f: NwsAlertFeature, tz: string, now = new Date()): WeatherAlert {
  const p = f.properties;
  const level = levelOf(p.event);
  const start = new Date(p.onset ?? p.effective ?? now);
  const endIso = p.ends ?? p.expires;
  const end = endIso ? new Date(endIso) : null;
  const areas = (p.areaDesc ?? '').split(';').map(a => a.trim()).filter(Boolean);
  return {
    id: p.id ?? f.id,
    title: p.event,
    level,
    ...LEVEL_STYLE[level],
    when: joinTimeRange(start, end, tz, now),
    until: end ? `until ${clock(end, tz)}` : '',
    area: areas.length > 1 ? `${areas[0]} +${areas.length - 1}` : areas[0] ?? '',
    sender: p.senderName ?? 'National Weather Service',
    body: cleanText(p.description),
    todo: splitInstructions(p.instruction),
    instructionText: cleanText(p.instruction),
    timeline: timeline(start, end, tz, now),
    geometry: f.geometry,
    countyFips: countyFipsOf(f),
    motionText: p.parameters?.eventMotionDescription?.[0],
    endsAt: end ? end.getTime() : null,
    cancelled: p.messageType === 'Cancel',
  };
}

const RANK: Record<AlertLevel, number> = { Warning: 0, Watch: 1, Advisory: 2, Statement: 3 };

export function sortAlerts(a: WeatherAlert[]): WeatherAlert[] {
  return [...a].sort((x, y) => RANK[x.level] - RANK[y.level]);
}

export const ALERT_TYPES: [string, AlertLevel][] = [
  ['Tornado Warning', 'Warning'], ['Severe Thunderstorm Warning', 'Warning'],
  ['Flash Flood Warning', 'Warning'], ['Winter Storm Warning', 'Warning'],
  ['Severe Thunderstorm Watch', 'Watch'], ['Tornado Watch', 'Watch'],
  ['Heat Advisory', 'Advisory'], ['Wind Advisory', 'Advisory'], ['Coastal Flood Statement', 'Statement'],
];

export type AlertPrefs = {
  mode: 'types' | 'tiers';
  types: boolean[];
  tiers: number[]; // per tier: 0 Notify, 1 Banner, 2 Off
};

/** How one alert should reach the user. Types not in the list stay on. */
export function routeAlert(level: AlertLevel, title: string, p: AlertPrefs): 'notify' | 'banner' | 'off' {
  if (p.mode === 'types') {
    const i = ALERT_TYPES.findIndex(([n]) => n === title);
    return i < 0 || p.types[i] ? 'notify' : 'off';
  }
  const tier = p.tiers[{ Warning: 0, Watch: 1, Advisory: 2, Statement: 2 }[level]];
  return tier === 0 ? 'notify' : tier === 1 ? 'banner' : 'off';
}
