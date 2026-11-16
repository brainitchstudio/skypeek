import type { Metadata } from 'next';
import '../access/access.css';

export const metadata: Metadata = { title: 'SkyPeek privacy and device data' };

export default function PrivacyPage() {
  return <main className="access-page"><article className="access-card">
    <p className="access-eyebrow">SKY PEEK · YOUR DATA</p>
    <h1>Privacy and device data</h1>
    <h2>Locations and weather requests</h2>
    <p>GPS is optional. When enabled, your location is used for weather and nearby place names. Our location service sends coordinates to the National Weather Service and requests nearby map tiles from OpenFreeMap. Address search passes the address through our server to the US Census geocoder; city searches use Open-Meteo.</p>
    <p>Forecast and radar requests share the requested location or map area with the relevant service. These include NWS/NOAA, Open-Meteo, OpenFreeMap, Esri, RainViewer and Iowa Environmental Mesonet. Optional connections also send location and your key to OpenWeather, Tomorrow.io, WeatherAPI or Weather Company. These providers handle requests under their own policies.</p>
    <h2>What this browser remembers</h2>
    <p>Saved places and preferences stay in this browser profile until removed or site data is cleared. Point-coordinate caches are limited to 40 entries and seven days; weather caches have a count limit. Forecast accuracy and safeguard records are cleaned up after 400 days while the app is used. Closing the app does not actively erase stored data.</p>
    <p>GPS fixes use session storage and may be restored for up to 24 hours. Turning GPS off clears the saved fix. Removing a saved place does not currently erase all related weather history. Browser site-data controls can clear local storage, session storage and IndexedDB; close other SkyPeek tabs first to prevent them writing data again.</p>
    <h2>Provider keys</h2>
    <p>Keys are session-only by default. You can choose to remember a key on this device or disconnect it in Connections. Previously saved keys move to session-only storage when settings are saved unless you choose to remember them. Remembered keys are not encrypted against code running on this site or someone using your browser profile. Use restricted provider keys where available. Clearing browser data does not revoke the key with its provider.</p>
    <h2>Access and shared devices</h2>
    <p>Sign-out revokes the current server session but keeps your local preferences and history. The all-sessions option signs out sessions using the same access code; a shared code does not identify an individual person. Local data is shared by people using the same browser profile. Do not enter private keys on a shared profile.</p>
    <p>Authentication cookies are HttpOnly and Secure in production. Server session records contain a token digest, role, expiry and a nonsecret access-code reference, not your saved places or provider keys.</p>
    <h2>Logs, exports and notifications</h2>
    <p>Location and address requests currently use URLs that may appear in hosting access logs. Hosting log retention has not yet been verified. We do not claim that all location data stays on your device. Accuracy exports include geographic information; share them thoughtfully. Notification permission is optional, and weather notifications may show their content on your lock screen.</p>
    <p><a href="/app">Return to SkyPeek</a></p>
  </article></main>;
}
