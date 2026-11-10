import { clock, dateKey, hourOf, iconFor, monthDay, temp, weekdayLong, weekdayShort, type Units } from './format';
import type { Day, Forecast, Hour, IconKind } from './types';

export type NwsPeriod = {
  name: string;
  startTime: string;
  isDaytime: boolean;
  temperature: number;
  windSpeed: string;
  shortForecast: string;
  detailedForecast: string;
  probabilityOfPrecipitation?: { value: number | null };
};

export type ExtendedDay = {
  date: string; hiF: number; loF: number; icon: Day['icon']; pop: number | null; windMph: number | null;
};

/** "5 to 10 mph" -> 10. No number means unknown, not calm. */
export function parseWind(s: string): number | null {
  const nums = (s.match(/\d+/g) ?? []).map(Number);
  return nums.length ? Math.max(...nums) : null;
}

const pop = (p: NwsPeriod) => p.probabilityOfPrecipitation?.value ?? null;

/** The larger value, staying null only if neither period gave one. */
const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

export function mapHours(periods: NwsPeriod[], now = new Date()): Hour[] {
  return periods
    // Keep the hour in progress, drop anything fully past.
    .filter(p => new Date(p.startTime).getTime() > now.getTime() - 3_600_000)
    .map(p => ({
      start: p.startTime,
      tempF: p.temperature,
      icon: iconFor(p.shortForecast, p.isDaytime),
      condition: p.shortForecast,
      isDaytime: p.isDaytime,
      pop: pop(p),
      windMph: parseWind(p.windSpeed),
    }));
}

const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);

function labelDay(date: string, isToday: boolean) {
  const d = atNoon(date);
  return {
    short: isToday ? 'Today' : weekdayShort(d, 'UTC'),
    name: isToday ? 'Today' : weekdayLong(d, 'UTC'),
    dateLabel: monthDay(d, 'UTC'),
  };
}

/**
 * Folds NWS day/night periods into calendar days. Late in the day NWS starts at
 * "Tonight", so today's high comes from the remaining hourly data instead.
 */
export function mapDays(periods: NwsPeriod[], hours: Hour[], timeZone: string, now = new Date()): Day[] {
  const today = dateKey(now, timeZone);
  const groups = new Map<string, { day?: NwsPeriod; night?: NwsPeriod }>();
  for (const p of periods) {
    const key = p.startTime.slice(0, 10);
    // After midnight NWS opens with "Overnight", then that date's own evening
    // period follows. The later one is the date's real low, so it overwrites.
    const g = groups.get(key) ?? {};
    if (p.isDaytime) g.day = p; else g.night = p;
    groups.set(key, g);
  }
  return [...groups].map(([date, { day, night }]) => {
    const main = day ?? night!;
    const sameDate = hours.filter(h => h.start.startsWith(date)).map(h => h.tempF);
    return {
      date,
      ...labelDay(date, date === today),
      hiF: day?.temperature ?? (sameDate.length ? Math.max(...sameDate) : null),
      hiEstimated: !day && sameDate.length > 0,
      loF: night?.temperature ?? null,
      icon: iconFor(main.shortForecast, main.isDaytime),
      pop: maxOf(day ? pop(day) : null, night ? pop(night) : null),
      windMph: maxOf(day ? parseWind(day.windSpeed) : null, night ? parseWind(night.windSpeed) : null),
      summary: main.detailedForecast,
      source: 'National Weather Service',
    };
  });
}

/** NWS stops at about 7 days; Open-Meteo fills gaps and extends the list to 10. */
export function mergeExtended(days: Day[], extended: ExtendedDay[], today: string): Day[] {
  const byDate = new Map(extended.map(e => [e.date, e]));
  const merged = days.map(d => {
    const e = byDate.get(d.date);
    return e ? { ...d, hiF: d.hiF ?? e.hiF, loF: d.loF ?? e.loF, hiEstimated: d.hiEstimated && d.hiF != null, ...(d.hiF == null ? { highFrom: 'Open-Meteo' } : {}) } : d;
  });
  const last = merged.at(-1)?.date ?? '';
  for (const e of extended) {
    if (merged.length >= 10) break;
    if (e.date <= last) continue;
    merged.push({
      date: e.date, ...labelDay(e.date, e.date === today),
      hiF: e.hiF, loF: e.loF, icon: e.icon, pop: e.pop, windMph: e.windMph,
      summary: `High near ${Math.round(e.hiF)}°, low around ${Math.round(e.loF)}°.${e.pop ? ` ${e.pop}% chance of precipitation.` : ''}`,
      source: 'Open-Meteo',
    });
  }
  return merged;
}

