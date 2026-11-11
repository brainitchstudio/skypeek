export const BETA_SCENE_COOKIE = 'sky-peek-beta-scene';

export const TIMES = ['morning', 'afternoon', 'evening', 'night'] as const;
export const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'storm', 'fog'] as const;
export type Scene = { time: (typeof TIMES)[number]; weather: (typeof WEATHERS)[number] };

export function parseScene(time?: string, weather?: string): Scene | null {
  if (!TIMES.includes(time as Scene['time']) || !WEATHERS.includes(weather as Scene['weather'])) return null;
  return { time: time as Scene['time'], weather: weather as Scene['weather'] };
}

export function pickScene(time?: string, weather?: string): Scene {
  return parseScene(time, weather) ?? {
    time: TIMES[Math.floor(Math.random() * TIMES.length)],
    weather: WEATHERS[Math.floor(Math.random() * WEATHERS.length)],
  };
}
