"""Offline archive for the website ("Archive Mode"): the explorer and home page keep working when the FastAPI
server is unreachable (e.g. a Vercel-only deploy or a demo without the API running).

It imports the API's own Store (read-only; nothing in api/ or pipeline/ is changed), so every number is produced
by the same code path the live API uses. Run from the repo root after the API data is built:

    py -3.14 -E -P web/scripts/export_offline.py

Output: web/public/offline/*.json (fetched lazily by the browser, only when the live API is not reachable),
and web/content/data/raw_counts_pakistan.json (bundled: raw vs harmonized yearly counts for the home page).
"""
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from api.core import store  # noqa: E402

import duckdb  # noqa: E402

OUT = ROOT / "web" / "public" / "offline"
(OUT / "points").mkdir(parents=True, exist_ok=True)
(OUT / "daily").mkdir(parents=True, exist_ok=True)
BUNDLE = ROOT / "web" / "content" / "data"
s = store()
total = 0


def dump(path: Path, obj) -> None:
    global total
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    total += path.stat().st_size


def slug(key: str) -> str:
    return "pakistan" if key == "pakistan" else key.split(":", 1)[1]


presets = s.presets()
keys = [p["key"] for p in presets]

# 1. full-range calendar + forecast for Pakistan and every province (default filters, MODIS-eq)
cal_pk = None
for k in keys:
    c = s.calendar(k, None, None)
    if k == "pakistan":
        cal_pk = c
    dump(OUT / f"calendar_{slug(k)}.json", c)
    try:
        dump(OUT / f"forecast_{slug(k)}.json", s.forecast(k))
    except Exception as ex:  # forecast needs data_forecast_model.json; skip quietly if absent
        print("forecast skipped", k, ex)

# 2. density grid over the whole record (map overview)
for k in keys:
    dump(OUT / f"grid_{slug(k)}.json", s.grid(k, None, None, False, 0.1))

# 3. province stats: whole range, and per month (one file per year)
dump(OUT / "regions_range.json", s.region_stats(None, None, None))
by_year: dict[int, dict] = {}
for m in cal_pk["months"]:
    by_year.setdefault(m["year"], {})[m["ym"]] = s.region_stats(None, None, m["ym"])
for y, v in by_year.items():
    dump(OUT / f"regions_{y}.json", v)

# 4. day-by-day for the most recent 24 months (small), month hotspots for the latest 7 months of Pakistan and the
#    latest month of each province (hotspot files are large; older months need the live API)
all_ym = [m["ym"] for m in cal_pk["months"]]
recent = all_ym[-24:]
point_months: dict[str, list[str]] = {}
for k in keys:
    for ym in recent:
        dump(OUT / "daily" / f"{slug(k)}_{ym}.json", s.daily(k, ym))
    point_months[k] = all_ym[-7:] if k == "pakistan" else all_ym[-1:]
    for ym in point_months[k]:
        dump(OUT / "points" / f"{slug(k)}_{ym}.json", s.points(k, ym))

dump(OUT / "manifest.json", {
    "generated_from": "api.core.Store (same code path as the live API)",
    "data_extent": cal_pk["data_extent"],
    "presets": presets,
    "daily_months": recent,
    "point_months": point_months,
    "note": "Default filters only: static heat sources excluded, MODIS-equivalent unit.",
})
print(f"offline archive: {total / 1e6:.1f} MB in {OUT}")

# 5. raw (unharmonized) yearly counts vs harmonized series, Pakistan (home page 'sensor illusion' toggle)
q = f"""SELECT year(date) AS y, sensor, count(*) AS n
        FROM read_parquet('{(ROOT / 'data' / 'harmonized_points.parquet').as_posix()}')
        WHERE conf_ok AND NOT static_flag GROUP BY ALL ORDER BY 1, 2"""
raw: dict[int, dict] = {}
for y, sensor, n in duckdb.sql(q).fetchall():
    raw.setdefault(int(y), {"modis": 0, "viirs": 0})["modis" if sensor == "MODIS" else "viirs"] += int(n)
harm = {r["year"]: r["value"] for r in cal_pk["stats"]["yearly"]}
years = [y for y in sorted(raw) if y in harm]
(BUNDLE / "raw_counts_pakistan.json").write_text(json.dumps({
    "note": "Raw = every detection that passes the confidence filter (MODIS conf>=30, VIIRS n/h), static heat sources "
            "excluded, all satellites simply added together. Harmonized = the Aatish MODIS-equivalent series. "
            "Complete years only.",
    "years": [{"year": y, "raw_modis": raw[y]["modis"], "raw_viirs": raw[y]["viirs"],
               "raw_total": raw[y]["modis"] + raw[y]["viirs"], "harmonized": round(harm[y], 1)} for y in years],
}, separators=(",", ":")), encoding="utf-8")
print("raw_counts_pakistan.json written,", len(years), "years")
