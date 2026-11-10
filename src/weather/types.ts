// Canonical weather data. Fusion works in these units only: Celsius, m/s,
// probabilities in [0,1]. Missing is null, never zero. Times are epoch ms in UTC,
// and an interval is [start, end).

import type { NwsPeriod } from '@/lib/forecast';

export type Provider = 'nws' | 'openweather' | 'tomorrow' | 'weatherapi';
export type Product = 'hourly' | 'daily' | 'observation' | 'current' | 'forecast';

/** Versioned condition taxonomy. Never averaged; selected or reconciled. */
export type Cond = 'clear' | 'cloudy' | 'rain' | 'snow' | 'mixed' | 'freezing' | 'thunder' | 'fog' | 'unknown';

/** One source's forecast for one time step. */
export type Point = {
  start: number; end: number;
  tempC: number | null; dewC: number | null;
  windMs: number | null; windDeg: number | null; gustMs: number | null;
  pop: number | null; cloud: number | null;
  cond: Cond; text: string; isDay: boolean | null;
};

export type DayFact = { date: string; hiC: number | null; loC: number | null; cond: Cond; text: string };

/** What was measured or analyzed at a moment, kept apart from forecasts. */
export type Fact = {
  kind: 'observation' | 'analysis';
  at: number; // observed time, never fetch time
  tempC: number | null; dewC: number | null;
  windMs: number | null; windDeg: number | null; gustMs: number | null;
  visM: number | null;
  cond: Cond; text: string;
  stationId?: string; distanceKm?: number; elevationDiffM?: number; qualityFlags: string[];
};

/** Declared meaning of a batch's fields, so incompatible values can't blend. */
export type Semantics = {
  pop: 'any_precip_1h' | 'any_precip_3h' | 'rain_only_1h' | null;
  wind: 'mean' | 'unresolved' | null;
  stepHours: number;
  /** Largest gap continuous fields may be interpolated across. */
  maxInterpHours: number;
  /** 'calendar' days can blend highs; 'nws-periods' lows run into the next morning. */
  days: 'calendar' | 'nws-periods' | null;
};

/** An immutable set of facts from one fetch of one product. */
export type Batch = {
  provider: Provider; product: Product; apiVersion: string; mapping: number;
  issuedAt: number | null; // null means unknown, never fetch time
  fetchedAt: number;
  availableAt: number;
  firstSeenAt: number; // when this content was first seen; a re-fetch doesn't reset it
  fingerprint: string;
  semantics: Semantics;
  points: Point[];
  days: DayFact[];
  fact: Fact | null;
  /** NWS periods kept for the existing text-based forecast builder. */
  periods?: NwsPeriod[];
  timeZone?: string;
  elevationM?: number | null;
  flags: string[];
};

export type Agreement = 'high' | 'medium' | 'low' | 'single';
export type Contribution = { provider: Provider; weight: number };

export type FailureKind = 'rate' | 'quota' | 'auth' | 'entitlement' | 'coverage' | 'server' | 'network' | 'schema';
export type ProviderFailure = { kind: FailureKind; message: string; resetAt?: number };

export type ProductState = {
  lastFetch: number; // last attempt that returned usable data
  nextAt: number; // not before this time
  change: number; // moving estimate of P(a fetch brings new content)
  failures: number;
  lastError?: string;
  lastErrorKind?: FailureKind;
};
