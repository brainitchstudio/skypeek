"""Writes reference data for a GRIB2 fixture using ecCodes. Dev only.
Usage: .venv/bin/python scripts/generate-grib-golden.py <in.grib2> <out.json>"""
import calendar, hashlib, json, sys
import eccodes as ec
import numpy as np

src, out = sys.argv[1:3]
with open(src, 'rb') as f:
    h = ec.codes_grib_new_from_file(f)
ni, nj = ec.codes_get(h, 'Ni'), ec.codes_get(h, 'Nj')
v = ec.codes_get_values(h)
lats, lons = ec.codes_get_array(h, 'latitudes'), ec.codes_get_array(h, 'longitudes')
ymd, hms = ec.codes_get(h, 'dataDate'), ec.codes_get(h, 'dataTime')
ref = calendar.timegm((ymd // 10000, ymd // 100 % 100, ymd % 100, hms // 100, hms % 100, 0)) * 1000
sixteenths = np.rint(v * 16).astype('<i2')
assert np.allclose(sixteenths / 16, v, atol=1e-6), 'values are not whole 1/16 dBZ steps'
idx = sorted(set(np.argsort(v)[-200:].tolist()) | set(range(0, len(v), 50_000)))
points = [(0, 0), (ni - 1, 0), (0, nj - 1), (ni - 1, nj - 1)]
points += [(i, j) for j in range(0, nj, 200) for i in range(0, ni, 200)]
json.dump({
    'sha256': hashlib.sha256(sixteenths.tobytes()).hexdigest(), 'count': int(len(v)),
    'refTime': ref, 'leadMin': int(ec.codes_get(h, 'forecastTime')),
    'max': float(v.max()),
    'samples': [{'i': i, 'v': float(v[i]), 'lat': float(lats[i]), 'lon': float(lons[i])} for i in idx],
    'points': [{'i': i, 'j': j, 'lat': float(lats[j * ni + i]), 'lon': float(lons[j * ni + i])} for i, j in points],
}, open(out, 'w'))
print(out, len(v), 'max', v.max())
