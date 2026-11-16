import type { Units } from './format';

export type Coordinates = { lat: number; lon: number };
export type DeviceFix = Coordinates & { accuracy: number; at: number };
export type LocationDescription = {
  town?: { name: string; distanceM: number; bearing: number };
  region?: string;
  road?: string;
  landmark?: string;
  mapped?: boolean;
};

export function distanceM(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Direction from the reference town toward the device, not the reverse. */
export function bearingFrom(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180, d = (b.lon - a.lon) * rad;
  return (Math.atan2(Math.sin(d) * Math.cos(b.lat * rad), Math.cos(a.lat * rad) * Math.sin(b.lat * rad)
    - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(d)) / rad + 360) % 360;
}

export function describeLocation(description: LocationDescription | null, accuracy: number, units: Units) {
  const approximate = accuracy > 1000;
  if (!description) return { name: 'Your location', detail: 'Place name unavailable' };
  const { town, region } = description;
  const near = town ? `Near ${town.name}` : region;
  if (accuracy <= 50 && description.landmark) return { name: `Near ${description.landmark}`, detail: near ?? '' };
  if (town) {
    if (!approximate && town.distanceM >= 8000) {
      const metric = units === 'C';
      const amount = Math.max(1, Math.round(town.distanceM / (metric ? 1000 : 1609.344)));
      const direction = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(town.bearing / 45) % 8];
      return { name: `Near ${town.name}`, detail: accuracy <= 100 && description.road ? `Along ${description.road}` : `About ${amount} ${metric ? 'km' : 'miles'} ${direction} of town` };
    }
    // A place label is a reference point, not proof of municipal containment.
    return { name: `Near ${town.name}`, detail: accuracy <= 100 && description.road ? `Along ${description.road}` : '' };
  }
  return { name: region ?? 'Your location', detail: accuracy <= 100 && description.road ? `Along ${description.road}` : region ? '' : 'Place name unavailable' };
}

export function gpsErrorMessage(code: number): string {
  if (code === 1) return 'Location access is blocked. Allow location in your browser settings, or choose a saved place.';
  if (code === 3) return 'Finding your location timed out. Try again or choose a saved place.';
  return 'Your device could not determine its location. Try again or choose a saved place.';
}

export function shouldAcceptFix(previous: DeviceFix | null, next: DeviceFix, force = false): boolean {
  if (!Number.isFinite(next.accuracy) || next.accuracy < 0 || !Number.isFinite(next.lat) || !Number.isFinite(next.lon)
    || Math.abs(next.lat) > 90 || Math.abs(next.lon) > 180 || !Number.isFinite(next.at)) return false;
  if (!previous || force) return true;
  if (next.at < previous.at) return false;
  if (next.accuracy < previous.accuracy / 2) return true;
  return distanceM(previous, next) >= Math.max(500, previous.accuracy, next.accuracy)
    && next.at - previous.at >= 60_000;
}
