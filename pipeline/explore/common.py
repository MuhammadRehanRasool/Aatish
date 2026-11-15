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
M = p[p.sensor == "MODIS"]; V = p[p.sat == "N"]; V20 = p[p.sat == "N20"]

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

