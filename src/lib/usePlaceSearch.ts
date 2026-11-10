'use client';

import { useEffect, useState } from 'react';
import { searchPlaces } from '@/api/weather';
import type { Place } from './types';

export type PlaceSearch = { results: Place[]; status: 'idle' | 'searching' | 'done' | 'failed' };

const IDLE: PlaceSearch = { results: [], status: 'idle' };

/** Debounced city and ZIP lookup. Queries under two characters stay idle. */
export function usePlaceSearch(query: string): PlaceSearch {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setState(IDLE); return; }
    let stale = false;
    setState(s => ({ ...s, status: 'searching' }));
    const t = setTimeout(() => {
      searchPlaces(q)
        .then(results => { if (!stale) setState({ results, status: 'done' }); })
        .catch(() => { if (!stale) setState({ results: [], status: 'failed' }); });
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [query]);
  return state;
}
