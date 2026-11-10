import { describe, expect, it } from 'vitest';
import { cleanText, levelOf, mapAlert, routeAlert, splitInstructions } from './alerts';
import { dailyOutlook, hourlyOutlook, mapDays, mapHours, mergeExtended, parseWind, todaySummary, type NwsPeriod } from './forecast';
import { clock, iconFor, temp } from './format';
import type { Day, Forecast, Hour } from './types';

const TZ = 'America/New_York';
const period = (o: Partial<NwsPeriod>): NwsPeriod => ({
  name: 'x', startTime: '2026-11-04T06:00:00-05:00', isDaytime: true, temperature: 70, windSpeed: '5 mph',
  shortForecast: 'Sunny', detailedForecast: 'Sunny.', probabilityOfPrecipitation: { value: 0 }, ...o,
});
const hour = (start: string, pop: number, icon: Hour['icon'] = 'rain'): Hour =>
  ({ start, pop, icon, tempF: 60, condition: '', isDaytime: true, windMph: 5 });

describe('format', () => {
  it('converts units', () => { expect(temp(212, 'C')).toBe('100°'); expect(temp(null, 'F')).toBe('–'); });
  it('maps forecast text to icons', () => {
    expect(iconFor('Chance Showers And Thunderstorms')).toBe('storm');
    expect(iconFor('Mostly Cloudy')).toBe('cloud');
    expect(iconFor('Partly Sunny')).toBe('partly');
    expect(iconFor('Slight Chance Light Rain')).toBe('rain');
    expect(iconFor('Light Snow Likely')).toBe('snow');
    expect(iconFor('Clear')).toBe('sun');
    expect(iconFor('Clear', false)).toBe('moon');
    expect(iconFor('Mostly Clear', false)).toBe('partly-night');
    expect(iconFor('Partly Cloudy', false)).toBe('partly-night');
    expect(iconFor('Light Rain', false)).toBe('rain');
  });
  it('formats clock times in the place time zone', () => {
    expect(clock(new Date('2026-11-04T23:00:00Z'), TZ)).toBe('6 PM');
    expect(clock(new Date('2026-11-04T23:30:00Z'), TZ)).toBe('6:30 PM');
  });
});

