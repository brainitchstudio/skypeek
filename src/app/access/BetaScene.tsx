import type { CSSProperties } from 'react';

type Time = 'morning' | 'afternoon' | 'evening' | 'night';
type Weather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog';
const TIMES: Time[] = ['morning', 'afternoon', 'evening', 'night'];
const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'snow', 'storm', 'fog'];

type Palette = {
  sky: Record<Weather, string>;
  hills: [string, string]; snowHills: [string, string];
  cloud: string; rainCloud: string; stormCloud: string;
  dark: string; orb: string; ring: string; orbX: string; orbY: string; fog: string;
};
const PALETTES: Record<Time, Palette> = {
  morning: {
    sky: { clear: '#FBE1C6', cloudy: '#EADBD0', rain: '#C8C4CB', snow: '#DCD3D4', storm: '#A29DAB', fog: '#F0E6DD' },
    hills: ['#F2BE9F', '#E19F84'], snowHills: ['#FFFFFF', '#F1E9E8'],
    cloud: '#FFF7EE', rainCloud: '#B4ACB4', stormCloud: '#827C8E',
    dark: '#3A2130', orb: '#FFF2D2', ring: '#FFE3B3', orbX: '16%', orbY: '50%', fog: '#FFFFFF',
  },
  afternoon: {
    sky: { clear: '#9CCDF2', cloudy: '#B7C6D3', rain: '#8E9DAC', snow: '#BCC9D6', storm: '#58667A', fog: '#C9D4DC' },
    hills: ['#A9D39B', '#7FB77E'], snowHills: ['#FFFFFF', '#E6EDF4'],
    cloud: '#FFFFFF', rainCloud: '#7C8898', stormCloud: '#3F4A5C',
    dark: '#0E2A47', orb: '#FFE07A', ring: '#FFF0B8', orbX: '82%', orbY: '16%', fog: '#FFFFFF',
  },
  evening: {
    sky: { clear: '#F28C6B', cloudy: '#C99A92', rain: '#9E7F86', snow: '#CBAFB1', storm: '#5A4358', fog: '#E3B7A6' },
    hills: ['#B65A6D', '#7D3B5E'], snowHills: ['#F6E6E3', '#E2CCCC'],
    cloud: '#FBC5A6', rainCloud: '#8A6C78', stormCloud: '#43303F',
    dark: '#2A0E22', orb: '#FFD79A', ring: '#FFB27A', orbX: '80%', orbY: '56%', fog: '#FFE7DC',
  },
  night: {
    sky: { clear: '#121A3B', cloudy: '#1B2238', rain: '#161C2C', snow: '#232B45', storm: '#0D111D', fog: '#20283F' },
    hills: ['#1F2856', '#0B1129'], snowHills: ['#C7D0E6', '#9CA8C8'],
    cloud: '#2B3563', rainCloud: '#2A3142', stormCloud: '#1B2030',
    dark: '#0B1029', orb: '#F1F4FF', ring: '#2C3870', orbX: '80%', orbY: '18%', fog: '#3A4466',
  },
};