const atLeast = (p: number | null, n: number) => p != null && p >= n;

const wetWord = (icon: IconKind) => (icon === 'storm' ? 'Storms' : icon === 'snow' ? 'Snow' : 'Rain');

/** One-line outlook for the Hourly header, e.g. "Rain likely 6 – 10 PM." */
export function hourlyOutlook(hours: Hour[], label: (iso: string) => string): string {
  const next = hours.slice(0, 24);
  const first = next.findIndex(h => atLeast(h.pop, 50));
  if (first < 0) {
    const peak = Math.max(0, ...next.map(h => h.pop ?? 0));
    return peak >= 20 ? `Slight chance of rain, up to ${peak}%.` : 'Dry for the next 24 hours.';
  }
  let last = first;
  while (last + 1 < next.length && atLeast(next[last + 1].pop, 50)) last++;
  const word = wetWord(next[first].icon);
  const end = hours[last + 1];
  return `${word} likely ${label(next[first].start)}${end ? ' – ' + label(end.start) : ''}.`;
}

/** One-line outlook for the 10 Day header. */
export function dailyOutlook(days: Day[], tempLabel: (f: number) => string): string {
  const wet = days.filter(d => atLeast(d.pop, 50));
  const hi = days.map(d => d.hiF).filter((x): x is number => x != null);
  const range = hi.length ? `Highs ${tempLabel(Math.min(...hi))} to ${tempLabel(Math.max(...hi))}.` : '';
  if (!wet.length) return `Mostly dry. ${range}`.trim();
  return `${wet[0].name === 'Today' ? 'Wet today' : `Wet ${wet[0].name}`}${wet.length > 1 ? ` and ${wet.length - 1} more day${wet.length > 2 ? 's' : ''}` : ''}. ${range}`.trim();
}

const WET_POP = 50;
const WINDY_MPH = 15;
/** A high this far above what's left of the day has already passed. */
const HIGH_PASSED_F = 2;

