"""Overpass local-solar-time per satellite per year (daytime detections), and 2025-26 monthly counts."""
from pathlib import Path
import pandas as pd
ROOT = Path(__file__).resolve().parents[2]
p = pd.read_pickle(ROOT / "data/explore/points.pkl")
p["year"] = p.date.dt.year
d = p[p.dn == "D"]
t = d.groupby(["sat", "year"]).lst_h.median().unstack(0).round(2)
print("Median local solar time (h) of DAY detections:\n", t)
n = p[p.dn == "N"]
print("Median LST of NIGHT detections (wrapped -> hours after 18:00 shown as-is):\n",
      n.groupby(["sat", "year"]).lst_h.median().unstack(0).round(2))
m = p[p.date >= "2025-01-01"].copy()
m["ym"] = m.date.dt.to_period("M")
print(m.groupby(["ym", "sat"]).size().unstack(1).fillna(0).astype(int))