describe('forecast', () => {
  it('parses wind ranges to the top speed', () => { expect(parseWind('5 to 10 mph')).toBe(10); expect(parseWind('')).toBeNull(); });

  it('drops hours already over but keeps the current one', () => {
    const now = new Date('2026-11-04T17:30:00Z');
    const out = mapHours([period({ startTime: '2026-11-04T15:00:00Z' }), period({ startTime: '2026-11-04T17:00:00Z' })], now);
    expect(out.map(h => h.start)).toEqual(['2026-11-04T17:00:00Z']);
  });

  it('folds day and night periods into one day', () => {
    const now = new Date('2026-11-04T15:00:00Z');
    const days = mapDays([
      period({ temperature: 72, probabilityOfPrecipitation: { value: 30 } }),
      period({ startTime: '2026-11-04T18:00:00-05:00', isDaytime: false, temperature: 58, probabilityOfPrecipitation: { value: 90 }, windSpeed: '10 to 20 mph' }),
    ], [], TZ, now);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ short: 'Today', dateLabel: 'Wed, Nov 4', hiF: 72, loF: 58, pop: 90, windMph: 20 });
  });

  it("uses the evening low, not the leftover overnight period, after midnight", () => {
    const days = mapDays([
      period({ startTime: '2026-11-05T00:00:00-05:00', isDaytime: false, temperature: 63 }),
      period({ startTime: '2026-11-05T06:00:00-05:00', temperature: 71 }),
      period({ startTime: '2026-11-05T18:00:00-05:00', isDaytime: false, temperature: 56 }),
    ], [], TZ, new Date('2026-11-05T05:00:00Z'));
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ hiF: 71, loF: 56 });
  });

  it('uses night icons for night hours and a day that has only a night period', () => {
    const now = new Date('2026-11-04T23:30:00Z');
    const night = period({ startTime: '2026-11-04T18:00:00-05:00', isDaytime: false, shortForecast: 'Clear' });
    expect(mapHours([night], now)[0]).toMatchObject({ icon: 'moon', isDaytime: false });
    expect(mapDays([night], [], TZ, now)[0].icon).toBe('moon');
  });

  it('keeps the day icon when a date has both periods', () => {
    const days = mapDays([
      period({ shortForecast: 'Sunny' }),
      period({ startTime: '2026-11-04T18:00:00-05:00', isDaytime: false, shortForecast: 'Clear' }),
    ], [], TZ, new Date('2026-11-04T15:00:00Z'));
    expect(days[0].icon).toBe('sun');
  });

  it('takes the high from hourly data when the forecast starts at night', () => {
    const now = new Date('2026-11-04T23:30:00Z');
    const days = mapDays(
      [period({ startTime: '2026-11-04T18:00:00-05:00', isDaytime: false, temperature: 50 })],
      [{ ...hour('2026-11-04T18:00:00-05:00', 0), tempF: 61 }], TZ, now,
    );
    expect(days[0]).toMatchObject({ hiF: 61, loF: 50 });
  });

  it('extends to ten days and fills a missing low without replacing NWS data', () => {
    const base = mapDays([period({ temperature: 70 })], [], TZ, new Date('2026-11-04T15:00:00Z'));
    const ext = ['04', '05', '06'].map(d => ({ date: `2026-11-${d}`, hiF: 50, loF: 40, icon: 'sun' as const, pop: 0, windMph: 5 }));
    const out = mergeExtended(base, ext, '2026-11-04');
    expect(out.map(d => d.date)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    expect(out[0]).toMatchObject({ hiF: 70, loF: 40 });
    expect(out[1]).toMatchObject({ short: 'Thu', name: 'Thursday', dateLabel: 'Thu, Nov 5' });
  });

  it('writes outlooks from the data', () => {
    const lab = (s: string) => s;
    expect(hourlyOutlook([hour('a', 0), hour('b', 80, 'storm'), hour('c', 70), hour('d', 0)], lab)).toBe('Storms likely b – d.');
    expect(hourlyOutlook([hour('a', 0)], lab)).toBe('Dry for the next 24 hours.');
    expect(dailyOutlook([], String)).toBe('Mostly dry.');
  });
});