function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const [r, g, b] = rgb.map(value => {
    const v = value / 255;
    return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  });
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + .05) / (low + .05);
}
function random(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickScene(time?: string, weather?: string): { time: Time; weather: Weather } {
  return {
    time: TIMES.includes(time as Time) ? time as Time : TIMES[Math.floor(Math.random() * TIMES.length)],
    weather: WEATHERS.includes(weather as Weather) ? weather as Weather : WEATHERS[Math.floor(Math.random() * WEATHERS.length)],
  };
}

export function BetaScene({ time, weather, invalid, unavailable }: {
  time: Time; weather: Weather; invalid: boolean; unavailable: boolean;
}) {
  const p = PALETTES[time];
  const sky = p.sky[weather];
  const light = '#F5F7FC';
  const ink = contrast(sky, p.dark) >= contrast(sky, light) ? p.dark : light;
  const rand = random((TIMES.indexOf(time) + 1) * 7919 + (WEATHERS.indexOf(weather) + 1) * 104729);
  const range = (a: number, b: number) => a + (b - a) * rand();
  const rounded = (n: number) => Math.round(n * 10) / 10;
  const heavy = weather === 'cloudy' || weather === 'rain' || weather === 'storm';
  const cloudCount = { clear: 3, cloudy: 7, rain: 6, snow: 5, storm: 8, fog: 2 }[weather];
  const cloudColor = weather === 'rain' ? p.rainCloud : weather === 'storm' ? p.stormCloud : p.cloud;
  const hills = weather === 'snow' ? p.snowHills : p.hills;
  const inkRgb = Number.parseInt(ink.slice(1), 16);
  const dropColor = `rgba(${(inkRgb >> 16) & 255},${(inkRgb >> 8) & 255},${inkRgb & 255},${ink === light ? .45 : .35})`;
  const sceneStyle = { '--sp-sky': sky, '--sp-ink': ink } as CSSProperties;
  const showOrb = weather === 'clear' || weather === 'cloudy' || weather === 'fog';
  const showStars = time === 'night' && (weather === 'clear' || weather === 'fog');

  return <div className="sp-gate" style={sceneStyle} data-scene={`${time}-${weather}`}>
    <div className="sp-scene" aria-hidden="true">
      {showStars && Array.from({ length: 70 }, (_, i) => <i key={`star-${i}`} className="sp-anim sp-twinkle sp-star" style={{
        left: `${rounded(range(0, 100))}%`, top: `${rounded(range(0, 66))}%`,
        width: `${rounded(range(1.2, 3))}px`, height: `${rounded(range(1.2, 3))}px`,
        animationDuration: `${rounded(range(2, 5.5))}s`, animationDelay: `${rounded(-range(0, 5))}s`,
      }} />)}
      {showOrb && <div className="sp-orb" style={{ left: p.orbX, top: p.orbY, opacity: weather === 'fog' ? .55 : 1 }}>
        <i className="sp-anim sp-pulse sp-orb-pulse" style={{ background: p.ring }} />
        <i className="sp-orb-ring" style={{ background: p.ring }} />
        <i className="sp-orb-core" style={{ background: p.orb }} />
        {time === 'night' && <i className="sp-orb-crescent" style={{ background: sky }} />}
      </div>}
      {Array.from({ length: cloudCount }, (_, i) => {
        const duration = weather === 'storm' ? range(38, 70) : range(70, 150);
        return <div key={`cloud-${i}`} className="sp-anim sp-drift sp-cloud" style={{
          top: `${rounded(range(2, heavy ? 40 : 34))}%`, width: `${Math.round(heavy ? range(260, 460) : range(170, 320))}px`,
          opacity: rounded(heavy ? range(.85, 1) : range(.7, 1)), animationDuration: `${rounded(duration)}s`,
          animationDelay: `${rounded(-range(0, duration))}s`,
        }}><svg viewBox="0 0 200 92" aria-hidden="true"><g fill={cloudColor}>
          <circle cx="52" cy="58" r="30" /><circle cx="98" cy="42" r="40" /><circle cx="146" cy="58" r="30" />
          <rect x="22" y="56" width="156" height="36" rx="18" />
        </g></svg></div>;
      })}
      <svg className="sp-hills" viewBox="0 0 1440 300" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 120 C 180 60, 360 70, 560 110 S 920 60, 1120 90 S 1360 120, 1440 100 L 1440 300 L 0 300 Z" fill={hills[0]} />
        <path d="M0 210 C 240 150, 480 190, 720 175 S 1180 140, 1440 190 L 1440 300 L 0 300 Z" fill={hills[1]} />
      </svg>
      {weather === 'fog' && [
        { y: 38, h: 70, o: .45, dur: 14, delay: 0 },
        { y: 56, h: 90, o: .4, dur: 18, delay: -6 },
        { y: 72, h: 110, o: .55, dur: 22, delay: -11 },
      ].map((fog, i) => <i key={`fog-${i}`} className="sp-anim sp-sway sp-fog" style={{ top: `${fog.y}%`, height: fog.h, opacity: fog.o, background: p.fog, animationDuration: `${fog.dur}s`, animationDelay: `${fog.delay}s` }} />)}
      {(weather === 'rain' || weather === 'storm') && Array.from({ length: weather === 'storm' ? 120 : 80 }, (_, i) => {
        const duration = range(.7, 1.3);
        return <i key={`rain-${i}`} className="sp-anim sp-fall sp-drop" style={{
          left: `${rounded(range(-5, 125))}%`, height: `${Math.round(range(18, 34))}px`,
          background: dropColor, animationDuration: `${rounded(duration)}s`, animationDelay: `${rounded(-range(0, duration))}s`,
        }} />;
      })}
      {weather === 'snow' && Array.from({ length: 90 }, (_, i) => {
        const duration = range(9, 18);
        const size = rounded(range(3, 9));
        return <i key={`snow-${i}`} className="sp-anim sp-snow sp-flake" style={{
          left: `${rounded(range(0, 100))}%`, width: size, height: size,
          opacity: rounded(range(.7, 1)), animationDuration: `${rounded(duration)}s`, animationDelay: `${rounded(-range(0, duration))}s`,
        }} />;
      })}
      {weather === 'storm' && <><i className="sp-anim sp-flash sp-flash-screen" />
        <svg className="sp-anim sp-flash sp-bolt" viewBox="0 0 60 140" aria-hidden="true"><path d="M34 0 L6 76 L28 76 L16 140 L56 52 L32 52 L46 0 Z" fill="#FFF3B8" /></svg>
      </>}
    </div>
    <main className="sp-main">
      <h1 className="sp-logo">Sky Peek</h1>
      {unavailable ? <p className="sp-error" role="alert">Beta access is temporarily unavailable.</p> : <>
        <form action="/api/access" method="post" className="sp-form">
          <label htmlFor="beta-code" className="sp-sr-only">Beta code</label>
          <input id="beta-code" className="sp-code" name="code" type="password" autoComplete="off" placeholder="Enter code" required maxLength={128} aria-invalid={invalid} aria-describedby={invalid ? 'access-error' : undefined} />
          <button type="submit" className="sp-enter">Enter <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
        </form>
        {invalid && <p id="access-error" className="sp-error" role="alert">That code didn’t work. Check it and try again.</p>}
        <p className="sp-invite">No code yet? Ask the person who invited you.</p>
      </>}
    </main>
  </div>;
}
