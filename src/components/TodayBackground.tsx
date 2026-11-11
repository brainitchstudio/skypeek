'use client';

import { useEffect, useRef } from 'react';
import type { TodayScene } from '@/lib/todayScene';

type WeatherBackground = { update: (scene: TodayScene) => void; destroy: () => void };
declare global {
  interface Window { SkyPeekWeather?: { mount: (el: HTMLElement, scene: TodayScene) => WeatherBackground } }
}

let loader: Promise<void> | null = null;
function loadWeatherBackground() {
  if (window.SkyPeekWeather) return Promise.resolve();
  if (!loader) loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/skypeek-weather.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loader = null; reject(new Error('Weather background unavailable')); };
    document.head.appendChild(script);
  });
  return loader;
}

export function TodayBackground({ scene }: { scene: TodayScene }) {
  const element = useRef<HTMLDivElement>(null);
  const background = useRef<WeatherBackground | null>(null);
  const latest = useRef(scene);
  latest.current = scene;

  useEffect(() => {
    let active = true;
    loadWeatherBackground().then(() => {
      if (active && element.current && window.SkyPeekWeather) {
        background.current = window.SkyPeekWeather.mount(element.current, latest.current);
      }
    }).catch(() => { /* The Today forecast remains usable without the decorative scene. */ });
    return () => { active = false; background.current?.destroy(); background.current = null; };
  }, []);

  useEffect(() => { background.current?.update(scene); }, [scene.time, scene.weather]);
  return <div ref={element} className="today-background" aria-hidden="true" />;
}
