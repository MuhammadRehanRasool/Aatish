"""Round 2: can we beat ratio[dn, month-of-year] (+ local adjustment)?

E1  physics weight: per-point weight by (dn, VIIRS FRP bin), fitted by NNLS on monthly counts,
    alone and combined with a month-of-year correction.
E2  matched detection probability: same-day S-NPP vs Aqua (both ~13:10 LST), P(Aqua pixel within
    1.5 km | VIIRS FRP, dn). Diagnostic + science-panel curve.
E3  Poisson gradient boosting at 1-deg cell-month, redistributed to points (stays additive).
E4  anomaly-rank metric: Spearman of within-calendar-month year ranks (what the app shows).
E5  FRP-sum harmonization: is the MODIS/VIIRS FRP ratio more stable than the count ratio?
E6  conformal-style 80% intervals from LOYO residuals; empirical coverage on held-out years.

LOYO over 2012..2022(Jan-Sep). Same filters as method_bakeoff.py.
"""
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import nnls
from scipy.spatial import cKDTree
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[2]
pd.set_option("display.width", 220)
p = pd.read_pickle(ROOT / "data/explore/points.pkl")
p = p[p.type == 0]
is_m = p.sensor == "MODIS"
mconf = pd.to_numeric(p.conf.where(is_m), errors="coerce")
p = p[(is_m & (mconf >= 30)) | (~is_m & p.conf.isin(["n", "h"]))]
p = p[(p.date >= "2012-01-20") & (p.date < "2022-10-01")]
bad = ((p.date >= "2022-07-27") & (p.date <= "2022-08-10")) | ((p.date >= "2020-08-16") & (p.date <= "2020-09-02"))
p = p[~bad].copy()
p["ym"] = p.date.dt.to_period("M"); p["moy"] = p.date.dt.month; p["year"] = p.date.dt.year
p["cell1"] = np.floor(p.lat).astype(int).astype(str) + "_" + np.floor(p.lon).astype(int).astype(str)
BINS = [0, 2, 4, 8, 16, 1e9]
BL = ["f0_2", "f2_4", "f4_8", "f8_16", "f16p"]
p["fb"] = pd.cut(p.frp, BINS, labels=BL, right=False).astype(str)
M = p[p.sensor == "MODIS"]; V = p[p.sat == "N"]

# ---------------- base table: cell x month x dn with VIIRS FRP-bin counts ----------------
K = ["cell1", "ym", "moy", "year", "dn"]
m = M.groupby(K).agg(m=("frp", "size"), mfrp=("frp", "sum"))
v = V.groupby(K).agg(v=("frp", "size"), vfrp=("frp", "sum"), vfrp_med=("frp", "median"),
                     vhigh=("conf", lambda s: (s == "h").mean()))
vb = V.groupby(K + ["fb"]).size().unstack("fb").reindex(columns=BL).fillna(0)
T = pd.concat([m, v, vb], axis=1).fillna(0).reset_index()
T["lat"] = T.cell1.str.split("_").str[0].astype(int); T["lon"] = T.cell1.str.split("_").str[1].astype(int)
print("rows", len(T), " MODIS-only rows (v==0, m>0):", int(((T.v == 0) & (T.m > 0)).sum()),
      " their MODIS share:", round(T.m[(T.v == 0)].sum() / T.m.sum(), 4))

def metr(y, h):
    y = np.asarray(y, float); h = np.asarray(h, float)
    big = y >= 20
    le = np.log1p(h) - np.log1p(y)
    return dict(bias=round((h.sum() / y.sum() - 1) * 100, 1),
                MdAPE=round(np.median(np.abs(h[big] - y[big]) / y[big] * 100), 1),
                RMSLE=round(np.sqrt((le ** 2).mean()), 3),
                R2=round(1 - ((y - h) ** 2).sum() / ((y - y.mean()) ** 2).sum(), 3))

def rank_metric(ev):
    """ev: index ym, cols m,h (country). Spearman of year ranks within each calendar month, averaged."""
    e = ev.reset_index(); e["moy"] = e.ym.dt.month
    rs = [spearmanr(g.m, g.h).statistic for _, g in e.groupby("moy") if len(g) >= 5]
    # also: percentile-rank absolute error (pp)
    e["pr_m"] = e.groupby("moy").m.rank(pct=True); e["pr_h"] = e.groupby("moy").h.rank(pct=True)
    return dict(rank_rho=round(np.mean(rs), 3), pctl_err_pp=round((e.pr_m - e.pr_h).abs().mean() * 100, 1))

