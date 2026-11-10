import type { Place } from './types';

export async function searchAddress(address: string): Promise<Place[]> {
  const response = await fetch(`/api/geocode?${new URLSearchParams({ address })}`);
  const data = await response.json() as { places?: Place[]; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Address search is unavailable right now.');
  return data.places ?? [];
}
