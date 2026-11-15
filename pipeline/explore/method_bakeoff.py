"""Head-to-head comparison of MODIS<->VIIRS harmonization methods on Pakistan data.

Target: MODIS (Terra+Aqua, MCD14ML-style) monthly counts, i.e. "MODIS-equivalent".
Predictor: S-NPP VIIRS (and N20 for a transfer test).
Window: 2012-01 .. 2022-09 (before measurable orbit drift, see drift_check.py).
Validation: leave-one-year-out (LOYO) over 2012..2022 (2022 = Jan..Sep).
Scales: country x month, and 1-degree cell x month (proxy for a user-drawn AOI).

Filters (same both sides): type==0, MODIS conf>=30, VIIRS conf in {n,h}.
Excluded no-data windows: S-NPP 2022-07-27..2022-08-10 (official), Aqua FMU 2020-08-16..09-02 (partial).
"""
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
p = pd.read_pickle(ROOT / "data/explore/points.pkl")

# ---------- filter ----------
p = p[p.type == 0]
is_m = p.sensor == "MODIS"
mconf = pd.to_numeric(p.conf.where(is_m), errors="coerce")
p = p[(is_m & (mconf >= 30)) | (~is_m & p.conf.isin(["n", "h"]))]
p = p[(p.date >= "2012-01-20") & (p.date < "2022-10-01")]
bad = ((p.date >= "2022-07-27") & (p.date <= "2022-08-10")) | ((p.date >= "2020-08-16") & (p.date <= "2020-09-02"))
p = p[~bad].copy()
p["ym"] = p.date.dt.to_period("M")
p["moy"] = p.date.dt.month
p["year"] = p.date.dt.year
p["cell1"] = (np.floor(p.lat).astype(int)).astype(str) + "_" + (np.floor(p.lon).astype(int)).astype(str)
# ~1 km snap: unique 0.01 deg cell per satellite-day-daynight ("cells" instead of points)
p["k1km"] = (np.floor(p.lat * 100).astype(int)).astype(str) + "_" + (np.floor(p.lon * 100).astype(int)).astype(str)

M = p[p.sensor == "MODIS"]
V = p[p.sat == "N"]          # S-NPP
V20 = p[p.sat == "N20"]

def counts(df, unit, keys):
    if unit == "pts":
        return df.groupby(keys).size()
    # cells: dedupe per sat/day/dn/1km cell
    d = df.drop_duplicates(["sat", "date", "dn", "k1km"])
    return d.groupby(keys).size()

def frame(scale, unit):
    keys = ["ym", "moy", "year", "dn"] + (["cell1"] if scale == "cell" else [])
    m = counts(M, unit, keys).rename("m")
    v = counts(V, unit, keys).rename("v")
    f = pd.concat([m, v], axis=1).fillna(0).reset_index()
    return f

