"""Fetch FIRMS area-API CSVs for a date range in 5-day chunks (API max DAY_RANGE=5),
then clip to a boundary polygon so they match FIRMS yearly country files.
usage: firms_fetch.py SOURCE START END OUT_CSV BOUNDARY_GEOJSON
MAP_KEY is read from env FIRMS_MAP_KEY."""
import sys, os, json, time, io
from datetime import date, timedelta
import requests, numpy as np, pandas as pd
from matplotlib.path import Path

src, start, end, out, boundary = sys.argv[1:6]
key = os.environ['FIRMS_MAP_KEY']
g = json.load(open(boundary))
polys = []
for feat in g['features']:
    geom = feat['geometry']
    parts = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for p in parts:
        polys.append(Path(np.array(p[0])))  # outer ring (no holes in ADM0 Pakistan)
allpts = np.vstack([p.vertices for p in polys])
w, s = allpts.min(0) - 0.05; e, n = allpts.max(0) + 0.05
bbox = f"{w:.3f},{s:.3f},{e:.3f},{n:.3f}"
# transaction cost per FIRMS page: ceil(ceil(dx/60)*ceil(dy/60)*src_w*days), src_w=2 VIIRS, 0.5 MODIS
cost = int(np.ceil(np.ceil((e-w)/60)*np.ceil((n-s)/60)*(2 if 'VIIRS' in src else 0.5)*5))
d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
frames, d, spent = [], d0, 0
while d <= d1:
    span = min(5, (d1 - d).days + 1)
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/{bbox}/{span}/{d.isoformat()}"
    for attempt in range(6):
        try:
            r = requests.get(url, timeout=(30, 120))
            if r.ok and r.text.startswith('latitude'): break
            print('retry', d, r.status_code, r.text[:120], file=sys.stderr)
        except requests.RequestException as ex:
            print('retry', d, type(ex).__name__, file=sys.stderr)
        time.sleep(15 * (attempt + 1))
    else:
        sys.exit(f"FAILED at {d}")
    df = pd.read_csv(io.StringIO(r.text), dtype={'acq_time': str, 'confidence': str, 'version': str})
    frames.append(df); spent += cost
    if spent > 4000:  # stay under 5000 / 10 min
        print('pausing 10 min for quota', file=sys.stderr); time.sleep(610); spent = 0
    d += timedelta(days=span); time.sleep(0.5)
df = pd.concat(frames, ignore_index=True).drop_duplicates()
pts = df[['longitude', 'latitude']].to_numpy()
inside = np.zeros(len(df), bool)
for p in polys: inside |= p.contains_points(pts)
print(f"{src} {start}..{end}: bbox rows={len(df)} inside={inside.sum()}", file=sys.stderr)
os.makedirs(os.path.dirname(out), exist_ok=True)
df[inside].to_csv(out, index=False)
df[~inside].to_csv(out.replace('.csv', '_outside_polygon.csv'), index=False)
