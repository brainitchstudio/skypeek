/** No external executable scripts. Style exceptions support MapLibre's DOM styles. */
export function contentSecurityPolicy(nonce: string, development = false) {
  const providers = [
    'https://api.weather.gov', 'https://api.open-meteo.com', 'https://geocoding-api.open-meteo.com',
    'https://api.openweathermap.org', 'https://demo.openweathermap.org', 'https://tile.openweathermap.org',
    'https://api.tomorrow.io', 'https://api.weatherapi.com', 'https://api.weather.com',
    'https://api.rainviewer.com', 'https://*.rainviewer.com', 'https://tiles.openfreemap.org',
    'https://server.arcgisonline.com', 'https://opengeo.ncep.noaa.gov', 'https://nowcoast.noaa.gov',
    'https://mesonet.agron.iastate.edu', 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com',
  ].join(' ');
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' ${providers}${development ? ' ws://localhost:* ws://127.0.0.1:*' : ''}`,
    `img-src 'self' data: blob: ${providers}`,
    "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
}