# ---------------- methods: fit(tr) -> predict(te) at cell-month-dn rows ----------------
def m_ratio(tr, te):
    g = tr.groupby(["dn", "moy"])[["m", "v"]].sum(); r = g.m / g.v
    return te.v.values * r.reindex(pd.MultiIndex.from_frame(te[["dn", "moy"]])).values

def local_adj(tr, te, base_tr, base_te, k=200):
    sea = lambda x: {12: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3}[x]
    a = tr.assign(b=base_tr, s=tr.moy.map(sea)).groupby(["cell1", "dn", "s"])[["m", "b"]].sum()
    adj = (a.m + k) / (a.b + k)
    idx = pd.MultiIndex.from_frame(te.assign(s=te.moy.map(sea))[["cell1", "dn", "s"]])
    return base_te * adj.reindex(idx).fillna(1.0).values

def m_ratio_local(tr, te):
    return local_adj(tr, te, m_ratio(tr, tr), m_ratio(tr, te))

def frp_weights(tr):
    w = {}
    for dn in ("D", "N"):
        c = tr[tr.dn == dn].groupby("ym")[BL + ["m"]].sum()
        w[dn], _ = nnls(c[BL].values.astype(float), c.m.values.astype(float))
    return w

def m_frp(tr, te):
    w = frp_weights(tr); out = np.zeros(len(te))
    for dn in ("D", "N"):
        k = (te.dn == dn).values; out[k] = te.loc[k, BL].values @ w[dn]
    return out

def m_frp_moy(tr, te):
    """FRP-bin weights, then a month-of-year multiplicative correction on the residual ratio."""
    base_tr, base_te = m_frp(tr, tr), m_frp(tr, te)
    g = tr.assign(b=base_tr).groupby(["dn", "moy"])[["m", "b"]].sum(); r = g.m / g.b
    return base_te * r.reindex(pd.MultiIndex.from_frame(te[["dn", "moy"]])).fillna(1).values

def m_frp_moy_local(tr, te):
    return local_adj(tr, te, m_frp_moy(tr, tr), m_frp_moy(tr, te))

FEATS = ["v", "vfrp", "vfrp_med", "vhigh", "moy", "lat", "lon", "isday"] + BL
def m_gbm(tr, te):
    X = lambda d: d.assign(isday=(d.dn == "D").astype(int))[FEATS].values
    g = HistGradientBoostingRegressor(loss="poisson", max_iter=300, learning_rate=0.05,
                                      max_leaf_nodes=15, min_samples_leaf=40, random_state=0)
    g.fit(X(tr), tr.m.values)
    return g.predict(X(te))

METHODS = {"ratio[dn,moy] (current)": m_ratio, "ratio + local (current best)": m_ratio_local,
           "E1 FRP-bin NNLS": m_frp, "E1 FRP-bin + moy": m_frp_moy, "E1 FRP-bin + moy + local": m_frp_moy_local,
           "E3 Poisson GBM": m_gbm}

preds = {k: pd.Series(np.nan, index=T.index) for k in METHODS}
for yr in sorted(T.year.unique()):
    tr, te = T[T.year != yr], T[T.year == yr]
    for k, fn in METHODS.items():
        preds[k].loc[te.index] = fn(tr, te)

rows = []
resid_store = {}
for k in METHODS:
    t = T.assign(h=preds[k].values)
    cty = t.groupby("ym")[["m", "h"]].sum()
    cel = t.groupby(["ym", "cell1"])[["m", "h"]].sum()
    r = {"method": k}
    r.update({f"cty_{a}": b for a, b in metr(cty.m, cty.h).items()})
    r.update({f"cell_{a}": b for a, b in metr(cel.m, cel.h).items() if a in ("MdAPE", "RMSLE", "R2")})
    r.update(rank_metric(cty))
    rows.append(r); resid_store[k] = cty
print("\nE1/E3/E4 leave-one-year-out (country-month and 1deg-cell-month):")
print(pd.DataFrame(rows).to_string(index=False))

w = frp_weights(T)
print("\nE1 fitted MODIS-eq weight per VIIRS detection, by FRP bin (all years):")
print(pd.DataFrame(w, index=BL).round(3).T.to_string())

