// Every number here is a starting hypothesis from the orchestration spec, not a
// measured result. Tune them from real behavior; don't read them as provider facts.

import type { Product, Provider } from './types';

export const FUSION_VERSION = 'fusion-v1';
export const MAPPING_VERSION = 1;

/** Kill switches. Turning a provider off here stops fetching and blending it. */
export const ENABLED: Record<Provider, boolean> = { nws: true, openweather: true, tomorrow: true, weatherapi: true };

/** Modest US prior for NWS: a product assumption, not measured superiority. */
export function prior(p: Provider, nwsCovers: boolean): number {
  if (!nwsCovers) return 1;
  return p === 'nws' ? 0.4 : 0.2;
}

export const HALF_LIFE_MS = { current: 20 * 60_000, hourly: 3 * 3_600_000, daily: 12 * 3_600_000 };

/**
 * Sources with no issue time get this flat factor, as if one half-life old. Their
 * age is unknown, so it can't decay, and a higher value lets them outrank a
 * few-hours-old NWS run purely for lacking a timestamp.
 */
export const UNKNOWN_AGE_FRESHNESS = 0.5;

/** Age limits by provider and product family, in ms. NWS keeps its normal issuance cadence during events. */
export const HARD_AGE = {
  observationMs: 60 * 60_000, observationEventMs: 20 * 60_000,
  hourly: { routineMs: 12 * 3_600_000, eventMs: 6 * 3_600_000, nwsEventMs: 12 * 3_600_000 },
  dailyMs: 24 * 3_600_000,
  /** Without an issue time, how long since content first appeared before it stops being used. */
  unknownAgeMs: 6 * 3_600_000,
};

export const FUTURE_TOLERANCE_MS = 2 * 60_000;

/** Minutes between refreshes: [calm, event]. */
export const REFRESH_MIN: Record<'observation' | 'current' | 'hourly' | 'daily' | 'challenger', [number, number]> = {
  observation: [12, 7], current: [15, 10], hourly: [45, 12], daily: [240, 120], challenger: [120, 15],
};

export const ALERT_POLL_MS = 60_000;
export const ALERT_STALE_MS = 3 * 60_000;
export const POINT_TTL_MS = 7 * 24 * 3_600_000;

export const TRIGGERS = {
  popWatch: 0.3, // comparable probability in the next 90 minutes
  popSpread: 0.35, tempSpreadC: 3, windSpreadMs: 5,
  dangerousGustMs: 18,
  lowVisibilityM: 1600,
  /** Two calm evaluations and 30 calm minutes to leave an event. */
  calmEvaluations: 2, calmMs: 30 * 60_000,
  /** An event with no new evidence stops accelerating after this. */
  eventCapMs: 3 * 3_600_000,
};

export const OBS_LIMITS = { maxDistanceKm: 40, maxElevationDiffM: 150, stationsToTry: 3 };

/** Bootstrap probabilities, to be replaced by measured values. */
export const USABLE_RESPONSE_P = 0.8;
export const INITIAL_CHANGE_P = 0.5;

/** Which commercial product is the forecast, in fixed fallback order when NWS doesn't cover a place. */
export const COMMERCIAL: Provider[] = ['weatherapi', 'tomorrow', 'openweather'];

export const TIMEOUT_MS: Partial<Record<Provider, number>> & { default: number } = { default: 3000, nws: 8000 };

export const key = (p: Provider, product: Product) => `${p}:${product}`;
