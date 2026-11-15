"""Round 3:
R1  physics weight from the matched detection-probability curve (E2), fitted per fold on training years,
    times a month-of-year factor (+ local adjustment).
R2  ensemble: mean of GBM and ratio+local.
R3  forward-in-time test (train 2012-2017, test 2018-2022-09): does each method extrapolate?
R4  NOAA-20 transfer (train on S-NPP 2012-2017, predict from N20 features 2018-04..2022-09).
R5  interval fix: pooled (all months) LOYO log-residual quantiles -> coverage.
"""
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
import sys, pathlib; sys.path.insert(0, str(pathlib.Path(__file__).parent))
from common import *  # noqa: F401,F403  (p, M, V, V20, T, BL, metrics and methods)

# ---- matched flag for S-NPP points (same day+dn Aqua within 1.5 km) ----
A_idx = M[M.sat == "Aqua"].set_index(["date", "dn"]).sort_index()
coslat = np.cos(np.deg2rad(30))
hit = pd.Series(False, index=V.index)
for (d, dn), vv in V.groupby(["date", "dn"]):
    if (d, dn) not in A_idx.index: continue
    aa = A_idx.loc[[(d, dn)]]
    tree = cKDTree(np.c_[aa.lat.values * 111.0, aa.lon.values * 111.0 * coslat])
    dist, _ = tree.query(np.c_[vv.lat.values * 111.0, vv.lon.values * 111.0 * coslat], k=1)
    hit.loc[vv.index] = dist <= 1.5
FB = [0, 1, 2, 4, 8, 16, 32, 1e9]
Vh = V.assign(hit=hit, fb2=pd.cut(V.frp, FB, right=False, labels=False))
K = ["cell1", "ym", "moy", "year", "dn"]

def physics_feature(train_years):
    """per point: P(Aqua detects | FRP bin, dn) estimated on train years; summed per row of T."""
    pr = Vh[Vh.year.isin(train_years)].groupby(["fb2", "dn"]).hit.mean()
    w = pr.reindex(pd.MultiIndex.from_frame(Vh[["fb2", "dn"]])).values
    return Vh.assign(pw=w).groupby(K).pw.sum().reindex(pd.MultiIndex.from_frame(T[K])).fillna(0).values

def fit_pred_phys(tr, te, phys):
    """MODIS = phys_sum * f[dn, moy]; f absorbs Terra, unmatched Aqua, overpass offsets."""
    trp, tep = phys[tr.index], phys[te.index]
    g = tr.assign(b=trp).groupby(["dn", "moy"])[["m", "b"]].sum(); f = g.m / g.b
    base_te = tep * f.reindex(pd.MultiIndex.from_frame(te[["dn", "moy"]])).values
    base_tr = trp * f.reindex(pd.MultiIndex.from_frame(tr[["dn", "moy"]])).values
    return base_tr, base_te

def evaluate(T_, h, label):
    t = T_.assign(h=h)
    cty = t.groupby("ym")[["m", "h"]].sum(); cel = t.groupby(["ym", "cell1"])[["m", "h"]].sum()
    r = {"method": label}
    r.update({f"cty_{a}": b for a, b in metr(cty.m, cty.h).items()})
    r.update({f"cell_{a}": b for a, b in metr(cel.m, cel.h).items() if a in ("MdAPE", "RMSLE", "R2")})
    r.update(rank_metric(cty) if len(cty) >= 24 else {})
    return r, cty

# ---------------- R1 + R2 under LOYO ----------------
years = sorted(T.year.unique())
H = {k: pd.Series(np.nan, index=T.index) for k in ("ratio+local", "GBM", "phys+moy", "phys+moy+local", "ens(GBM,ratio+local)")}
for yr in years:
    tr, te = T[T.year != yr], T[T.year == yr]
    phys = pd.Series(physics_feature([y for y in years if y != yr]), index=T.index)
    btr, bte = fit_pred_phys(tr, te, phys)
    H["phys+moy"].loc[te.index] = bte
    H["phys+moy+local"].loc[te.index] = local_adj(tr, te, btr, bte)
    rl = m_ratio_local(tr, te); gb = m_gbm(tr, te)
    H["ratio+local"].loc[te.index] = rl; H["GBM"].loc[te.index] = gb
    H["ens(GBM,ratio+local)"].loc[te.index] = (rl + gb) / 2