# ---------------- E2 matched detection probability (S-NPP vs Aqua, same day & dn) ----------------
A = M[M.sat == "Aqua"]
A_idx = A.set_index(["date", "dn"]).sort_index()
matched = pd.Series(False, index=V.index)
coslat = np.cos(np.deg2rad(30))
for (d, dn), vv in V.groupby(["date", "dn"]):
    try:
        aa = A_idx.loc[(d, dn)]
    except KeyError:
        continue
    if isinstance(aa, pd.Series): aa = aa.to_frame().T
    tree = cKDTree(np.c_[aa.lat.values.astype(float) * 111.0, aa.lon.values.astype(float) * 111.0 * coslat])
    dist, _ = tree.query(np.c_[vv.lat.values * 111.0, vv.lon.values * 111.0 * coslat], k=1)
    matched.loc[vv.index] = dist <= 1.5
V2 = V.assign(hit=matched)
V2["fb2"] = pd.cut(V2.frp, [0, 1, 2, 4, 8, 16, 32, 64, 1e9], right=False)
print("\nE2 P(Aqua detects within 1.5 km, same day) for S-NPP detections, by FRP (MW):")
print(V2.groupby(["fb2", "dn"], observed=True).hit.agg(["mean", "size"]).unstack("dn").round(3).to_string())
print("By month-of-year (day):", V2[V2.dn == "D"].groupby("moy").hit.mean().round(3).to_dict())
print("Share of S-NPP detections with FRP<4 MW, by month (day):",
      V2[V2.dn == "D"].groupby("moy").frp.apply(lambda s: (s < 4).mean()).round(2).to_dict())

# ---------------- E5 FRP-sum harmonization ----------------
print("\nE5 FRP-sum vs count: LOYO with ratio[dn,moy] applied to FRP sums (country-month):")
C = T.groupby(["ym", "moy", "year", "dn"])[["m", "v", "mfrp", "vfrp"]].sum().reset_index()
out = {}
for tgt, src in (("m", "v"), ("mfrp", "vfrp")):
    h = pd.Series(np.nan, index=C.index)
    for yr in sorted(C.year.unique()):
        tr, te = C[C.year != yr], C[C.year == yr]
        g = tr.groupby(["dn", "moy"])[[tgt, src]].sum(); r = g[tgt] / g[src]
        h.loc[te.index] = te[src].values * r.reindex(pd.MultiIndex.from_frame(te[["dn", "moy"]])).values
    ev = C.assign(h=h).groupby("ym")[[tgt, "h"]].sum()
    yy, hh = ev[tgt].values, ev.h.values
    le = np.log1p(hh) - np.log1p(yy)
    big = yy >= np.quantile(yy, 0.2)
    out[tgt] = dict(MdAPE=round(np.median(np.abs(hh[big] - yy[big]) / yy[big] * 100), 1),
                    RMSLE=round(np.sqrt((le ** 2).mean()), 3))
print(" counts:", out["m"], "   FRP sums:", out["mfrp"])
cc = C.groupby(["ym", "moy"])[["m", "v", "mfrp", "vfrp"]].sum()
cv = lambda s: (s.groupby(level="moy").std() / s.groupby(level="moy").mean()).mean()
print(" mean within-moy CV of monthly ratio  count:", round(cv(cc.m / cc.v), 3),
      " FRP:", round(cv(cc.mfrp / cc.vfrp), 3), "  overall FRP ratio M/V:", round(cc.mfrp.sum() / cc.vfrp.sum(), 3))

# ---------------- E6 interval coverage (nested: residual quantiles from other years) ----------------
best = "ratio + local (current best)"
for k in ("ratio[dn,moy] (current)", best, "E1 FRP-bin + moy + local"):
    e = resid_store[k].reset_index(); e["moy"] = e.ym.dt.month; e["year"] = e.ym.dt.year
    e["lr"] = np.log1p(e.m) - np.log1p(e.h)
    cov = []; width = []
    for yr in e.year.unique():
        o = e[e.year != yr]; t = e[e.year == yr]
        q = o.groupby("moy").lr.quantile([0.1, 0.9]).unstack()
        lo = q.reindex(t.moy)[0.1].values; hi = q.reindex(t.moy)[0.9].values
        cov += list((t.lr.values >= lo) & (t.lr.values <= hi)); width += list(np.expm1(hi) - np.expm1(lo))
    print(f"E6 80% interval [{k}]: coverage={np.mean(cov):.2f}, mean relative width={np.mean(width):.2f}")
