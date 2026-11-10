import type { Geometry } from 'geojson';
import type { Agreement, Contribution } from '@/weather/types';

export type IconKind = 'sun' | 'moon' | 'partly' | 'partly-night' | 'cloud' | 'rain' | 'snow' | 'storm' | 'none';

export type Place = { id: string; name: string; region: string; lat: number; lon: number; favorite?: boolean };

export type Hour = {
  start: string; // ISO timestamp with the place's UTC offset
  tempF: number;
  icon: IconKind;
  condition: string;
  isDaytime: boolean;
  pop: number | null; // null means no source gave one, not 0%
  /** Set when `pop` isn't a normal one-hour chance of any precipitation. */
  popKind?: 'rain' | '3h';
  windMph: number | null;
  agreement?: Agreement;
  sources?: Contribution[];
  windDeg?: number | null;
  windVariable?: boolean;
  thunderPossible?: boolean;
  flags?: string[];
};

export type Day = {
  date: string; // YYYY-MM-DD in the place's time zone
  short: string; // "Today", "Thu"
  name: string; // "Today", "Thursday"
  dateLabel: string; // "Wed, Nov 4"
  hiF: number | null;
  hiEstimated?: boolean; // taken from hourly samples, which can miss the true high
  loF: number | null;
  icon: IconKind;
  pop: number | null;
  windMph: number | null;
  summary: string;
  source?: string; // who wrote this day's text
  highFrom?: string; // who the high came from, when that's someone else
};

export type Forecast = {
  timeZone: string;
  hours: Hour[];
  days: Day[];
  narrative: string;
};

export type AlertLevel = 'Warning' | 'Watch' | 'Advisory' | 'Statement';

export type WeatherAlert = {
  id: string;
  title: string;
  level: AlertLevel;
  color: string;
  fg: string;
  when: string;
  until: string;
  area: string;
  sender: string;
  body: string;
  todo: string[];
  instructionText?: string;
  timeline: { left: string; width: string; now: string; ticks: string[] };
  geometry: Geometry | null;
  countyFips?: string[];
  motionText?: string; endsAt?: number | null; cancelled?: boolean;
  notifyKey?: string; // the same across updates, new on escalation
};

export type LiveConditions = {
  provider: number;
  tempF: number;
  desc: string;
  place: string;
  windMph?: number;
  rainPct?: number;
  at: string;
};