describe('todaySummary', () => {
  const NOV5_MIDNIGHT = Date.parse('2026-11-05T05:00:00Z'); // New York, UTC-5
  const at = (localHour: number, minute = 0) => new Date(NOV5_MIDNIGHT + (localHour * 60 + minute) * 60_000);

  /** Hourly data from `start` for 40 hours: 42° at 5 AM, 61° at 2 PM, otherwise 50°. */
  function series(start: Date, edit: (h: Hour, localHour: number, offset: number) => Partial<Hour> = () => ({})): Hour[] {
    const first = Math.floor(start.getTime() / 3_600_000) * 3_600_000;
    return Array.from({ length: 40 }, (_, i) => {
      const t = first + i * 3_600_000;
      const local = new Date(t - 5 * 3_600_000).getUTCHours();
      const offset = (t - NOV5_MIDNIGHT) / 3_600_000;
      const day = local >= 6 && local < 18;
      const h: Hour = {
        start: new Date(t).toISOString(), tempF: local === 5 ? 42 : local === 14 ? 61 : 50, icon: day ? 'sun' : 'moon',
        condition: day ? 'Sunny' : 'Clear', isDaytime: day, pop: 0, windMph: 5,
      };
      return { ...h, ...edit(h, local, offset) };
    });
  }
  const day = (date: string, hiF: number | null, loF: number | null): Day =>
    ({ date, short: '', name: '', dateLabel: '', hiF, loF, icon: 'sun', pop: 0, windMph: 5, summary: '' });
  const forecast = (hours: Hour[], days = [day('2026-11-05', 61, 42), day('2026-11-06', 63, 44)]): Forecast =>
    ({ timeZone: TZ, hours, days, narrative: 'From NWS.' });
  const read = (parts: string[]) => parts.join(' ').replaceAll('\u00a0', ' ');
  const say = (now: Date, edit?: Parameters<typeof series>[1], units: 'F' | 'C' = 'F') =>
    read(todaySummary(forecast(series(now, edit)), units, now));

  it('looks at the rest of the day and tonight in the morning', () => {
    expect(say(at(8))).toBe('Sunny today, high near 61°. Clear tonight, low around 42°.');
  });

  it('looks at the afternoon and tonight in the afternoon', () => {
    expect(say(at(13))).toBe('Sunny this afternoon, high near 61°. Clear tonight, low around 42°.');
  });

  it('drops the high once it has passed', () => {
    expect(say(at(16))).toBe('Sunny this afternoon. Clear tonight, low around 42°.');
  });

  it('looks at tonight and tomorrow in the evening', () => {
    expect(say(at(19))).toBe('Clear tonight, low around 42°. Tomorrow looks sunny, high near 63°.');
  });

  it('looks at overnight and the morning late at night', () => {
    expect(say(at(22))).toBe('Clear overnight, low around 42° by 5 AM. Sunny morning, high near 63°.');
  });

  it("after midnight uses the coming hours for the low and today's high", () => {
    const now = at(25); // 1 AM Friday
    const out = read(todaySummary(forecast(series(now), [day('2026-11-06', 63, 55)]), 'F', now));
    expect(out).toBe('Clear overnight, low around 42° by 5 AM. Sunny morning, high near 63°.');
  });

  it('leaves out the time when the low is right now', () => {
    const out = say(at(22), (_, __, offset) => ({ tempF: offset === 22 ? 40 : 50 }));
    expect(out).toContain('low around 40°.');
  });

  it.each([
    [4, 59, 'overnight'], [5, 0, 'today'], [10, 59, 'today'], [11, 0, 'this afternoon'],
    [16, 59, 'this afternoon'], [17, 0, 'tonight'], [20, 59, 'tonight'], [21, 0, 'overnight'],
  ])('switches at %i:%i', (h, m, word) => {
    expect(say(at(h, m)).split(/[,.]/)[0]).toMatch(new RegExp(`${word}$`));
  });

  it('goes by the time at the place, not on this machine', () => {
    const now = at(22);
    const out = read(todaySummary({ ...forecast(series(now)), timeZone: 'America/Los_Angeles' }, 'F', now));
    expect(out).toMatch(/^Clear tonight/); // 7 PM in Los Angeles
  });

  it('says when rain starts', () => {
    const out = say(at(13), (_, __, o) => ({ pop: o >= 20 ? 80 : 0, icon: o >= 20 ? 'rain' : 'sun' }));
    expect(out).toBe('Sunny this afternoon, high near 61°. Rain likely tonight after 8 PM, low around 42°.');
  });

  it('says when rain stops', () => {
    const out = say(at(19), (_, __, o) => ({ pop: o < 23 ? 80 : 0, icon: 'rain' }));
    expect(out).toContain('Rain likely tonight until 11 PM, low around 42°.');
  });

  it('gives both ends of a shower in the middle of a window', () => {
    const out = say(at(19), (_, __, o) => ({ pop: o >= 21 && o < 24 ? 60 : 0, icon: 'snow' }));
    expect(out).toContain('Snow likely tonight 9 PM – 12 AM, low around 42°.');
  });

  it('skips the time when it is wet all window long', () => {
    const out = say(at(19), () => ({ pop: 90, icon: 'storm' }));
    expect(out).toBe('Storms likely tonight, low around 42°. Storms likely tomorrow, high near 63°.');
  });

  it('ignores low chances', () => {
    expect(say(at(19), () => ({ pop: 40 }))).toBe('Clear tonight, low around 42°. Tomorrow looks sunny, high near 63°.');
  });

  it('keeps a low chance of rain readable', () => {
    const chance = (h: Hour) => (h.isDaytime ? { condition: 'Chance Light Rain', pop: 30, icon: 'rain' as const } : {});
    expect(say(at(22), chance)).toContain('Chance light rain tomorrow morning, high near 63°.');
    expect(say(at(25), chance)).toContain('Chance light rain this morning, high near 63°.');
    expect(say(at(19), chance)).toContain('Chance light rain tomorrow, high near 63°.');
  });

  it('only mentions wind when it matters', () => {
    expect(say(at(19), () => ({ windMph: 14 }))).not.toContain('mph');
    expect(say(at(19), (_, __, o) => ({ windMph: o === 22 ? 25 : 5 }))).toMatch(/ Winds up to 25 mph\.$/);
  });

  it('ignores wind beyond the period it describes', () => {
    expect(say(at(19), (_, __, o) => ({ windMph: o >= 42 ? 40 : 5 }))).not.toContain('mph');
  });

  it('follows the temperature units', () => {
    expect(say(at(19), undefined, 'C')).toBe('Clear tonight, low around 6°. Tomorrow looks sunny, high near 17°.');
  });

  it('returns each sentence on its own so the screen can break between them', () => {
    const now = at(19);
    const hours = series(now, () => ({ windMph: 20 }));
    expect(todaySummary(forecast(hours), 'F', now)).toEqual([
      'Clear tonight, low around 42°.', 'Tomorrow looks sunny, high near 63°.', 'Winds up to 20 mph.',
    ]);
  });

  it('never splits a time across lines', () => {
    const [night] = todaySummary(forecast(series(at(22))), 'F', at(22));
    expect(night).toContain('by 5\u00a0AM.');
    const [tonight] = todaySummary(forecast(series(at(19), (_, __, o) => ({ pop: o >= 21 && o < 24 ? 60 : 0 }))), 'F', at(19));
    expect(tonight).toContain('9\u00a0PM – 12\u00a0AM');
  });

  it('falls back to NWS text without enough hourly data', () => {
    const now = at(19);
    expect(todaySummary(forecast(series(now).slice(0, 2)), 'F', now)).toEqual(['From NWS.']);
  });

  it('uses the hourly data when a day has no high or low', () => {
    const now = at(8);
    const out = read(todaySummary(forecast(series(now), [day('2026-11-05', null, null)]), 'F', now));
    expect(out).toBe('Sunny today, high near 61°. Clear tonight, low around 42°.');
  });
});