def metrics(y, yhat, label):
    y = np.asarray(y, float); yhat = np.asarray(yhat, float)
    tot = y.sum()
    bias = (yhat.sum() - tot) / tot * 100
    big = y >= 20
    ape = np.abs(yhat[big] - y[big]) / y[big] * 100
    le = np.log1p(yhat) - np.log1p(y)
    r2 = 1 - ((y - yhat) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    return dict(method=label, n=len(y), bias_pct=round(bias, 1), MdAPE_y20=round(np.median(ape), 1),
                RMSLE=round(np.sqrt((le ** 2).mean()), 3), R2=round(r2, 3))

def loyo(f, fit_predict):
    preds = []
    for yr in sorted(f.year.unique()):
        tr, te = f[f.year != yr], f[f.year == yr]
        preds.append(pd.Series(fit_predict(tr, te), index=te.index))
    return pd.concat(preds).reindex(f.index)

# ---------- methods (each returns MODIS-equivalent per row of te) ----------
def ratio_global(tr, te):
    return te.v * tr.m.sum() / tr.v.sum()

def ratio_dn(tr, te):
    r = tr.groupby("dn").m.sum() / tr.groupby("dn").v.sum()
    return te.v * te.dn.map(r)

def ratio_dn_moy(tr, te, k=0):
    """ratio per (day/night, month-of-year); k>0 shrinks toward the dn ratio (pseudo-counts in VIIRS units)."""
    rdn = tr.groupby("dn").m.sum() / tr.groupby("dn").v.sum()
    g = tr.groupby(["dn", "moy"])[["m", "v"]].sum()
    prior = g.index.get_level_values(0).map(rdn).values
    r = (g.m + k * prior) / (g.v + k)
    idx = pd.MultiIndex.from_frame(te[["dn", "moy"]])
    return te.v.values * r.reindex(idx).fillna(pd.Series(te.dn.map(rdn).values, index=idx)).values

def powerlaw_dn(tr, te):
    out = np.zeros(len(te))
    for dn in ("D", "N"):
        t = tr[(tr.dn == dn) & (tr.m > 0) & (tr.v > 0)]
        b, a = np.polyfit(np.log(t.v), np.log(t.m), 1)
        # smearing correction for log-retransform bias
        res = np.log(t.m) - (a + b * np.log(t.v))
        smear = np.exp(res).mean()
        mask = (te.dn == dn).values
        out[mask] = np.exp(a) * smear * np.power(te.v.values[mask], b)
    return out

def spatial_ratio(tr, te, k=200):
    """ratio per (1deg cell, dn, season) shrunk toward (dn, moy) ratio. Only for cell scale."""
    te = te.copy(); tr = tr.copy()
    for d in (tr, te):
        d["sea"] = d.moy.map(lambda x: {12: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3}[x])
    base_tr = ratio_dn_moy(tr, tr, k=0)
    base_te = ratio_dn_moy(tr, te, k=0)
    tr["base"] = base_tr; te["base"] = base_te
    g = tr.groupby(["cell1", "dn", "sea"])[["m", "base"]].sum()
    gv = tr.groupby(["cell1", "dn", "sea"]).v.sum()
    # multiplicative local adjustment on top of base: adj = (m + k*1)/(base + k) in MODIS units
    adj = (g.m + k) / (g.base + k)
    idx = pd.MultiIndex.from_frame(te[["cell1", "dn", "sea"]])
    return te.base.values * adj.reindex(idx).fillna(1.0).values

results = []
for unit in ("pts", "cells"):
    for scale in ("country", "cell"):
        f = frame(scale, unit)
        if scale == "country":
            f = f.groupby(["ym", "moy", "year", "dn"])[["m", "v"]].sum().reset_index()
        meths = {"ratio_global": ratio_global, "ratio_dn": ratio_dn, "ratio_dn_moy": ratio_dn_moy,
                 "ratio_dn_moy_shrunk": lambda a, b: ratio_dn_moy(a, b, k=50)}
        if scale == "country":
            meths["powerlaw_dn (plan v1)"] = powerlaw_dn
        else:
            meths["powerlaw_dn applied per cell"] = powerlaw_dn
            meths["spatial_ratio(cell,dn,season)"] = spatial_ratio
        for name, fn in meths.items():
            yhat = loyo(f, fn)
            # evaluate on D+N combined (what the user sees)
            keys = ["ym"] + (["cell1"] if scale == "cell" else [])
            ev = f.assign(h=yhat).groupby(keys)[["m", "h"]].sum()
            r = metrics(ev.m, ev.h, name); r.update(unit=unit, scale=scale)
            results.append(r)

res = pd.DataFrame(results)[["scale", "unit", "method", "n", "bias_pct", "MdAPE_y20", "RMSLE", "R2"]]
pd.set_option("display.width", 200)
print(res.to_string(index=False))

# ---------- ratio stability diagnostics ----------
for unit in ("pts", "cells"):
    f = frame("country", unit).groupby(["ym", "moy", "year", "dn"])[["m", "v"]].sum().reset_index()
    a = f.groupby(["year", "dn"])[["m", "v"]].sum()
    print(f"\n[{unit}] yearly V/M ratio by dn:\n", (a.v / a.m).unstack().round(2).T.to_string())
    b = f.groupby(["moy", "dn"])[["m", "v"]].sum()
    print(f"[{unit}] month-of-year V/M ratio:\n", (b.v / b.m).unstack().round(2).T.to_string())

# ---------- N20 transfer: does the S-NPP-fitted model work on NOAA-20? (2018-04..2022-09) ----------
for unit in ("pts", "cells"):
    keys = ["ym", "moy", "year", "dn"]
    f = pd.concat([counts(M, unit, keys).rename("m"), counts(V, unit, keys).rename("v"),
                   counts(V20, unit, keys).rename("v20")], axis=1).fillna(0).reset_index()
    tr = f[f.year < 2018]
    te = f[(f.ym >= pd.Period("2018-04", "M"))].copy()
    h_snpp = ratio_dn_moy(tr, te)
    h_n20 = ratio_dn_moy(tr, te.assign(v=te.v20))
    ev = te.assign(hs=h_snpp, h20=h_n20).groupby("ym")[["m", "hs", "h20"]].sum()
    print(f"\n[{unit}] fit 2012-2017 on S-NPP, test 2018-04..2022-09:")
    print(" S-NPP input:", metrics(ev.m, ev.hs, "snpp"))
    print(" N20 input  :", metrics(ev.m, ev.h20, "n20"))
    print(" N20/SNPP total ratio:", round(te.v20.sum() / te.v.sum(), 3))
