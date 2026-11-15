"""Follow-up checks:
1. Per-year LOYO bias of ratio(dn, moy) -> is the ratio stationary (needed for trend claims)?
2. Merged VIIRS (mean of S-NPP & N20) vs S-NPP alone, 2018-04..2022-09.
3. Drift check: model fitted 2012..2022-09 applied to 2022-10..2026 -> MODIS obs / pred, per year & sat.
4. Terra-only period: (Terra+Aqua)/Terra ratio by month-of-year, 2003..2021, and its stability.
5. Pre-2018 MODIS typing (type v3 change): share of type 2 by year.
"""
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
P = pd.read_pickle(ROOT / "data/explore/points.pkl")
pd.set_option("display.width", 220)

print("5) type!=0 share by year (MODIS / SNPP):")
P["year"] = P.date.dt.year
sp = P[P.quality == "SP"]
print(sp.assign(ns=sp.type != 0).groupby(["year", "sensor"]).ns.mean().unstack().round(4).T.to_string())

p = P[P.type == 0]
is_m = p.sensor == "MODIS"
mconf = pd.to_numeric(p.conf.where(is_m), errors="coerce")
p = p[(is_m & (mconf >= 30)) | (~is_m & p.conf.isin(["n", "h"]))].copy()
p["ym"] = p.date.dt.to_period("M"); p["moy"] = p.date.dt.month
bad = ((p.date >= "2022-07-27") & (p.date <= "2022-08-10")) | ((p.date >= "2020-08-16") & (p.date <= "2020-09-02"))
p = p[~bad]

def monthly(df):
    return df.groupby(["ym", "dn"]).size()

def tbl(start, end):
    q = p[(p.date >= start) & (p.date < end)]
    f = pd.concat({
        "m": monthly(q[q.sensor == "MODIS"]),
        "aqua": monthly(q[q.sat == "Aqua"]),
        "terra": monthly(q[q.sat == "Terra"]),
        "v": monthly(q[q.sat == "N"]),
        "v20": monthly(q[q.sat == "N20"]),
        "v21": monthly(q[q.sat == "N21"]),
    }, axis=1).fillna(0).reset_index()
    f["moy"] = f.ym.dt.month; f["year"] = f.ym.dt.year
    return f

def fit_ratio(tr, col="v"):
    g = tr.groupby(["dn", "moy"])[["m", col]].sum()
    return g.m / g[col]

def apply(r, te, col="v"):
    return te[col].values * r.reindex(pd.MultiIndex.from_frame(te[["dn", "moy"]])).values

F = tbl("2012-01-20", "2022-10-01")
print("\n1) LOYO per-year bias (%) of ratio(dn,moy), and of a merged-satellite version:")
rows = []
for yr in sorted(F.year.unique()):
    tr, te = F[F.year != yr], F[F.year == yr]
    h = apply(fit_ratio(tr), te)
    rows.append((yr, round((h.sum() / te.m.sum() - 1) * 100, 1), int(te.m.sum())))
print(pd.DataFrame(rows, columns=["year", "bias_pct", "modis_obs"]).to_string(index=False))

print("\n2) S-NPP alone vs mean(S-NPP,N20), fit 2012..2017 on S-NPP, test 2018-04..2022-09 (country-month):")
tr = F[F.year < 2018]; te = F[F.ym >= pd.Period("2018-04", "M")].copy()
r = fit_ratio(tr)
k20 = te.v.sum() / te.v20.sum()  # N20 -> SNPP-equivalent factor (in-sample here; reported)
for name, col in [("snpp", te.v), ("n20", te.v20 * k20), ("mean", (te.v + te.v20 * k20) / 2)]:
    h = apply(r, te.assign(x=col), "x")
    ev = te.assign(h=h).groupby("ym")[["m", "h"]].sum()
    ape = (np.abs(ev.h - ev.m) / ev.m * 100)[ev.m >= 20]
    le = np.log1p(ev.h) - np.log1p(ev.m)
    print(f"  {name:5s} MdAPE={ape.median():.1f}%  RMSLE={np.sqrt((le**2).mean()):.3f}  bias={(ev.h.sum()/ev.m.sum()-1)*100:.1f}%")
print("  N20->SNPP factor", round(k20, 3))

print("\n3) Drift check: fitted 2012..2022-09, applied after. obs/pred MODIS (total, Aqua-only share):")
r_all = fit_ratio(F)
ra = F.groupby(["dn", "moy"]).aqua.sum() / F.groupby(["dn", "moy"]).v.sum()
rt = F.groupby(["dn", "moy"]).terra.sum() / F.groupby(["dn", "moy"]).v.sum()
G = tbl("2012-01-20", "2026-11-14")
# VIIRS predictor after S-NPP ends: use N20*k20 when SNPP missing
G["vx"] = np.where(G.v > 0, G.v, G.v20 * k20)
idx = pd.MultiIndex.from_frame(G[["dn", "moy"]])
G["pm"] = G.vx * r_all.reindex(idx).values
G["pa"] = G.vx * ra.reindex(idx).values
G["pt"] = G.vx * rt.reindex(idx).values
y = G.groupby("year")[["m", "pm", "aqua", "pa", "terra", "pt"]].sum()
out = pd.DataFrame({"MODIS obs/pred": y.m / y.pm, "Aqua obs/pred": y.aqua / y.pa, "Terra obs/pred": y.terra / y.pt}).round(2)
print(out.to_string())
G["season"] = G.moy.map(lambda x: "Oct-Nov" if x in (10, 11) else ("Apr-May" if x in (4, 5) else "other"))
s = G[G.year >= 2016].groupby(["year", "season"])[["aqua", "pa", "terra", "pt"]].sum()
print("\n   Aqua / Terra obs/pred by season (D+N):")
print(pd.DataFrame({"aqua": s.aqua / s.pa, "terra": s.terra / s.pt}).round(2).unstack().to_string())

print("\n4) Terra-only period. (Terra+Aqua)/Terra by month-of-year, 2003..2021 (D+N), and year-to-year CV:")
H = tbl("2003-01-01", "2022-01-01").groupby(["year", "moy"])[["terra", "aqua", "m"]].sum().reset_index()
g = H.groupby("moy")[["m", "terra"]].sum()
H["ratio"] = H.m / H.terra.replace(0, np.nan)
print(pd.DataFrame({"pooled": (g.m / g.terra).round(2), "median_yr": H.groupby("moy").ratio.median().round(2),
                    "cv_yr": (H.groupby("moy").ratio.std() / H.groupby("moy").ratio.mean()).round(2)}).T.to_string())
print("   Terra-only months in data:", p[(p.sensor == "MODIS") & (p.date < "2002-07-06")].ym.nunique(),
      "(2000-11 .. 2002-07-05)")
