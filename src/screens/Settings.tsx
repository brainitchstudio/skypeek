import { Star } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ScreenProps } from './shared';
import { getLiveConditions, getPlaceNow, PROVIDERS } from '@/api/weather';
import { Icon, Label, Segmented, ToggleRow } from '@/components/ui';
import { ALERT_TYPES } from '@/lib/alerts';
import { COLORS, iconFor, LEVEL_STYLE, temp, type Units } from '@/lib/format';
import { REFRESH_OPTIONS, useSettings, type SettingsTab } from '@/lib/settings';
import type { Place } from '@/lib/types';
import { usePlaceSearch } from '@/lib/usePlaceSearch';
import { usage } from '@/api/budget';
import { orderPlaces, savePlace, toggleFavorite } from '@/lib/places';
import type { Weather } from '@/lib/useWeather';
import { BUCKETS, COLLECTING_DAYS, type ReportSource, type Stat } from '@/weather/accuracy';
import type { SafeguardEvent } from '@/weather/safeguards';
import { accuracyExport, accuracyReport, PROVIDER_NAMES, safeguardLog } from '@/weather/service';

const CREDITS: [string, string, string][] = [
  ['Forecasts and alerts', 'National Weather Service, NOAA', 'https://www.weather.gov'],
  ['Forecast blending with your keys', '© OpenWeather, Tomorrow.io, WeatherAPI', 'https://openweathermap.org'],
  ['Extended forecast and place search', 'Weather data by Open-Meteo, CC BY 4.0', 'https://open-meteo.com'],
  ['Map data', '© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'],
  ['Map tiles', 'OpenFreeMap, © OpenMapTiles', 'https://openfreemap.org'],
  ['County lines', 'US Census Bureau', 'https://www.census.gov'],
  ['Satellite imagery', 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community', 'https://goto.arcgisonline.com/maps/World_Imagery'],
  ['NOAA radar', 'NOAA / NWS', 'https://opengeo.ncep.noaa.gov/geoserver/www/index.html'],
  ['Radar', '© RainViewer', 'https://www.rainviewer.com'],
  ['Storm tracks', 'NWS NEXRAD via Iowa Environmental Mesonet', 'https://mesonet.agron.iastate.edu'],
  ['Lightning', 'NOAA nowCOAST', 'https://nowcoast.noaa.gov'],
  ['Wind and temperature', 'Weather data by Open-Meteo, CC BY 4.0', 'https://open-meteo.com'],
  ['Radar with your key', '© OpenWeather, © Tomorrow.io', 'https://openweathermap.org'],
];

const TABS: [SettingsTab, string][] = [['general', 'General'], ['alerts', 'Alerts'], ['locations', 'Locations'], ['radar', 'Radar'], ['data', 'Connections']];

export function SettingsScreen({ weather, place, gpsError }: ScreenProps & { gpsError: string | null }) {
  const { s, set } = useSettings();
  return (
    <div className="screen settings">
      <div className="set-head">
        <div className="row-between wrap">
          <h1 className="title small">Settings</h1>

        </div>
        <p className="settings-intro">Make Sky Peek feel at home. Your preferences are saved automatically on this device.</p>
        <div className="tabs" aria-label="Settings sections">
          {TABS.map(([k, label]) => (
            <button type="button" key={k} aria-current={s.setTab === k ? 'page' : undefined} className={s.setTab === k ? 'on' : ''} onClick={() => set({ setTab: k })}>{label}</button>
          ))}
        </div>
      </div>
      <SettingsPages section={s.setTab + s.mode}>
        {s.setTab === 'alerts' && <><div className="settings-mode"><div><h2>Alert preferences</h2><p className="help">Choose how alerts are filtered. Delivery preferences apply to either mode.</p></div><Segmented value={s.mode} onChange={mode => set({ mode })} options={[["types", "By type"], ["tiers", "By severity"]]} /></div><ByType placeName={place.name} /></>}
        {s.setTab === 'general' && <div className="settings-panel"><h2>Forecast preferences</h2><p className="lead">Choose your temperature units and how often forecasts update.</p>        <div className="field">
          <Label>Refresh every</Label>
          <Segmented value={s.refreshI} onChange={refreshI => set({ refreshI })} options={REFRESH_OPTIONS.map(([l], i) => [i, l])} className="start" />
        </div>
        <div className="field">
          <Label>Temperature units</Label>
          <Segmented<Units> value={s.units} onChange={units => set({ units })} options={[['F', '°F'], ['C', '°C']]} className="start" />
        </div>
        {process.env.NODE_ENV === 'production' && <div className="field">
          <Label>Beta access</Label>
          <button type="button" className="link" onClick={() => {
            void fetch('/api/access', { method: 'DELETE' }).then(() => { window.location.href = '/access'; });
          }}>Leave beta</button>
        </div>}
</div>}
        {s.setTab === 'radar' && <RadarSettings />}
        {s.setTab === 'locations' && <Locations gpsError={gpsError} />}
        {s.setTab === 'data' && <DataSource weather={weather} place={place} />}
      </SettingsPages>
    </div>
  );
}

function ByType({ placeName }: { placeName: string }) {
  const { s, set } = useSettings();
  const flip = (key: 'types' | 'delivery', i: number) => set(c => ({ [key]: c[key].map((v, j) => (j === i ? !v : v)) }));

  const setNotify = async () => {
    if (s.delivery[1]) return flip('delivery', 1);
    if (!('Notification' in window)) return;
    if ((await Notification.requestPermission()) === 'granted') flip('delivery', 1);
  };

  return (
    <div className="split">
      <div className="side">
        <p className="lead">Choose which National Weather Service alerts reach you for {placeName}.</p>
        <div className="group">
          <Label>Delivery</Label>
          {['In-app banner', 'System notification', 'Sound'].map((name, i) => (
            <ToggleRow key={name} on={s.delivery[i]} onClick={() => (i === 1 ? void setNotify() : flip('delivery', i))}>
              <span className="row-name">{name}</span>
            </ToggleRow>
          ))}
        </div>
      </div>
      <div className="wide">
        {s.mode === 'tiers' ? <ByTier /> : ALERT_TYPES.map(([name, level], i) => (
          <ToggleRow key={name} on={s.types[i]} onClick={() => flip('types', i)} className="type-row">
            <i style={{ background: LEVEL_STYLE[level].color }} />
            <span className="n">{name}</span>
            <span className="l">{level}</span>
          </ToggleRow>
        ))}
      </div>
    </div>
  );
}

const TIERS: [string, string, string, string[]][] = [
  ['Warnings', COLORS.red, 'Hazardous weather is happening or imminent.', ['Tornado', 'Severe Thunderstorm', 'Flash Flood', 'Winter Storm']],
  ['Watches', COLORS.orange, 'Conditions are favorable for hazardous weather.', ['Tornado', 'Severe Thunderstorm', 'Flood']],
  ['Advisories', COLORS.yellow, 'Less serious conditions that may cause inconvenience.', ['Wind', 'Heat', 'Dense Fog', 'Coastal Flood']],
];

function ByTier() {
  const { s, set } = useSettings();
  return (
    <div className="tier-settings">
      <p className="lead narrow">Set how each level of National Weather Service alert reaches you.</p>
      <div className="tier-grid">
        {TIERS.map(([name, color, desc, list], ti) => (
          <div className="tier" key={name}>
            <div className="stripe" style={{ background: color }} />
            <div><div className="n">{name}</div><div className="d">{desc}</div></div>
            <Segmented dark className="three" value={s.tiers[ti]} options={[[0, 'Notify'], [1, 'Banner'], [2, 'Off']]}
              onChange={v => set(c => ({ tiers: c.tiers.map((x, j) => (j === ti ? v : x)) }))} />
            <div className="list">{list.map(x => <div key={x}>{x}</div>)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Locations({ gpsError }: { gpsError: string | null }) {
  const { s, set } = useSettings();
  const [query, setQuery] = useState('');
  const { results: suggest } = usePlaceSearch(query);
  const [now, setNow] = useState<Record<string, Awaited<ReturnType<typeof getPlaceNow>>>>({});

  useEffect(() => {
    s.places.forEach(p => {
      getPlaceNow(p).then(v => setNow(c => ({ ...c, [p.id]: v }))).catch(() => { /* row shows a dash */ });
    });
  }, [s.places]);

  const options = suggest.filter(p => !s.places.some(l => l.name === p.name)).slice(0, 4);

  return (
    <div className="split">
      <div className="side">
        <p className="lead">Your main location builds Today, Hourly and 10 Day, centers the radar and sets which alerts you receive. Star your favorites to keep them at the top.</p>
        <div className="group">
          <ToggleRow on={s.gps} onClick={() => set(c => ({ gps: !c.gps }))}>
            <span className="row-stack"><span className="row-name">Use current location</span><span className="row-note">Follow this device’s location</span></span>
          </ToggleRow>
          {gpsError && <div className="error-note">{gpsError}</div>}
        </div>
      </div>
      <div className="wide gap">
        <div className="search">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Add a city or ZIP code" aria-label="Add a city or ZIP code" />
          {options.length > 0 && (
            <div className="suggest">
              {options.map(p => (
                <button type="button" key={p.id} onClick={() => { set(c => ({ places: savePlace(c.places, p) })); setQuery(''); }}>
                  <span>{p.name}</span><span className="add">Add</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          {orderPlaces(s.places).map(p => {
            const def = p.id === s.defaultPlace, n = now[p.id];
            return (
              <div className="loc" key={p.id}>
                <button type="button" className="star" aria-label={`Favorite ${p.name}`} aria-pressed={!!p.favorite}
                  onClick={() => set(c => ({ places: toggleFavorite(c.places, p) }))}>
                  <Star size={18} fill={p.favorite ? 'currentColor' : 'none'} aria-hidden />
                </button>
                {n ? <Icon kind={iconFor(n.condition, n.isDaytime)} /> : <div />}
                <div className="nm"><div className="a">{p.name}</div><div className="b">{p.region}</div></div>
                <div className="tmp">{temp(n?.tempF, s.units)}</div>
                <button type="button" className={`def${def ? ' on' : ''}`} onClick={() => set({ defaultPlace: p.id, gps: false })}>{def ? 'Main location' : 'Make main'}</button>
                <button type="button" className="rm" style={{ visibility: def ? 'hidden' : 'visible' }}
                  onClick={() => set(c => ({ places: c.places.filter(x => x.id !== p.id) }))}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Usage() {
  const [rows, setRows] = useState(() => usage());
  useEffect(() => {
    const t = setInterval(() => setRows(usage()), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="credits">
      {rows.map(u => (
        <div key={u.id}>
          <span>{u.name}</span>
          <span>{u.benchedUntil ? `Paused until ${new Date(u.benchedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `${u.hourUsed} of ${u.perHour}`}</span>
        </div>
      ))}
    </div>
  );
}

const sourceName = (x: ReportSource) => (x === 'blend' ? 'Sky Peek blend' : x === 'equal' ? 'Equal blend' : PROVIDER_NAMES[x]);

/** Temperature error in the user's units; degrees of difference, so no 32 offset. */
function errorText(s: Stat | undefined, units: Units) {
  if (!s?.n || s.mae == null) return '–';
  return `${(units === 'F' ? s.mae * 1.8 : s.mae).toFixed(1)}°`;
}

function AccuracyPanel({ place }: { place: Place }) {
  const { s } = useSettings();
  const [r, setR] = useState<Awaited<ReturnType<typeof accuracyReport>> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let on = true;
    accuracyReport(place).then(x => { if (on) setR(x); }).catch(() => { if (on) setR(null); });
    return () => { on = false; };
  }, [place]);

  const save = async () => {
    setSaving(true);
    try {
      const url = URL.createObjectURL(new Blob([await accuracyExport(place)], { type: 'application/x-ndjson' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `sky-peek-accuracy-${new Date().toISOString().slice(0, 10)}.jsonl`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setSaving(false);
    }
  };

  if (!r) return <div className="help">Accuracy data isn’t available in this browser.</div>;
  const degrees = (c: number) => `${(s.units === 'F' ? c * 1.8 : c).toFixed(1)}°`;
  const c = r.comparison, cov = r.coverage;
  const verdict = r.noStation ? 'No suitable weather station within 9 miles of this place, so its forecasts can’t be scored.'
    : r.maturity === 'collecting' ? `Still collecting. ${r.independentDays} of ${COLLECTING_DAYS} days scored so far, so it’s too early to compare sources.`
    : !c ? 'Connect a second source to compare them.'
    : `Over ${c.days} days with every source available, the blend was off by ${degrees(c.blendMae)} and the best single source, ${sourceName(c.best.source)}, by ${degrees(c.best.mae)}. The blend won ${c.blendWonDays} of ${c.days} days.${r.maturity === 'provisional' ? ' Early result.' : ''}`;

  return (
    <div className="stack-sm">
      <div className="help">{verdict}</div>
      <div className="help">Audit logging: {r.auditHealth.status}. Storage: {r.auditHealth.persistence}. Status covers this session only; missing records are not proof of clean data. Results are descriptive, not proof of improvement.</div>
      {r.sources.length > 0 && (
        <div className="acc" role="table" aria-label="Average temperature error by how far ahead the forecast was made">
          <div className="acc-row head" role="row"><span role="columnheader">Temperature error</span>{BUCKETS.map(b => <span role="columnheader" key={b.id}>{b.id.replace('-', '–').replace('h', ' hr')}</span>)}</div>
          {r.sources.map(x => (
            <div className="acc-row" role="row" key={x}>
              <span role="cell">{sourceName(x)}</span>
              {BUCKETS.map(b => <span role="cell" key={b.id}>{errorText(r.temperature[x]?.[b.id], s.units)}</span>)}
            </div>
          ))}
        </div>
      )}
      <div className="help">
        Last {r.days} days. Of {cov.expected} hours since logging began, {cov.withForecast} had a saved forecast, {cov.withTruth} had a station reading and {cov.paired} could be scored{cov.pending ? `, with ${cov.pending} still waiting on readings` : ''}. Forecasts are only saved while Sky Peek is open and on screen. This doesn’t change the blend.
      </div>
      <div><button type="button" className="link" disabled={saving} onClick={() => void save()}>Export data</button></div>
    </div>
  );
}

function SafeguardPanel({ place }: { place: Place }) {
  const [log, setLog] = useState<SafeguardEvent[] | null>(null);

  useEffect(() => {
    let on = true;
    safeguardLog(place).then(x => { if (on) setLog(x); }).catch(() => { if (on) setLog(null); });
    return () => { on = false; };
  }, [place]);

  if (!log) return <div className="help">The safeguard log isn’t available in this browser.</div>;
  if (!log.length) return <div className="help">Nothing has been caught for this place in the last 30 days.</div>;
  return (
    <div className="stack-sm">
      <div className="guards">
        {log.slice(0, 20).map(e => (
          <div className="guard" key={e.id}>
            <div className="when">{new Date(e.lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{e.count > 1 ? ` · ${e.count} times` : ''}</div>
            <div>{e.why}</div>
            <div className="did">{e.action}</div>
          </div>
        ))}
      </div>
      {log.length > 20 && <div className="help">Showing the latest 20 of {log.length}. Export data includes them all.</div>}
    </div>
  );
}

function DataSource({ weather, place }: { weather: Weather; place: Place }) {
  const { s, set } = useSettings();
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bad, setBad] = useState('');
  const P = s.provider, prov = PROVIDERS[P];
  const key = s.keys[P] ?? '';
  const verified = !!s.verified[P];
  const role = weather.sources.find(x => x.name === prov.name);

  const test = async () => {
    if (!key.trim()) { setBad('Enter a key first'); return; }
    setTesting(true); setBad('');
    try {
      await getLiveConditions(P, key.trim(), place);
      set(c => ({ verified: { ...c.verified, [P]: true } }));
    } catch (e) {
      set(c => ({ verified: { ...c.verified, [P]: false } }));
      setBad((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const [dot, fg, status] = testing ? ['#bdbdb8', '#555', 'Testing…']
    : bad ? [COLORS.red, '#b3261e', bad]
    : !prov.needsKey ? [COLORS.green, '#333', 'Connected']
    : verified ? [role && !role.healthy ? COLORS.red : COLORS.green, role && !role.healthy ? '#b3261e' : '#333', role ? `${role.healthy ? 'Connected' : 'Problem'} · ${role.note}` : 'Connected']
    : ['#cfcfca', '#888', 'Not tested'];


  return (
    <div className="split">
      <div className="side">
        <p className="lead">Alerts come only from the National Weather Service. Forecasts start from NWS, with days 8–10 from Open-Meteo. Connected keys act as challengers: they’re checked now and then, more often when rain is close or sources disagree, and blended in where their data is comparable.</p>
        <div className="group ruled">
          <Label>Last updated</Label>
          <div className="row-name">{weather.updatedAt ? weather.updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '–'}</div>
        </div>
      </div>
      <div className="wide gap-lg">
        <div className="field">
          <Label>Provider</Label>
          <div className="providers">
            {PROVIDERS.map((p, i) => (
              <button type="button" key={p.name} className={i === P ? 'on' : ''} onClick={() => { setBad(''); set({ provider: i }); }}>
                <span className="row-stack"><span className="pn">{p.name}</span><span className="row-note">{p.note}</span></span>
                <i />
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <Label>API key</Label>
          {prov.needsKey ? <>
            <div className="key-row">
              <div className="key-box">
                <input type={show ? 'text' : 'password'} value={key} placeholder={`Paste your ${prov.name} key`} aria-label={`${prov.name} API key`} autoComplete="off"
                  onChange={e => { setBad(''); const v = e.target.value; set(c => ({ keys: { ...c.keys, [P]: v }, verified: { ...c.verified, [P]: false } })); }} />
                <button type="button" onClick={() => setShow(x => !x)}>{show ? 'Hide' : 'Show'}</button>
              </div>
              <button type="button" className="primary" onClick={test}>Test connection</button>
            </div>
            <div className="help">{prov.help}</div>
          </> : <div className="no-key">No key needed for the National Weather Service.</div>}
          <div className="status"><i style={{ background: dot }} /><span style={{ color: fg }}>{status}</span></div>
        </div>
        {weather.sources.length > 0 && (
          <div className="field">
            <Label>Forecast sources</Label>
            <div className="credits">
              {weather.sources.map(x => (
                <div key={x.provider}><span>{x.name} · {x.role}</span><span style={{ color: x.healthy ? undefined : '#b3261e' }}>{x.note}</span></div>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <Label>Forecast accuracy</Label>
          <a href="/lab">Open experiment dashboard →</a>
          <AccuracyPanel place={place} />
        </div>
        <div className="field">
          <Label>Safeguards</Label>
          <SafeguardPanel place={place} />
        </div>
        <div className="field">
          <Label>Requests this hour</Label>
          <Usage />
        </div>
        <div>
          <Label>Data sources and credits</Label>
          <div className="credits">
            {CREDITS.map(([use, who, href]) => (
              <div key={use}><span>{use}</span><a href={href} target="_blank" rel="noreferrer">{who}</a></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RadarSettings() {
  const { s, set } = useSettings();
  const owOk = !!(s.verified[1] && s.keys[1]), tmOk = !!(s.verified[2] && s.keys[2]);
  const radarBad = (s.radarSrc === 2 && !owOk) || (s.radarSrc === 3 && !tmOk);
  const radarNote = radarBad ? "Connect and test this provider in Connections first. The map uses simulated imagery until a key is available." : s.radarSrc === 0 ? "Simulated weather for exploring the map. This is not live weather." : "Live precipitation imagery. Availability and detail depend on the provider.";
  return <div className="settings-panel"><h2>Radar & maps</h2><p className="lead">Choose the map style and precipitation source.</p>        <div className="field">
          <Label>Radar base map</Label>
          <Segmented value={s.basemap === 2 ? 2 : 0} onChange={basemap => set({ basemap })} options={[[0, 'Flat'], [2, 'Satellite']]} className="start" />
          <div className="help">Map data from OpenStreetMap through OpenFreeMap. Satellite imagery from Esri. No key needed.</div>
        </div>
        <div className="field">
          <Label>Radar imagery</Label>
          <Segmented value={s.radarSrc} onChange={radarSrc => set({ radarSrc })} options={[[0, 'Simulated'], [1, 'RainViewer'], [2, 'OpenWeather'], [3, 'Tomorrow.io'], [4, 'NOAA national'], [5, 'NOAA station']]} className="start" />
          <div className="help" style={{ color: radarBad ? '#b3261e' : undefined }}>{radarNote}</div>
        </div>
        <div className="field">
          <Label>Individual lightning reports</Label>
          <div className="help">The connected OpenWeather key is used first when its plan includes the Lightning API. Reports cover 50 km around your active location.</div>
          <input type="password" aria-label="Weather Company lightning API key" autoComplete="off" value={s.keys[4] ?? ''}
            placeholder="Weather Company lightning API key" onChange={e => set(current => ({ keys: { ...current.keys, 4: e.target.value } }))} />
          <div className="help">Optional fallback: a Weather Company key with Recent Lightning Strikes for Region access covers 100 miles. NOAA density and the nearby lightning banner work without a key.</div>
        </div>
</div>;
}

/** Fixed-height columns keep settings reachable through explicit pages at any viewport size. */
function SettingsPages({ children, section }: { children: ReactNode; section: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  useEffect(() => {
    const el = viewport.current!, body = content.current!;
    const measure = () => {
      const count = Math.max(1, Math.ceil(body.scrollWidth / Math.max(1, el.clientWidth)));
      setPages(count);
      setPage(current => {
        const next = Math.min(current, count - 1);
        el.scrollLeft = next * el.clientWidth;
        return next;
      });
    };
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const mutations = new MutationObserver(measure);
    mutations.observe(body, { childList: true, subtree: true, characterData: true });
    measure();
    return () => { resize.disconnect(); mutations.disconnect(); };
  }, [section]);
  useEffect(() => { setPage(0); }, [section]);
  useEffect(() => {
    const el = viewport.current!;
    el.scrollLeft = page * el.clientWidth;
  }, [page, pages]);
  return <div className="settings-pages">
    <div className="settings-page-viewport" ref={viewport} onFocusCapture={event => {
      const el = viewport.current!;
      const bounds = event.target.getBoundingClientRect();
      const frame = el.getBoundingClientRect();
      if (bounds.left < frame.left || bounds.right > frame.right) {
        setPage(Math.max(0, Math.min(pages - 1, Math.floor((bounds.left - frame.left + el.scrollLeft) / el.clientWidth))));
      }
    }}><div className="settings-page-columns" ref={content}>{children}</div></div>
    <nav className="settings-pagination" aria-label="Settings pages">
      <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Previous</button>
      <span aria-live="polite">{page + 1} / {pages}</span>
      <button type="button" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
    </nav>
  </div>;
}