const nextDate = (date: string) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const sentence = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1).toLowerCase()}`;

/** The condition that fills most of these hours. */
function dominant(hours: Hour[]): string {
  const counts = new Map<string, number>();
  for (const h of hours) counts.set(h.condition, (counts.get(h.condition) ?? 0) + 1);
  return [...counts].reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0])[0];
}

/** "Rain likely tonight after 8 PM", or null if these hours stay dry. */
function wetPhrase(hours: Hour[], when: string, label: (iso: string) => string): string | null {
  const first = hours.findIndex(h => atLeast(h.pop, WET_POP));
  if (first < 0) return null;
  let last = first;
  while (last + 1 < hours.length && atLeast(hours[last + 1].pop, WET_POP)) last++;
  const phrase = `${wetWord(hours[first].icon)} likely ${when}`;
  const toEnd = last === hours.length - 1;
  if (first === 0) return toEnd ? phrase : `${phrase} until ${label(hours[last + 1].start)}`;
  return toEnd
    ? `${phrase} after ${label(hours[first].start)}`
    : `${phrase} ${label(hours[first].start)} – ${label(hours[last + 1].start)}`;
}

/**
 * The Today summary, written for what's still ahead at the place's local time:
 * the rest of the day and tonight until 5 PM, tonight and tomorrow until 9 PM,
 * then overnight and the morning until 5 AM. NWS text is the fallback when the
 * hourly data doesn't reach far enough. Returns one entry per sentence, so the
 * screen can break lines between them.
 */
export function todaySummary(f: Forecast, units: Units, now = new Date()): string[] {
  const tz = f.timeZone;
  const hour = hourOf(now, tz);
  const today = dateKey(now, tz);
  const tomorrow = nextDate(today);
  const stamp = (d: Date) => `${dateKey(d, tz)}T${String(hourOf(d, tz)).padStart(2, '0')}`;
  const span = (start: string, end: string) => f.hours.filter(h => {
    const at = stamp(new Date(h.start));
    return at >= start && at < end;
  });
  // A no-break space keeps "5 AM" together on one line.
  const label = (iso: string) => clock(new Date(iso), tz).replace(' ', '\u00a0');
  const temps = (hours: Hour[]) => hours.map(h => h.tempF);
  const high = (date: string, hours: Hour[]) => f.days.find(d => d.date === date)?.hiF ?? Math.max(...temps(hours));
  const lowTonight = (hours: Hour[]) => f.days.find(d => d.date === today)?.loF ?? Math.min(...temps(hours));
  // `calm` rewords a settled sky; "Chance Light Rain" only reads right followed by `when`.
  const sky = (hours: Hour[], when: string, calm?: (c: string) => string) => {
    const wet = wetPhrase(hours, when, label);
    if (wet) return wet;
    const c = dominant(hours);
    return calm && !['rain', 'snow', 'storm'].includes(iconFor(c)) ? calm(c) : `${sentence(c)} ${when}`;
  };

  const from = stamp(now);
  let first: Hour[], second: Hour[], sentences: string[];
  if (hour >= 21 || hour < 5) {
    // Past midnight the day's own low is the coming evening's, so read this night from the hours.
    const morningDate = hour >= 21 ? tomorrow : today;
    first = span(from, `${morningDate}T06`);
    second = span(`${morningDate}T06`, `${morningDate}T12`);
    const low = Math.min(...temps(first));
    const lowAt = first.findIndex(h => h.tempF === low);
    const by = lowAt > 1 ? ` by ${label(first[lowAt].start)}` : '';
    const morning = sky(second, hour >= 21 ? 'tomorrow morning' : 'this morning', c => `${sentence(c)} morning`);
    sentences = [
      `${sky(first, 'overnight')}, low around ${temp(low, units)}${by}.`,
      `${morning}, high near ${temp(high(morningDate, second), units)}.`,
    ];
  } else if (hour >= 17) {
    first = span(from, `${tomorrow}T06`);
    second = span(`${tomorrow}T06`, `${tomorrow}T18`);
    const tomorrowSky = sky(second, 'tomorrow', c => `Tomorrow looks ${c.toLowerCase()}`);
    sentences = [
      `${sky(first, 'tonight')}, low around ${temp(lowTonight(first), units)}.`,
      `${tomorrowSky}, high near ${temp(high(tomorrow, second), units)}.`,
    ];
  } else {
    first = span(from, `${today}T18`);
    second = span(`${today}T18`, `${tomorrow}T06`);
    const hi = high(today, first);
    const stillAhead = hi - Math.max(...temps(first)) <= HIGH_PASSED_F;
    const rest = sky(first, hour < 11 ? 'today' : 'this afternoon');
    sentences = [
      `${rest}${stillAhead ? `, high near ${temp(hi, units)}` : ''}.`,
      `${sky(second, 'tonight')}, low around ${temp(lowTonight(second), units)}.`,
    ];
  }
  if (!first.length || !second.length) return [f.narrative];

  const wind = Math.max(...[...first, ...second].map(h => h.windMph ?? 0));
  return wind >= WINDY_MPH ? [...sentences, `Winds up to ${wind} mph.`] : sentences;
}

export function buildForecast(
  daily: NwsPeriod[], hourly: NwsPeriod[], extended: ExtendedDay[], timeZone: string, now = new Date(),
): Forecast {
  const hours = mapHours(hourly, now);
  const days = mergeExtended(mapDays(daily, hours, timeZone, now), extended, dateKey(now, timeZone));
  return { timeZone, hours, days, narrative: daily[0]?.detailedForecast ?? '' };
}
