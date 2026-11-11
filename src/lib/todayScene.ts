import { hourOf } from './format';

export type TodayTime = 'morning' | 'afternoon' | 'evening' | 'night';
export type TodayWeather = 'clear' | 'partly' | 'cloudy' | 'windy' | 'fog' | 'haze' | 'drizzle' | 'rain' | 'sleet' | 'hail' | 'snow' | 'storm' | 'heat';
export type TodayScene = { time: TodayTime; weather: TodayWeather };

/** The clock belongs to the saved location, rather than the visitor's device. */
export function timeForPlace(at: Date, timeZone: string, isDaytime?: boolean): TodayTime {
  const hour = hourOf(at, timeZone);
  if (isDaytime === false || hour < 5 || hour >= 20) return 'night';
  if (hour < 11) return 'morning';
  if (hour >= 17) return 'evening';
  return 'afternoon';
}

/** Match active conditions before the wind and temperature accents. */
export function weatherForPlace(condition: string, windMph: number | null, tempF: number | null, forecastOnly = false): TodayWeather {
  const text = condition.toLowerCase();
  // A chance in the hourly forecast does not mean precipitation is happening now.
  const possibleOnly = forecastOnly && /\b(chance|possible|isolated|scattered)\b/.test(text);
  if (!possibleOnly) {
    if (/thunder|t-storm|tstorm|lightning/.test(text)) return 'storm';
    if (/hail/.test(text)) return 'hail';
    if (/sleet|ice pellets?|wintry mix|freezing rain|freezing drizzle|rain and snow/.test(text)) return 'sleet';
    if (/snow|flurr|blizzard/.test(text)) return 'snow';
    if (/drizzle/.test(text)) return 'drizzle';
    if (/rain|shower/.test(text)) return 'rain';
  }
  if (/fog|mist/.test(text)) return 'fog';
  if (/haze|smoke|dust/.test(text)) return 'haze';
  if (/overcast|mostly cloudy|cloudy/.test(text) && !/partly cloudy/.test(text)) return 'cloudy';
  if (/partly|mostly sunny|mostly clear|few clouds/.test(text)) return 'partly';
  if ((windMph ?? 0) >= 25 || /\bwindy\b/.test(text)) return 'windy';
  if ((tempF ?? 0) >= 95 && !possibleOnly) return 'heat';
  return possibleOnly ? 'cloudy' : 'clear';
}

export function todayScene(at: Date, timeZone: string, condition: string, windMph: number | null, tempF: number | null, forecastOnly = false, isDaytime?: boolean): TodayScene {
  return { time: timeForPlace(at, timeZone, isDaytime), weather: weatherForPlace(condition, windMph, tempF, forecastOnly) };
}
