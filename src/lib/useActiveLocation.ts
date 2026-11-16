'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { describeLocation, distanceM, gpsErrorMessage, shouldAcceptFix, type DeviceFix, type LocationDescription } from './locationDescription';
import { useSettings } from './settings';
import type { Place } from './types';

const FIX_KEY = 'sky-peek-device-fix';
const MAX_AGE = 24 * 3_600_000;
type NamedFix = { fix: DeviceFix; description: LocationDescription };

function savedFix(): NamedFix | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(FIX_KEY) ?? 'null') as NamedFix | null;
    if (value && shouldAcceptFix(null, value.fix) && Date.now() - value.fix.at < MAX_AGE && value.fix.at <= Date.now()
      && value.description && typeof value.description === 'object') return value;
  } catch { /* unavailable session storage */ }
  return null;
}

export function useActiveLocation() {
  const { s, set } = useSettings();
  const [named, setNamed] = useState<NamedFix | null>(savedFix);
  const [fix, setFix] = useState<DeviceFix | null>(() => named?.fix ?? null);
  const fixRef = useRef(fix);
  const acceptedRef = useRef(fix);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(s.gps);
  const [naming, setNaming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now);
  const refreshLocation = useCallback(() => { set({ gps: true }); setRetry(n => n + 1); }, [set]);

  useEffect(() => {
    if (!s.gps) {
      setLocating(false); setError(null); setFix(null); setNamed(null); setConfirmed(false);
      fixRef.current = null; acceptedRef.current = null;
      try { sessionStorage.removeItem(FIX_KEY); } catch { /* Storage unavailable. */ }
      return;
    }
    let disposed = false, watch: number | undefined, generation = 0;
    const stop = () => { generation++; if (watch !== undefined) navigator.geolocation?.clearWatch(watch); watch = undefined; };
    const start = () => {
      stop();
      if (document.hidden || disposed) return;
      setLocating(true); setError(null); setConfirmed(false);
      if (!navigator.geolocation) { setError('Location is unavailable in this browser. Choose a saved place.'); setLocating(false); return; }
      const epoch = generation;
      let first = true;
      const success = (p: GeolocationPosition) => {
        if (disposed || epoch !== generation) return;
        const next = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
        if (!shouldAcceptFix(null, next) || next.at < Date.now() - 120_000 || next.at > Date.now() + 60_000) return;
        setLocating(false); setError(null); setConfirmed(true); setNow(Date.now());
        const previous = fixRef.current;
        const reacquiredElsewhere = first && !!previous && distanceM(previous, next) >= Math.max(500, previous.accuracy, next.accuracy);
        if (shouldAcceptFix(acceptedRef.current, next, reacquiredElsewhere)) { acceptedRef.current = next; fixRef.current = next; setFix(next); }
        else if (previous) {
          // Refresh freshness without moving the weather coordinate for GPS drift.
          const updated = { ...previous, at: next.at, accuracy: Math.max(previous.accuracy, next.accuracy) };
          fixRef.current = updated; setFix(updated);
        }
        first = false;
      };
      watch = navigator.geolocation.watchPosition(success, e => {
        if (disposed || epoch !== generation) return;
        setError(gpsErrorMessage(e.code)); setLocating(false); setConfirmed(false);
        if (e.code === 1) stop();
      }, { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 });
    };
    const visible = () => document.hidden ? stop() : start();
    start();
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', visible); };
  }, [s.gps, retry]);

  const accuracyBucket = !fix ? Infinity : fix.accuracy <= 25 ? 25 : fix.accuracy <= 50 ? 50 : fix.accuracy <= 100 ? 100 : 2000;
  const lastLookup = useRef<{ lat: number; lon: number; at: number; accuracy: number } | null>(null);
  useEffect(() => {
    if (!s.gps || !fix || document.hidden) { setNaming(false); return; }
    const last = lastLookup.current;
    if (last && distanceM(last, fix) < 500 && Date.now() - last.at < 10 * 60_000 && last.accuracy === accuracyBucket) return;
    const controller = new AbortController();
    setNaming(true);
    const timeout = setTimeout(() => { controller.abort(); setNaming(false); lastLookup.current = null; }, 15_000);
    lastLookup.current = { lat: fix.lat, lon: fix.lon, at: Date.now(), accuracy: accuracyBucket };
    const params = new URLSearchParams({ lat: fix.lat.toFixed(5), lon: fix.lon.toFixed(5), accuracy: String(accuracyBucket) });
    fetch(`/api/location?${params}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Name lookup unavailable');
      const description = await response.json() as LocationDescription;
      if (controller.signal.aborted) return;
      const value = { fix, description };
      setNamed(value);
      try { sessionStorage.setItem(FIX_KEY, JSON.stringify(value)); } catch { /* session storage unavailable */ }
    }).catch(() => { if (!controller.signal.aborted) lastLookup.current = null; }).finally(() => {
      clearTimeout(timeout);
      if (!controller.signal.aborted) setNaming(false);
    });
    return () => { clearTimeout(timeout); controller.abort(); if (lastLookup.current?.lat === fix.lat && lastLookup.current?.lon === fix.lon) lastLookup.current = null; };
  // Freshness updates alone must not cancel or restart a lookup.
  }, [s.gps, fix?.lat, fix?.lon, accuracyBucket, retry]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const description = fix && named && distanceM(fix, named.fix) < 100 ? named.description : null;
  useEffect(() => {
    if (!fix || !s.gps) return;
    try { sessionStorage.setItem(FIX_KEY, JSON.stringify({ fix, description: description ?? {} })); } catch { /* session storage unavailable */ }
  }, [fix, description, s.gps]);
  const label = describeLocation(description, fix?.accuracy ?? Infinity, s.units);
  const main = s.places.find(p => p.id === s.defaultPlace) ?? s.places[0];
  const saved = s.gps ? main : s.places.find(p => p.id === s.viewingPlace) ?? main;
  const usingDevice = s.gps && !!fix;
  const place: Place = usingDevice ? { id: 'gps', name: label.name, region: description?.region ?? '', lat: fix.lat, lon: fix.lon } : saved;
  const age = fix ? Math.max(0, Math.floor((now - fix.at) / 60_000)) : 0;
  const stale = usingDevice && (!confirmed || !!error || age >= 5);
  const status = !s.gps ? 'Saved location'
    : !fix ? `${locating ? 'Finding your location' : 'Location unavailable'} · Showing ${saved.name}`
    : stale ? `Last known location${age ? ` · ${age} min ago` : ''}`
    : `${fix.accuracy > 1000 ? 'Approximate location' : 'Using your location'} · ${age ? `${age} min ago` : 'Checked just now'}`;
  const chooseSaved = useCallback((chosen: Place) => set({ viewingPlace: chosen.id, gps: false }), [set]);
  return { place, detail: usingDevice ? (!description && naming ? 'Finding a nearby place…' : label.detail) : saved.region, status, error, locating, usingDevice,
    deviceName: fix ? label.name : 'Find where you are', refreshLocation, chooseSaved };
}
