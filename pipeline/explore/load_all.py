"""Exploration helper: load every raw FIRMS CSV into one table -> data/explore/points.pkl

Columns: sensor (MODIS/SNPP/N20/N21), sat (Terra/Aqua/N/N20/N21), src_file, quality (SP/NRT),
lat, lon, date, acq_time(int HHMM UTC), dn (D/N), conf (raw string), type (NaN for NRT), frp,
lst_h (local solar time in hours = UTC + lon/15).
Exploration only; the real pipeline will live in pipeline/build_*.py.
"""
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "raw_data"
OUT = ROOT / "data" / "explore"
OUT.mkdir(parents=True, exist_ok=True)

SENSOR_DIRS = {"modis": "MODIS", "viirs-snpp": "SNPP", "viirs-jpss1": "N20", "viirs-jpss2": "N21"}

frames = []
for d, sensor in SENSOR_DIRS.items():
    for f in sorted((RAW / d).glob("*.csv")):
        df = pd.read_csv(f, dtype={"acq_time": str, "confidence": str, "satellite": str})
        q = "NRT" if f.stem.endswith("_NRT") else "SP"
        out = pd.DataFrame({
            "sensor": sensor,
            "sat": df["satellite"].astype(str),
            "src_file": f.name,
            "quality": q,
            "lat": df["latitude"].astype(float),
            "lon": df["longitude"].astype(float),
            "date": pd.to_datetime(df["acq_date"]),
            "acq_time": df["acq_time"].astype(int),
            "dn": df["daynight"],
            "conf": df["confidence"].astype(str),
            "type": df["type"] if "type" in df.columns else pd.NA,
            "frp": df["frp"].astype(float),
            "scan": df["scan"].astype(float),
            "track": df["track"].astype(float),
            "version": df["version"].astype(str),
        })
        frames.append(out)

pts = pd.concat(frames, ignore_index=True)
hh = pts["acq_time"] // 100 + (pts["acq_time"] % 100) / 60
pts["lst_h"] = (hh + pts["lon"] / 15) % 24
pts["type"] = pd.to_numeric(pts["type"], errors="coerce")
pts.to_pickle(OUT / "points.pkl")
print(pts.groupby(["sensor", "sat", "quality"]).size())
print("total", len(pts))
