"""Builds src/radar/reflectivityScale.json from NOAA's own legend image. Dev only.
Usage: .venv/bin/python scripts/generate-reflectivity-scale.py"""
import datetime as dt
import io
import json
from pathlib import Path
import sys
import urllib.request

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
URL = ('https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.3.0'
       '&request=GetLegendGraphic&format=image/png&layer=conus_bref_qcd')
SCAN = ROOT / 'docs/radar-investigation/conus_bref_qcd-latest.png'
OUT = ROOT / 'src/radar/reflectivityScale.json'
BAR_ROW, LABEL_ROWS = 5, range(11, 30)
LABELS = list(range(-20, 80, 10))
BRIGHT = 180
MAX_OFF_SCALE = 0.01
OFF_SCALE_DISTANCE = 12  # sum of channel differences, as in the first check of this legend

with urllib.request.urlopen(URL, timeout=30) as r:
    legend = Image.open(io.BytesIO(r.read())).convert('RGB')
width, _ = legend.size

# Label glyphs are bright on a dark strip; each run of bright columns is one label.
bright = [x for x in range(width) if any(min(legend.getpixel((x, y))) > BRIGHT for y in LABEL_ROWS)]
clusters, run = [], []
for x in bright:
    if run and x - run[-1] > 8:
        clusters.append(run); run = []
    run.append(x)
clusters.append(run)
if len(clusters) != len(LABELS):
    sys.exit(f'Expected {len(LABELS)} labels, found {len(clusters)}')
# Minus signs shift a label's center, so only the non-negative labels are fitted.
pairs = [((c[0] + c[-1]) / 2, d) for c, d in zip(clusters, LABELS) if d >= 0]
n = len(pairs)
mx, my = sum(p[1] for p in pairs) / n, sum(p[0] for p in pairs) / n
slope = sum((d - mx) * (x - my) for x, d in pairs) / sum((d - mx) ** 2 for _, d in pairs)
if abs(slope - 5) > 0.05:
    sys.exit(f'Unexpected legend scale: {slope:.3f} pixels per dBZ')
zero = my - slope * mx

colors = [legend.getpixel((x, BAR_ROW)) for x in range(width)]
table = sorted(set(colors))
scan = Image.open(SCAN).convert('RGBA')
seen = {}
for p in scan.getdata():
    if p[3]:
        seen[p[:3]] = seen.get(p[:3], 0) + 1
pixels = sum(seen.values())
off = sum(c for p, c in seen.items() if min(sum(abs(a - b) for a, b in zip(p, q)) for q in table) > OFF_SCALE_DISTANCE)
if off / pixels > MAX_OFF_SCALE:
    sys.exit(f'{off} of {pixels} scan pixels are off the legend')

json.dump({
    'source': URL,
    'retrieved': dt.date.today().isoformat(),
    'minDbz': round(-zero / slope, 2),
    'stepDbz': round(1 / slope, 4),
    'colors': ['#%02x%02x%02x' % c for c in colors],
    'scanCheck': {'pixels': pixels, 'offScale': off},
}, open(OUT, 'w'))
print(f'{len(colors)} colors, zero at x={zero:.2f}, slope {slope:.3f}, scan off-scale {off}/{pixels}')
