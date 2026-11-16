import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDirectory } from './installation';

export type HomeContent = {
  eyebrow: string;
  headline: string;
  introduction: string;
  announcement: string;
  forecast: string;
  radar: string;
  alerts: string;
};

export const defaultHomeContent: HomeContent = {
  eyebrow: 'Forecasts, radar and alerts together.',
  headline: 'Know the sky. Understand what’s next.',
  introduction: 'Forecasts, radar, and official alerts in one clear view for the places you care about.',
  announcement: 'Sky Peek is in beta across the United States.',
  forecast: 'See today, the next hours, and the ten-day outlook for every place you save.',
  radar: 'Replay observed radar, inspect storm outlines, and explore clearly labeled model forecasts.',
  alerts: 'See National Weather Service warnings alongside the forecast and radar they relate to.',
};

const contentPath = () => join(configDirectory(), 'sky-peek-home.json');

export function readHomeContent(): HomeContent {
  try {
    const saved: unknown = JSON.parse(readFileSync(contentPath(), 'utf8'));
    if (!saved || typeof saved !== 'object') return defaultHomeContent;
    return Object.fromEntries(Object.entries(defaultHomeContent).map(([key, fallback]) => [
      key, typeof (saved as Record<string, unknown>)[key] === 'string' ? (saved as Record<string, string>)[key] : fallback,
    ])) as HomeContent;
  } catch { return defaultHomeContent; }
}

export function validateHomeContent(input: unknown): HomeContent | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const output: Record<string, string> = {};
  for (const key of Object.keys(defaultHomeContent)) {
    const text = value[key];
    if (typeof text !== 'string' || !text.trim() || text.length > 500) return null;
    output[key] = text.trim();
  }
  return output as HomeContent;
}

export function saveHomeContent(content: HomeContent) {
  const directory = configDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `sky-peek-home-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(temporary, JSON.stringify(content), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, contentPath());
}