describe('alerts', () => {
  it('classifies levels', () => {
    expect(levelOf('Flood Watch')).toBe('Watch');
    expect(levelOf('Special Weather Statement')).toBe('Statement');
    expect(levelOf('Hurricane Force Wind Warning')).toBe('Warning');
  });
  it('unwraps text and splits instructions', () => {
    expect(cleanText('one\ntwo\n\nthree')).toBe('one two\n\nthree');
    expect(splitInstructions('Move indoors. Stay away\nfrom windows.')).toEqual(['Move indoors.', 'Stay away from windows.']);
  });
  it('maps an NWS feature', () => {
    const a = mapAlert({ id: 'x', geometry: null, properties: {
      event: 'Severe Thunderstorm Watch', areaDesc: 'Kings; Queens', onset: '2026-11-04T18:00:00-05:00', ends: '2026-11-04T23:00:00-05:00',
    } }, TZ, new Date('2026-11-04T17:00:00Z'));
    expect(a).toMatchObject({ level: 'Watch', when: 'Today 6 PM – 11 PM', until: 'until 11 PM', area: 'Kings +1' });
    expect(a.timeline.left).toBe('75%');
    expect(parseFloat(a.timeline.width)).toBeCloseTo(20.83, 1);
    expect(parseFloat(a.timeline.now)).toBeCloseTo(50, 1);
  });
  it('widens the timeline for an alert that runs into the next day', () => {
    const a = mapAlert({ id: 'x', geometry: null, properties: {
      event: 'Flood Warning', onset: '2026-11-04T18:00:00-05:00', ends: '2026-11-05T06:00:00-05:00',
    } }, TZ, new Date('2026-11-05T06:00:00Z'));
    expect(a.timeline.left).toBe('37.5%');
    expect(a.timeline.width).toBe('25%');
    expect(a.timeline.ticks).toEqual(['Wed 12 AM', '12 PM', 'Today 12 AM', '12 PM', '12 AM']);
  });
  it('routes by type or tier', () => {
    const p = { mode: 'types' as const, types: [true, true, true, true, true, true, false, true, false], tiers: [0, 1, 2] };
    expect(routeAlert('Advisory', 'Heat Advisory', p)).toBe('off');
    expect(routeAlert('Warning', 'Fire Warning', p)).toBe('notify');
    const q = { ...p, mode: 'tiers' as const };
    expect(routeAlert('Warning', 'x', q)).toBe('notify');
    expect(routeAlert('Watch', 'x', q)).toBe('banner');
    expect(routeAlert('Statement', 'x', q)).toBe('off');
  });
});
