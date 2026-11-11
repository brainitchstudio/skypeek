'use client';

import { useEffect, useRef, useState } from 'react';
import type { Place } from '@/lib/types';

export function LocationMapPreview({ place }: { place: Place }) {
  const container = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: import('maplibre-gl').Map | undefined;
    setUnavailable(false);
    Promise.all([import('maplibre-gl'), import('@/radar/style')]).then(([gl, { buildStyle }]) => {
      if (cancelled || !container.current) return;
      gl.setWorkerUrl(`${location.origin}/maplibre-gl-worker.js`);
      map = new gl.Map({
        container: container.current,
        style: buildStyle(0),
        center: [place.lon, place.lat],
        zoom: 9.5,
        interactive: false,
        attributionControl: false,
      });
      map.addControl(new gl.AttributionControl({ compact: true }), 'bottom-left');
      const pin = document.createElement('div');
      pin.className = 'onboard-map-pin';
      new gl.Marker({ element: pin, anchor: 'center' }).setLngLat([place.lon, place.lat]).addTo(map);
    }).catch(() => { if (!cancelled) setUnavailable(true); });
    return () => { cancelled = true; map?.remove(); };
  }, [place.lat, place.lon]);

  return <div className="onboard-map-wrap">
    <div ref={container} className="onboard-map" role="img" aria-label={`Map centered on ${place.name}`} />
    {unavailable && <div className="onboard-map-fallback">Map preview is unavailable. You can still confirm this location.</div>}
  </div>;
}
