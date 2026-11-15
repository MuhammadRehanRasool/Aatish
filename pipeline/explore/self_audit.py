"""Self-audit of the shipped method (2026-11-14). Reads data/harmonized_points.parquet only.

A1 no-data rule bias: ref_min=1 vs a Poisson run rule (cumulative other-sat count >= 5 over a zero run)
A2 anomaly skill: deseasonalised R2, within-month percentile error, above/below-median agreement (LOYO)
A3 error vs AOI size / count: LOYO at 0.25/0.5/1 deg cells, residual spread by predicted-count bucket
A4 NOAA-21 FRP: quantile ratio N21/N20, and FRP/1.1 alternative to the scalar f_sat
A5 shrinkage k sweep
A6 diurnal-shift hints: Oct-Nov Terra share and VIIRS night share per year
Usage: py -3.14 -E -P pipeline/explore/self_audit.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import pandas as pd

import fc_lib as L

pd.set_option("display.width", 200)
p = pd.read_parquet(L.DATA / "harmonized_points.parquet")
p["date"] = pd.to_datetime(p.date)
p = L.add_keys(p)
nd = pd.read_csv(L.DATA / "no_data_days.csv", parse_dates=["date"])
ndv = nd[nd.satellite.isin(L.VIIRS_SATS)]
act = L.active_table(p, ndv)
key = pd.MultiIndex.from_arrays([p.date, p.daynight])
snpp_active = act["N"].reindex(key, fill_value=False).astype(bool).values
usable = p.conf_ok & ~p.static_flag
F_mask = usable & (p.date >= L.FIT_START) & (p.date <= L.FIT_END) & ~L.in_windows(p) & snpp_active
F = p[F_mask].copy()
M = F[F.sensor == "MODIS"]
years = sorted(F.year.unique())
import json
f_sat = json.loads((L.DATA / "calibration.json").read_text(encoding="utf-8"))["f_sat"]


def loyo(Fset, k=L.K_SHRINK, merged=True):
    Vin = Fset[Fset.satellite.isin(L.VIIRS_SATS)] if merged else Fset[Fset.satellite == "N"]
    parts = []
    for y in years:
        m = L.fit_model(Fset[Fset.year != y], k=k)
        te = Vin[Vin.year == y]
        h = L.point_weight(te, m)
        if merged:
            h = h * te.satellite.map(f_sat).values / te.n_active.values
        parts.append(te.assign(h=h))
    return pd.concat(parts)


print("\n=== A1 no-data rule ===")
cnt = p[usable & p.satellite.isin(L.VIIRS_SATS)].groupby(["date", "daynight", "satellite"]).size().unstack().reindex(columns=L.VIIRS_SATS)
fl = ndv[ndv.status.str.startswith("rule")].copy()
fl = fl.sort_values(["satellite", "daynight", "date"])
# runs per satellite+daynight of consecutive flagged dates
fl["gap"] = fl.groupby(["satellite", "daynight"]).date.diff().dt.days.ne(1).cumsum()
oth = []
for _, r in fl.iterrows():
    c = cnt.loc[(r.date, r.daynight)] if (r.date, r.daynight) in cnt.index else pd.Series(dtype=float)
    oth.append(float(c.drop(r.satellite, errors="ignore").max()) if len(c) else 0.0)
fl["other"] = oth
runs = fl.groupby(["satellite", "daynight", "gap"]).agg(start=("date", "min"), n=("date", "size"), other_sum=("other", "sum"))
weak = runs[runs.other_sum < 5]
print(f"rule-flagged runs: {len(runs)}; runs with cumulative other-sat count <5 (Poisson P(0)>~0.7%): {len(weak)} "
      f"covering {int(weak.n.sum())} sat-day-dn slots")
# weight inflation: on weak slots, the remaining sat got weight /1 instead of /2
weak_slots = fl.merge(weak.reset_index()[["satellite", "daynight", "gap"]], on=["satellite", "daynight", "gap"])
ws = set(zip(weak_slots.date, weak_slots.daynight))
v = p[usable & p.satellite.isin(L.VIIRS_SATS) & (p.series_role == "derived")]
inw = np.array([(d, n) in ws for d, n in zip(v.date, v.daynight)])
extra = (v.w_modis_eq[inw] * (1 - v.n_active[inw] / (v.n_active[inw] + 1))).sum()
print(f"derived series total {v.w_modis_eq.sum():.0f}; excess weight from weak flags {extra:.1f} "
      f"({extra / v.w_modis_eq.sum() * 100:.2f}%)")
mon = v.assign(x=np.where(inw, v.w_modis_eq * (1 - v.n_active / (v.n_active + 1)), 0)).groupby("ym")[["w_modis_eq", "x"]].sum()
mon["pct"] = mon.x / mon.w_modis_eq * 100
print("worst derived months by excess %:\n", mon.sort_values("pct", ascending=False).head(6).round(2).to_string())

print("\n=== A2 anomaly skill (LOYO merged, country-month) ===")
Vp = loyo(F)
_, cty, cel = L.evaluate(M, Vp)
c = cty.copy()
c["moy"] = c.index.month
c["year"] = c.index.year
lm, lh = np.log1p(c.m), np.log1p(c.h)
am = lm - lm.groupby(c.moy).transform("mean")
ah = lh - lh.groupby(c.moy).transform("mean")
print(f"raw log R2 {1 - ((lm - lh) ** 2).sum() / ((lm - lm.mean()) ** 2).sum():.3f} | "
      f"deseasonalised (anomaly) R2 {1 - ((am - ah) ** 2).sum() / ((am - am.mean()) ** 2).sum():.3f} | "
      f"corr of anomalies {np.corrcoef(am, ah)[0, 1]:.3f}")
pm = c.groupby("moy").m.rank(pct=True)
ph = c.groupby("moy").h.rank(pct=True)
print(f"within-month percentile error: mean {np.abs(pm - ph).mean() * 100:.1f} pp, 90th pct {np.quantile(np.abs(pm - ph), .9) * 100:.1f} pp")
med_m = c.m > c.groupby("moy").m.transform("median")
med_h = c.h > c.groupby("moy").h.transform("median")
print(f"above/below-median agreement {np.mean(med_m == med_h) * 100:.1f}%")
# 'worst year in this calendar month' agreement
best_m = c.loc[c.groupby("moy").m.idxmax(), ["moy", "year"]].set_index("moy").year
best_h = c.loc[c.groupby("moy").h.idxmax(), ["moy", "year"]].set_index("moy").year
print(f"same worst year per calendar month: {(best_m == best_h).sum()}/12")

print("\n=== A3 error vs AOI size and count ===")
for deg in (0.25, 0.5, 1.0):
    gk = lambda d: (np.floor(d.lat / deg)).astype(int).astype(str) + "_" + (np.floor(d.lon / deg)).astype(int).astype(str)
    mm = M.assign(g=gk(M)).groupby(["ym", "g"]).size().rename("m")
    hh = Vp.assign(g=gk(Vp)).groupby(["ym", "g"]).h.sum()
    t = pd.concat([mm, hh], axis=1).fillna(0)
    r = L.metr(t.m, t.h)
    print(f"{deg} deg cell-month: MdAPE {r['MdAPE']} (n>=20: {r['n_ge20']}), RMSLE {r['RMSLE']}, R2 {r['R2']}")
cel2 = cel.copy()
cel2["lr"] = np.log1p(cel2.m) - np.log1p(cel2.h)
cel2["bucket"] = pd.cut(cel2.h, [0, 2, 5, 20, 100, 1e9], labels=["<2", "2-5", "5-20", "20-100", ">100"])
print("1-deg cell-month log1p residual by predicted count (q10/q90, nested-free):")
print(cel2.groupby("bucket", observed=True).lr.quantile([.1, .9]).unstack().round(3).assign(
    n=cel2.groupby("bucket", observed=True).size()).to_string())
print(f"pooled (shipped) band: q10 {cel2.lr.quantile(.1):.3f}  q90 {cel2.lr.quantile(.9):.3f}")

print("\n=== A4 NOAA-21 FRP ===")
both = (act["N20"] & act["N21"]).reindex(key, fill_value=False).astype(bool).values
sp = usable & (p.quality == "SP") & both
for dn in ("D", "N"):
    a = p.frp[sp & (p.satellite == "N21") & (p.daynight == dn)]
    b = p.frp[sp & (p.satellite == "N20") & (p.daynight == dn)]
    qs = [.1, .25, .5, .75, .9]
    print(dn, "N21/N20 FRP quantile ratios", dict(zip(qs, np.round(a.quantile(qs).values / b.quantile(qs).values, 3))),
          "counts", len(a), len(b))
m_all = L.fit_model(F)
def wsum(df):
    return L.point_weight(df, m_all).sum()
a = p[sp & (p.satellite == "N21")]
b = p[sp & (p.satellite == "N20")]
for lbl, scale in (("as is", 1.0), ("FRP/1.10", 1.10), ("FRP/1.20", 1.20)):
    a2 = a.assign(frp=a.frp / scale)
    a2 = a2.assign(fbin=pd.cut(a2.frp, L.FRP_BINS, right=False, labels=False).astype("int8"))
    print(f"  N21 weight / N20 weight on shared days, {lbl}: {wsum(a2) / wsum(b):.3f} (count ratio {len(a) / len(b):.3f})")

print("\n=== A5 shrinkage k ===")
for k in (25, 50, 100, 200, 400, 1000):
    _, _, ce = L.evaluate(M, loyo(F, k=k))
    r = L.metr(ce.m, ce.h)
    print(f"k={k}: cell MdAPE {r['MdAPE']} RMSLE {r['RMSLE']} R2 {r['R2']}")

print("\n=== A6 diurnal-shift hints (Oct-Nov, usable) ===")
on = usable & p.moy.isin([10, 11])
mod = p[on & (p.sensor == "MODIS") & (p.daynight == "D")].groupby(["year", "satellite"]).size().unstack()
vi = p[on & (p.satellite == "N")].groupby(["year", "daynight"]).size().unstack()
out = pd.DataFrame({"terra_share_day": (mod.Terra / (mod.Terra + mod.Aqua)).round(3),
                    "snpp_night_share": (vi.N / (vi.N + vi.D)).round(3), "snpp_day": vi.D})
print(out.loc[2012:].to_string())
