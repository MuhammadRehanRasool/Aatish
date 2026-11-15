"""Self-audit part 2: is the anomaly error method error or Terra's 10:30 sampling? Aqua-only target vs T+A target."""
from __future__ import annotations
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np, pandas as pd
import fc_lib as L
p = pd.read_parquet(L.DATA / "harmonized_points.parquet"); p["date"] = pd.to_datetime(p.date); p = L.add_keys(p)
nd = pd.read_csv(L.DATA / "no_data_days.csv", parse_dates=["date"]); act = L.active_table(p, nd[nd.satellite.isin(L.VIIRS_SATS)])
key = pd.MultiIndex.from_arrays([p.date, p.daynight])
sa = act["N"].reindex(key, fill_value=False).astype(bool).values
usable = p.conf_ok & ~p.static_flag
F = p[usable & (p.date >= L.FIT_START) & (p.date <= L.FIT_END) & ~L.in_windows(p) & sa]
f_sat = json.loads((L.DATA / "calibration.json").read_text(encoding="utf-8"))["f_sat"]
years = sorted(F.year.unique())
def run(Fset, label):
    M = Fset[Fset.sensor == "MODIS"]; parts = []
    V = Fset[Fset.satellite.isin(L.VIIRS_SATS)]
    for y in years:
        m = L.fit_model(Fset[Fset.year != y]); te = V[V.year == y]
        parts.append(te.assign(h=L.point_weight(te, m) * te.satellite.map(f_sat).values / te.n_active.values))
    mets, c, _ = L.evaluate(M, pd.concat(parts))
    c = c.assign(moy=c.index.month)
    lm, lh = np.log1p(c.m), np.log1p(c.h)
    am = lm - lm.groupby(c.moy).transform("mean"); ah = lh - lh.groupby(c.moy).transform("mean")
    pe = np.abs(c.groupby("moy").m.rank(pct=True) - c.groupby("moy").h.rank(pct=True))
    print(f"{label:28s} MdAPE {mets['country_month']['MdAPE']:5.1f}  anomaly R2 {1-((am-ah)**2).sum()/((am-am.mean())**2).sum():.3f}"
          f"  pctl err {pe.mean()*100:.1f} pp  median-agree {np.mean((c.m>c.groupby('moy').m.transform('median'))==(c.h>c.groupby('moy').h.transform('median')))*100:.0f}%")
run(F, "target Terra+Aqua (shipped)")
run(F[F.satellite != "Terra"], "target Aqua only")
run(F[(F.satellite != "Terra") & (F.daynight == "D")], "Aqua only, day only")
# noise floor: how well does Terra+Aqua anomaly predict Aqua-only anomaly (two MODIS instruments)?
M = F[F.sensor == "MODIS"]; c = M.groupby(["ym", "satellite"]).size().unstack().fillna(0)
c["moy"] = c.index.month
for a, b in (("Terra", "Aqua"),):
    la, lb = np.log1p(c[a]), np.log1p(c[b])
    aa = la - la.groupby(c.moy).transform("mean"); ab = lb - lb.groupby(c.moy).transform("mean")
    print(f"reference: corr of monthly anomalies Terra vs Aqua = {np.corrcoef(aa, ab)[0,1]:.3f}")