rows, store = [], {}
for k, h in H.items():
    r, cty = evaluate(T, h.values, k); rows.append(r); store[k] = cty
print("R1/R2 LOYO:\n", pd.DataFrame(rows).to_string(index=False))

# ---------------- R3 forward-in-time ----------------
tr, te = T[T.year <= 2017], T[T.year >= 2018]
phys = pd.Series(physics_feature(list(range(2012, 2018))), index=T.index)
btr, bte = fit_pred_phys(tr, te, phys)
fw = {"ratio[dn,moy]": m_ratio(tr, te), "ratio+local": m_ratio_local(tr, te), "GBM": m_gbm(tr, te),
      "phys+moy+local": local_adj(tr, te, btr, bte)}
fw["ens(GBM,ratio+local)"] = (fw["GBM"] + fw["ratio+local"]) / 2
print("\nR3 forward: train 2012-2017, test 2018-2022-09:")
print(pd.DataFrame([evaluate(te, h, k)[0] for k, h in fw.items()]).to_string(index=False))

# ---------------- R4 NOAA-20 transfer ----------------
v20 = V20.groupby(K).agg(v=("frp", "size"), vfrp=("frp", "sum"), vfrp_med=("frp", "median"),
                         vhigh=("conf", lambda s: (s == "h").mean()))
vb20 = V20.groupby(K + ["fb"]).size().unstack("fb").reindex(columns=BL).fillna(0)
m20 = M[M.date >= "2018-04-01"].groupby(K).agg(m=("frp", "size"), mfrp=("frp", "sum"))
T20 = pd.concat([m20, v20, vb20], axis=1).fillna(0).reset_index()
T20["lat"] = T20.cell1.str.split("_").str[0].astype(int); T20["lon"] = T20.cell1.str.split("_").str[1].astype(int)
tr = T[T.year <= 2017]
print("\nR4 NOAA-20 transfer (fit on S-NPP 2012-2017, inputs = NOAA-20 2018-04..2022-09, no factor):")
print(pd.DataFrame([evaluate(T20, m_ratio_local(tr, T20), "ratio+local")[0],
                    evaluate(T20, m_gbm(tr, T20), "GBM")[0]]).to_string(index=False))
print("  NOAA-20 vs S-NPP median FRP (day):", V20[V20.dn == "D"].frp.median(), V[(V.dn == "D") & (V.date >= "2018-04-01")].frp.median())

# ---------------- R5 interval coverage, pooled residuals ----------------
for k in ("ratio+local", "GBM", "ens(GBM,ratio+local)"):
    e = store[k].reset_index(); e["year"] = e.ym.dt.year
    e["lr"] = np.log1p(e.m) - np.log1p(e.h)
    for scheme in ("per-moy", "pooled"):
        cov, wid = [], []
        for yr in e.year.unique():
            o, t = e[e.year != yr], e[e.year == yr]
            if scheme == "pooled":
                lo, hi = o.lr.quantile(0.1), o.lr.quantile(0.9); lo = np.full(len(t), lo); hi = np.full(len(t), hi)
            else:
                q = o.assign(moy=o.ym.dt.month).groupby("moy").lr.quantile([0.1, 0.9]).unstack()
                lo = q.reindex(t.ym.dt.month)[0.1].values; hi = q.reindex(t.ym.dt.month)[0.9].values
            cov += list((t.lr.values >= lo) & (t.lr.values <= hi)); wid += list(np.expm1(hi) - np.expm1(lo))
        print(f"R5 80% interval {k:22s} {scheme:8s}: coverage={np.mean(cov):.2f} rel.width={np.mean(wid):.2f}")
