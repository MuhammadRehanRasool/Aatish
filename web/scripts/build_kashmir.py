"""Build web/public/data/kashmir.geojson: Jammu & Kashmir shown as disputed territory on the map.

Source: Natural Earth 1:10m "Admin 0 - Breakaway, Disputed Areas" (public domain),
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_disputed_areas.geojson
Usage: py -3.14 -E -P web/scripts/build_kashmir.py <ne_disputed.geojson>

Output features (map display only; the fire data is NOT changed):
  part=outside  Indian-administered J&K + Siachen, minus our Pakistan clip polygon (no fire data here) -> hatched
  part=outline  the whole region (all parts + our AJK/GB polygons), drawn as a dashed outline
  part=label    a point for the "disputed territory" label
China-administered Aksai Chin and Shaksgam are not included.
"""
import json
import sys
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
PARTS = {'Jammu and Kashmir', 'Siachen Glacier', 'Azad Kashmir', 'Gilgit-Baltistan'}

ne = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
parts = [shape(f['geometry']) for f in ne['features'] if f['properties'].get('BRK_NAME') in PARTS]
not_pk = unary_union([shape(f['geometry']) for f in ne['features'] if f['properties'].get('BRK_NAME') in {'Jammu and Kashmir', 'Siachen Glacier'}])
assert len(parts) == len(PARTS), f'found {len(parts)} of {len(PARTS)} Natural Earth parts'

regions = json.loads((ROOT / 'web/public/data/regions.geojson').read_text(encoding='utf-8'))
geo = {f['properties']['key']: shape(f['geometry']) for f in regions['features']}
pak = geo['pakistan'].buffer(0)
pk_jk = unary_union([geo['region:PK-GB'], geo['region:PK-JK']]).buffer(0)

whole = unary_union(parts + [pk_jk]).buffer(0.002).buffer(-0.002)
outside = not_pk.difference(pak).buffer(0)
# drop slivers left by the two sources' slightly different border lines
if outside.geom_type == 'MultiPolygon':
    outside = unary_union([p for p in outside.geoms if p.area > 0.05])
outline = whole.simplify(0.005)
outside = outside.simplify(0.005)

note = 'Disputed territory'
out = {
    'type': 'FeatureCollection',
    'features': [
        {'type': 'Feature', 'properties': {'part': 'outside', 'label': 'Jammu & Kashmir', 'note': note}, 'geometry': mapping(outside)},
        {'type': 'Feature', 'properties': {'part': 'outline'}, 'geometry': mapping(outline.boundary)},
        {'type': 'Feature', 'properties': {'part': 'label', 'label': 'JAMMU & KASHMIR\nDisputed territory'}, 'geometry': {'type': 'Point', 'coordinates': [76.1, 34.05]}},
    ],
}
dst = ROOT / 'web/public/data/kashmir.geojson'
dst.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
print(dst, dst.stat().st_size, 'bytes; outside area deg2 =', round(outside.area, 2), 'bounds', [round(v, 2) for v in outside.bounds])
