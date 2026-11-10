"""Small, sequential NOAA OpenGeo probe. Saves evidence; does not alter app settings."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

OUT = Path(__file__).resolve().parents[1] / 'docs/radar-investigation'
OUT.mkdir(parents=True, exist_ok=True)
BASE = 'https://opengeo.ncep.noaa.gov/geoserver/'
NS = {'w': 'http://www.opengis.net/wms'}
results = []

def request(name, endpoint, params):
    url = BASE + endpoint + '?' + urllib.parse.urlencode(params)
    started = time.monotonic()
    row = {'name': name, 'url': url, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat()}
    try:
        req = urllib.request.Request(url, headers={'Origin': 'http://localhost:3000'})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            row.update(status=r.status, headers=dict(r.headers), bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
        suffix = '.png' if body.startswith(b'\x89PNG\r\n\x1a\n') else '.xml'
        (OUT / (name + suffix)).write_bytes(body)
        row['file'] = name + suffix
        row['png'] = suffix == '.png'
    except Exception as e:
        body = b''
        row['error'] = str(e)
    row['seconds'] = round(time.monotonic() - started, 3)
    results.append(row)
    return body, row

for key, endpoint, wanted, bbox in [
    ('klot', 'klot/ows', ['klot_sr_bref', 'klot_sr_bvel'], '-9950000,4900000,-9500000,5350000'),
    ('conus', 'conus/conus_bref_qcd/ows', ['conus_bref_qcd'], '-14000000,2800000,-7500000,6500000'),
]:
    body, row = request(key + '-capabilities', endpoint, dict(service='WMS', version='1.3.0', request='GetCapabilities'))
    if not body:
        continue
    root = ET.fromstring(body)
    layers = []
    for layer in root.findall('.//w:Layer', NS):
        name = layer.findtext('w:Name', namespaces=NS)
        if not name:
            continue
        dims = {d.attrib['name']: {'attributes': d.attrib, 'values': (d.text or '').strip()} for d in layer.findall('w:Dimension', NS)}
        layers.append({'name': name, 'dimensions': dims, 'styles': [s.text for s in layer.findall('w:Style/w:Name', NS)], 'crs': [s.text for s in layer.findall('w:CRS', NS)]})
        if name not in wanted:
            continue
        times = dims.get('time', {}).get('values', '').split(',')
        for label, stamp in [('latest', times[-1]), ('oldest', times[0])]:
            params = dict(service='WMS', version='1.3.0', request='GetMap', layers=name, styles='', format='image/png', transparent='true', crs='EPSG:3857', width=512, height=512, bbox=bbox, time=stamp)
            request(name + '-' + label, endpoint, params)
    row['layers'] = layers
(OUT / 'probe-results.json').write_text(json.dumps(results, indent=2))
for r in results:
    print(r['name'], r.get('status', r.get('error')), r.get('bytes'), r['seconds'])
