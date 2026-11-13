import { version as APP_VERSION } from '../../package.json';

export { APP_VERSION };

export type Release = { version: string; title: string; changes: string[] };

// Add an entry when package.json's version moves forward. Versions skipped by a
// visitor are shown together the next time they open the app.
export const RELEASES: Release[] = [
  {
    version: '1.5.0',
    title: 'Forecasts that fit your phone',
    changes: [
      'Hourly is now a touch-friendly list. Tap an hour to see its conditions and forecast sources right there.',
      '10 Day forecasts now expand inside each day’s card, with a smooth open and close animation.',
      'Radar controls are easier to use on a phone, and you can select NOAA radar sites directly on the map.',
    ],
  },
  {
    version: '0.5.0',
    title: 'Weather all around Today',
    changes: [
      'Today now shows an animated scene for your saved location’s current weather and local time of day.',
      'The scene changes as conditions or the local time change while Sky Peek is open.',
    ],
  },
  {
    version: '0.4.0',
    title: 'A calmer first visit',
    changes: [
      'Preview your first location on a map and confirm it before the tour begins.',
      'The five-screen tour keeps the weather scene from your beta entrance throughout.',
    ],
  },
  {
    version: '0.3.0',
    title: 'See Sky Peek before you explore',
    changes: [
      'The welcome tour now shows real desktop and mobile previews of each main screen.',
      'Location suggestions float over the welcome card while you search.',
    ],
  },
  {
    version: '0.2.0',
    title: 'A new first look',
    changes: [
      'Choose your first forecast location, then tour the forecast, radar, alerts, and settings.',
      'The beta entrance now opens with a changing time of day and weather scene.',
      'The radar map now loads reliably on the hosted app.',
    ],
  },
];

export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] || 0) - (right[i] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function unseenReleases(lastSeen: string | null, current = APP_VERSION) {
  if (lastSeen && compareVersions(current, lastSeen) <= 0) return [];
  return RELEASES.filter(release => compareVersions(release.version, lastSeen ?? '0.0.0') > 0 && compareVersions(release.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}
