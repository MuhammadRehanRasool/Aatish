"""Pick the no-data rule: for each VIIRS sat-day-daynight with 0 detections, how many did the other
VIIRS sats see? Genuine quiet days should have small 'other' counts; outages large ones."""
import sys, pathlib, time; sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import numpy as np, pandas as pd
import fc_lib as L
t = time.time(); p = L.load_raw(); print("loaded", len(p), round(time.time() - t, 1), "s")
for thr in (1, 5, 10, 20, 50):
    nd = L.detect_no_data(p, thr)
    print(f"ref_min={thr:3d}: flagged sat-day-dn:", nd.groupby(["satellite", "daynight"]).size().to_dict())
nd = L.detect_no_data(p, 1)
print("\nDistribution of other-sat count on zero sat-day-dn (ref>=1):")
print(nd.groupby(["satellite", "daynight"]).ref_max_other.describe(percentiles=[.5, .9]).round(1))
# Ratio sanity: when both active, sat count vs other count on low days
cnt = p[p.sensor != "MODIS"].groupby(["date", "daynight", "satellite"]).size().unstack().fillna(0)
both = cnt[(cnt.N > 0) & (cnt.N20 > 0)]
print("\nWhen both N and N20 >0: P(N20 count >=10 | N count small (1-2))",
      round((both[both.N <= 2].N20 >= 10).mean(), 3), " n=", int((both.N <= 2).sum()))
print("Day rows ref>=10 flagged list (D):")
nd10 = L.detect_no_data(p, 10)
for s, g in nd10.groupby("satellite"):
    g = g.sort_values("date"); runs = (g.date.diff().dt.days.fillna(99) > 1).cumsum()
    print(s, [(str(x.date.min().date()), int(x.date.nunique()), "".join(sorted(x.daynight.unique()))) for _, x in g.groupby(runs)])
