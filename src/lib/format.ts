import type { AlertLevel, IconKind } from './types';

export const COLORS = {
  yellow: 'oklch(0.83 0.15 85)',
  blue: 'oklch(0.62 0.15 245)',
  red: 'oklch(0.6 0.2 27)',
  orange: 'oklch(0.74 0.17 55)',
  green: 'oklch(0.62 0.15 150)',
};

export const LEVEL_STYLE: Record<AlertLevel, { color: string; fg: string }> = {
  Warning: { color: COLORS.red, fg: '#fff' },
  Watch: { color: COLORS.orange, fg: '#111' },
  Advisory: { color: COLORS.yellow, fg: '#111' },
  Statement: { color: COLORS.blue, fg: '#fff' },
};

export type Units = 'F' | 'C';

export function temp(f: number | null | undefined, units: Units): string {
  if (f == null) return '–';
  return `${units === 'C' ? Math.round(((f - 32) * 5) / 9) : Math.round(f)}°`;
}

/** Picks an icon from NWS-style forecast text ("Slight Chance Rain Showers"). */
export function iconFor(text: string, isDaytime = true): IconKind {
  const t = text.toLowerCase();
  if (!t.trim()) return 'none'; // no condition isn't a sunny one
  if (/thunder|t-storm|tstorm/.test(t)) return 'storm';
  if (/snow|flurr|sleet|blizzard|wintry|ice/.test(t)) return 'snow';
  if (/rain|shower|drizzle/.test(t)) return 'rain';
  if (/partly|mostly sunny|mostly clear/.test(t)) return isDaytime ? 'partly' : 'partly-night';
  if (/cloud|overcast|fog|haze|mist|smoke/.test(t)) return 'cloud';
  return isDaytime ? 'sun' : 'moon';
}

/** Icon for an Open-Meteo WMO weather code. */
export function iconForWmo(code: number): IconKind {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  if (code === 45 || code === 48 || code === 3) return 'cloud';
  if (code === 1 || code === 2) return 'partly';
  return 'sun';
}

/** Words for an Open-Meteo WMO weather code. */
export function wmoText(code: number): string {
  if (code >= 95) return 'Thunderstorm';
  if (code === 85 || code === 86 || (code >= 71 && code <= 77)) return 'Snow';
  if (code >= 80) return 'Rain showers';
  if (code >= 61) return 'Rain';
  if (code >= 51) return 'Drizzle';
  if (code === 45 || code === 48) return 'Fog';
  return ['Clear', 'Mostly clear', 'Partly cloudy', 'Cloudy'][code] ?? 'Unknown';
}

const fmt = (timeZone: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone, ...o });

export const weekdayLong = (d: Date, tz: string) => fmt(tz, { weekday: 'long' }).format(d);
export const weekdayShort = (d: Date, tz: string) => fmt(tz, { weekday: 'short' }).format(d);
export const monthDay = (d: Date, tz: string) =>
  fmt(tz, { weekday: 'short', month: 'short', day: 'numeric' }).format(d);

/** Hour of the day, 0 to 23, in a time zone. */
export const hourOf = (d: Date, tz: string) => Number(fmt(tz, { hour: 'numeric', hourCycle: 'h23' }).format(d));

/** "6 PM", or "6:30 PM" when not on the hour. */
export function clock(d: Date, tz: string): string {
  const parts = fmt(tz, { hour: 'numeric', minute: '2-digit' }).formatToParts(d);
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? '';
  return `${get('hour')}${get('minute') === '00' ? '' : ':' + get('minute')} ${get('dayPeriod')}`;
}

/** YYYY-MM-DD for an instant in a time zone. */
export function dateKey(d: Date, tz: string): string {
  return fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    .replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2');
}

/** Short relative day used in alert times: "Today", or "Thu". */
export function relDay(d: Date, tz: string, now = new Date()): string {
  return dateKey(d, tz) === dateKey(now, tz) ? 'Today' : weekdayShort(d, tz);
}

export function joinTimeRange(start: Date, end: Date | null, tz: string, now = new Date()): string {
  const s = `${relDay(start, tz, now)} ${clock(start, tz)}`;
  if (!end) return s;
  const sameDay = dateKey(start, tz) === dateKey(end, tz);
  return `${s} – ${sameDay ? '' : relDay(end, tz, now) + ' '}${clock(end, tz)}`;
}
