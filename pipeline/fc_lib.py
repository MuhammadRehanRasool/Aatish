"""Shared FireCalendar pipeline logic (used by build_harmonized.py and validate.py).

The method is documented in docs/plan.md §3 and the evidence in docs/harmonization-research.md.
This module ports the validated exploration logic (pipeline/explore/common.py, method_bakeoff3/4.py)
into reusable functions. Nothing here reads anything outside the project folder.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw_data"
DATA = ROOT / "data"

SENSOR_DIRS = {"modis": "MODIS", "viirs-snpp": "SNPP", "viirs-jpss1": "N20", "viirs-jpss2": "N21"}
VIIRS_SATS = ["N", "N20", "N21"]  # FIRMS `satellite` codes: S-NPP, NOAA-20, NOAA-21

# ---- decided constants (plan.md §3) ----
FIT_START, FIT_END = pd.Timestamp("2012-01-20"), pd.Timestamp("2022-09-30")
AQUA_START = pd.Timestamp("2002-07-06")      # first Aqua row in our data -> Terra-only before
DERIVED_START = pd.Timestamp("2022-10-01")   # VIIRS-derived series from here on
EXCLUDED_WINDOWS = [  # (label, sat or None=all, start, end): removed from calibration pairs
    ("S-NPP outage (VIIRS C2 BA guide v1.1 §6)", "N", "2022-07-27", "2022-08-10"),
    ("Aqua FMU outage (MODIS C6.1 guide §7.2.4)", "Aqua", "2020-08-16", "2020-09-02"),
]
FRP_BINS = [0, 1, 2, 4, 8, 16, 32, np.inf]
FRP_LABELS = ["<1", "1-2", "2-4", "4-8", "8-16", "16-32", ">=32"]
K_SHRINK = 200
MATCH_RADIUS_KM = 1.5
MODIS_CONF_MIN = 30
VIIRS_CONF_OK = ("n", "h")
STATIC_VIIRS_MIN = 6       # ">5 type!=0 detections" per 0.01 deg cell in VIIRS SP history
STATIC_MODIS_FROM = pd.Timestamp("2018-01-01")
SEASON = {12: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3}
TERRA_FACTOR_YEARS = (2003, 2021)


# ----------------------------------------------------------------------------- loading
def load_raw() -> pd.DataFrame:
    """All raw FIRMS CSVs -> one table. Read-only on raw_data/. Row order is deterministic."""
    frames = []
    for d, sensor in SENSOR_DIRS.items():
        for f in sorted((RAW / d).glob("*.csv")):
            df = pd.read_csv(f, dtype={"acq_time": str, "confidence": str, "satellite": str,
                                       "version": str, "daynight": str})
            frames.append(pd.DataFrame({
                "sensor": sensor,
                "satellite": df["satellite"].astype(str),
                "quality": "NRT" if f.stem.endswith("_NRT") else "SP",
                "version": df["version"].astype(str),
                "src_file": f.name,
                "date": pd.to_datetime(df["acq_date"]),
                "acq_time": df["acq_time"].astype(int),          # gotcha 4: padding differs
                "lat": df["latitude"].astype(float),
                "lon": df["longitude"].astype(float),
                "daynight": df["daynight"].astype(str),
                "conf": df["confidence"].astype(str),
                "type": pd.to_numeric(df["type"], errors="coerce") if "type" in df.columns else np.nan,
                "frp": df["frp"].astype(float),
                "scan": df["scan"].astype(float),
                "track": df["track"].astype(float),
            }))
    p = pd.concat(frames, ignore_index=True)
    p["type"] = p["type"].astype("float64")
    p = p.sort_values(["date", "acq_time", "sensor", "satellite", "lat", "lon", "frp"], kind="mergesort")
    return p.reset_index(drop=True)


def add_keys(p: pd.DataFrame) -> pd.DataFrame:
    p["year"] = p.date.dt.year.astype("int16")
    p["moy"] = p.date.dt.month.astype("int8")
    p["ym"] = p.date.dt.to_period("M")
    p["season"] = p.moy.map(SEASON).astype("int8")
    p["cell1"] = (np.floor(p.lat).astype(int).astype(str) + "_" + np.floor(p.lon).astype(int).astype(str))
    p["fbin"] = pd.cut(p.frp, FRP_BINS, right=False, labels=False).astype("int8")
    return p


def fit_frp_scale(p: pd.DataFrame, act: pd.DataFrame, usable: pd.Series) -> tuple[float, dict]:
    """NOAA-21 -> NOAA-20 FRP scale. NOAA's JPSS NOAA-21 readme (2023-06-01) documents a positive FRP
    bias (M13 spectral response shift). Estimated as the geometric mean of N21/N20 FRP quantile ratios
    (q10..q90, day and night) on SP sat-days where both are active (self-audit S5, research doc §7)."""
    key = pd.MultiIndex.from_arrays([p.date, p.daynight])
    both = (act["N20"] & act["N21"]).reindex(key, fill_value=False).astype(bool).values
    sp = (usable & (p.quality == "SP")).values & both
    qs = np.round(np.arange(.1, .91, .1), 2)
    logs, diag = [], {}
    for dn in ("D", "N"):
        a = p.frp[sp & (p.satellite == "N21").values & (p.daynight == dn).values]
        b = p.frp[sp & (p.satellite == "N20").values & (p.daynight == dn).values]
        r = a.quantile(qs).values / b.quantile(qs).values
        logs += list(np.log(r))
        diag[dn] = {"n_N21": int(len(a)), "n_N20": int(len(b)),
                    "quantile_ratios": {f"q{int(q * 100)}": round(float(x), 4) for q, x in zip(qs, r)}}
    return float(np.exp(np.mean(logs))), diag


def apply_frp_scale(p: pd.DataFrame, scale: dict) -> pd.DataFrame:
    """Recompute FRP bins on satellite-equivalent FRP (frp / scale[satellite]; 1 if not listed)."""
    s = p.satellite.map(scale).astype(float).fillna(1.0).values
    p["fbin"] = pd.cut(p.frp.values / s, FRP_BINS, right=False, labels=False).astype("int8")
    return p


def conf_ok(p: pd.DataFrame) -> pd.Series:
    is_m = p.sensor == "MODIS"
    mconf = pd.to_numeric(p.conf.where(is_m), errors="coerce")
    return (is_m & (mconf >= MODIS_CONF_MIN)) | (~is_m & p.conf.isin(VIIRS_CONF_OK))


# ----------------------------------------------------------------------------- static mask
def cell001(lat, lon):
    return np.floor(np.asarray(lat) * 100).astype(np.int64) * 100000 + np.floor(np.asarray(lon) * 100).astype(np.int64)


def static_mask(p: pd.DataFrame) -> tuple[pd.Series, dict]:
    """One location mask for all sensors/years/SP+NRT (plan §3 step 0, DATA_NOTES gotcha 1).
    0.01 deg cells with >5 type!=0 detections in VIIRS SP history, plus 0.01 deg cells with
    any MODIS type!=0 detection from 2018 on (no buffer)."""
    c = pd.Series(cell001(p.lat, p.lon), index=p.index)
    typed = p.type.notna() & (p.type != 0) & (p.quality == "SP")
    v = typed & (p.sensor != "MODIS")
    vc = c[v].value_counts()
    v_cells = set(vc[vc >= STATIC_VIIRS_MIN].index)
    m_cells = set(c[typed & (p.sensor == "MODIS") & (p.date >= STATIC_MODIS_FROM)].unique())
    cells = v_cells | m_cells
    flag = c.isin(cells)
    info = {"viirs_cells": len(v_cells), "modis_cells": len(m_cells), "union_cells": len(cells),
            "typed_nonzero_outside_mask": int((p.type.notna() & (p.type != 0) & ~flag).sum())}
    return flag, info


# ----------------------------------------------------------------------------- no-data days
def detect_no_data(p: pd.DataFrame, ref_min: int) -> pd.DataFrame:
    """VIIRS (sat, date, daynight) with zero detections while another VIIRS satellite has
    >= ref_min detections in the same date+daynight (DATA_NOTES gotcha 2 rule). Only within each
    satellite's data range (first..last date in raw_data)."""
    cnt = p[p.sensor != "MODIS"].groupby(["satellite", "date", "daynight"]).size().unstack("satellite").reindex(columns=VIIRS_SATS)
    rng = p[p.sensor != "MODIS"].groupby("satellite").date.agg(["min", "max"])
    days = pd.date_range(rng["min"].min(), rng["max"].max(), freq="D")
    idx = pd.MultiIndex.from_product([days, ["D", "N"]], names=["date", "daynight"])
    cnt = cnt.reindex(idx).fillna(0)
    out = []
    for s in VIIRS_SATS:
        d = cnt.index.get_level_values("date")
        inrange = (d >= rng.loc[s, "min"]) & (d <= rng.loc[s, "max"])
        others = cnt.drop(columns=s).max(axis=1)
        hit = inrange & (cnt[s] == 0) & (others >= ref_min)
        sub = cnt[hit]
        out.append(pd.DataFrame({"satellite": s, "date": sub.index.get_level_values("date"),
                                 "daynight": sub.index.get_level_values("daynight"),
                                 "ref_max_other": sub.drop(columns=s).max(axis=1).astype(int).values}))
    return pd.concat(out, ignore_index=True)


def active_table(p: pd.DataFrame, nd: pd.DataFrame) -> pd.DataFrame:
    """Per (date, daynight): which VIIRS sats are active (in data range, not flagged no-data)."""
    v = p[p.sensor != "MODIS"]
    rng = v.groupby("satellite").date.agg(["min", "max"])
    days = pd.date_range(rng["min"].min(), rng["max"].max(), freq="D")
    idx = pd.MultiIndex.from_product([days, ["D", "N"]], names=["date", "daynight"])
    a = pd.DataFrame(index=idx)
    d = idx.get_level_values("date")
    ndk = set(zip(nd.satellite, nd.date, nd.daynight))
    for s in VIIRS_SATS:
        inr = (d >= rng.loc[s, "min"]) & (d <= rng.loc[s, "max"])
        flagged = np.array([(s, x, y) in ndk for x, y in idx])
        a[s] = inr & ~flagged
    a["n_active"] = a[VIIRS_SATS].sum(axis=1)
    return a


# ----------------------------------------------------------------------------- matching
def nearest_aqua_km(p: pd.DataFrame, ok: pd.Series) -> pd.Series:
    """For each usable VIIRS point: distance (km) to the nearest usable Aqua detection on the same
    date and daynight; NaN if Aqua has none. Local equirectangular projection at each point's lat."""
    out = pd.Series(np.nan, index=p.index)
    A = p[ok & (p.satellite == "Aqua")]
    V = p[ok & p.satellite.isin(VIIRS_SATS)]
    agrp = {k: g for k, g in A.groupby(["date", "daynight"])}
    for k, vv in V.groupby(["date", "daynight"]):
        aa = agrp.get(k)
        if aa is None:
            continue
        lat0 = np.deg2rad(np.r_[aa.lat.values, vv.lat.values].mean())
        xy = lambda d: np.c_[d.lat.values * 111.195, d.lon.values * 111.195 * np.cos(lat0)]
        dist, _ = cKDTree(xy(aa)).query(xy(vv), k=1)
        out.loc[vv.index] = dist
    return out


# ----------------------------------------------------------------------------- calibration
def fit_model(F: pd.DataFrame, radius_km: float = MATCH_RADIUS_KM, k: float = K_SHRINK) -> dict:
    """Fit P_aqua[fbin, dn], f[dn, moy], L[cell1, dn, season] on fit-set points F
    (already filtered, fit window, excluded windows removed). Reference input = S-NPP points."""
    V = F[F.satellite == "N"]
    M = F[F.sensor == "MODIS"]
    hit = (V.d_aqua_km <= radius_km)
    P = hit.groupby([V.fbin, V.daynight]).mean()
    b = P.reindex(pd.MultiIndex.from_arrays([V.fbin, V.daynight])).values
    gb = pd.Series(b, index=V.index).groupby([V.daynight, V.moy]).sum()
    gm = M.groupby(["daynight", "moy"]).size()
    f = (gm / gb).rename("f")
    bf = b * f.reindex(pd.MultiIndex.from_arrays([V.daynight, V.moy])).values
    sb = pd.Series(bf, index=V.index).groupby([V.cell1, V.daynight, V.season]).sum()
    sm = M.groupby(["cell1", "daynight", "season"]).size()
    a = pd.concat([sm.rename("m"), sb.rename("b")], axis=1).fillna(0)
    L = ((a.m + k) / (a.b + k)).rename("L")
    return {"P": P, "f": f, "L": L, "radius_km": radius_km, "k": k}


def point_weight(pts: pd.DataFrame, model: dict) -> np.ndarray:
    """S-NPP-equivalent MODIS-eq weight per VIIRS point: P[fbin,dn] * f[dn,moy] * L[cell,dn,season]."""
    P = model["P"].reindex(pd.MultiIndex.from_arrays([pts.fbin, pts.daynight])).values
    f = model["f"].reindex(pd.MultiIndex.from_arrays([pts.daynight, pts.moy])).values
    L = model["L"].reindex(pd.MultiIndex.from_arrays([pts.cell1, pts.daynight, pts.season])).fillna(1.0).values
    return P * f * L


# ----------------------------------------------------------------------------- metrics
def metr(y, h) -> dict:
    y = np.asarray(y, float); h = np.asarray(h, float)
    big = y >= 20
    le = np.log1p(h) - np.log1p(y)
    return dict(bias_pct=round(float((h.sum() / y.sum() - 1) * 100), 2),
                MdAPE=round(float(np.median(np.abs(h[big] - y[big]) / y[big] * 100)), 2),
                RMSLE=round(float(np.sqrt((le ** 2).mean())), 4),
                R2=round(float(1 - ((y - h) ** 2).sum() / ((y - y.mean()) ** 2).sum()), 4),
                n=int(len(y)), n_ge20=int(big.sum()))


def evaluate(M: pd.DataFrame, Vpred: pd.DataFrame) -> tuple[dict, pd.DataFrame, pd.DataFrame]:
    """M: MODIS target points; Vpred: VIIRS points with column `h` (weight). Returns metrics at
    country-month and 1deg cell-month, plus the two evaluation tables."""
    m_c = M.groupby("ym").size().rename("m")
    h_c = Vpred.groupby("ym").h.sum()
    cty = pd.concat([m_c, h_c], axis=1).fillna(0)
    m_l = M.groupby(["ym", "cell1"]).size().rename("m")
    h_l = Vpred.groupby(["ym", "cell1"]).h.sum()
    cel = pd.concat([m_l, h_l], axis=1).fillna(0)
    return {"country_month": metr(cty.m, cty.h), "cell1_month": metr(cel.m, cel.h)}, cty, cel


BAND_EDGES = [0, 2, 5, 20, 100, 1000, np.inf]
BAND_LABELS = ["<2", "2-5", "5-20", "20-100", "100-1000", ">=1000"]
BAND_GRIDS = {"country": None, "cell1": 1.0, "cell0.5": 0.5, "cell0.25": 0.25}


def residual_table(M: pd.DataFrame, Vp: pd.DataFrame) -> pd.DataFrame:
    """Held-out month residuals at several AOI sizes (country, 1/0.5/0.25 deg cells), pooled.
    lr = log1p(MODIS observed) - log1p(predicted h)."""
    out = []
    for name, deg in BAND_GRIDS.items():
        def g(d):
            if deg is None:
                return pd.Series("PAK", index=d.index)
            return np.floor(d.lat / deg).astype(int).astype(str) + "_" + np.floor(d.lon / deg).astype(int).astype(str)
        mm = M.assign(g=g(M)).groupby(["ym", "g"]).size().rename("m")
        hh = Vp.assign(g=g(Vp)).groupby(["ym", "g"]).h.sum()
        t = pd.concat([mm, hh], axis=1).fillna(0).reset_index()
        out.append(t.assign(level=name))
    r = pd.concat(out, ignore_index=True)
    r["year"] = r.ym.dt.year
    r["lr"] = np.log1p(r.m) - np.log1p(r.h)
    r["bucket"] = pd.cut(r.h, BAND_EDGES, right=False, labels=BAND_LABELS)
    return r


def band_by_count(r: pd.DataFrame) -> dict:
    """80% (q10/q90) and 90% (q05/q95) log1p residual bands per predicted-count bucket, plus nested
    leave-one-year-out coverage of the 80% band (quantiles from other years, tested on the held-out year)."""
    out = {}
    for b in BAND_LABELS:
        s = r[r.bucket == b]
        if len(s) == 0:
            continue
        cov = []
        for y in sorted(s.year.unique()):
            o, k = s.lr[s.year != y], s.lr[s.year == y]
            cov += list((k >= o.quantile(.1)) & (k <= o.quantile(.9)))
        out[b] = {"q05": round(float(s.lr.quantile(.05)), 4), "q10": round(float(s.lr.quantile(.1)), 4),
                  "q50": round(float(s.lr.quantile(.5)), 4), "q90": round(float(s.lr.quantile(.9)), 4),
                  "q95": round(float(s.lr.quantile(.95)), 4), "n": int(len(s)),
                  "n_by_level": {k: int(v) for k, v in s.level.value_counts().items()},
                  "nested_80pct_coverage": round(float(np.mean(cov)), 3)}
    return out


def anomaly_skill(cty: pd.DataFrame) -> dict:
    """Skill for the anomaly product (country-month, LOYO): within-calendar-month comparisons only,
    so the seasonal cycle cannot inflate the score (self-audit S2)."""
    c = cty.copy()
    c["moy"] = c.index.month
    c["year"] = c.index.year
    lm, lh = np.log1p(c.m), np.log1p(c.h)
    am = lm - lm.groupby(c.moy).transform("mean")
    ah = lh - lh.groupby(c.moy).transform("mean")
    pe = np.abs(c.groupby("moy").m.rank(pct=True) - c.groupby("moy").h.rank(pct=True))
    med = (c.m > c.groupby("moy").m.transform("median")) == (c.h > c.groupby("moy").h.transform("median"))
    wm = c.loc[c.groupby("moy").m.idxmax(), ["moy", "year"]].set_index("moy").year
    wh = c.loc[c.groupby("moy").h.idxmax(), ["moy", "year"]].set_index("moy").year
    return {"raw_log1p_R2": round(float(1 - ((lm - lh) ** 2).sum() / ((lm - lm.mean()) ** 2).sum()), 4),
            "anomaly_R2": round(float(1 - ((am - ah) ** 2).sum() / ((am - am.mean()) ** 2).sum()), 4),
            "anomaly_corr": round(float(np.corrcoef(am, ah)[0, 1]), 4),
            "pctl_err_mean_pp": round(float(pe.mean() * 100), 2),
            "pctl_err_p90_pp": round(float(pe.quantile(.9) * 100), 2),
            "above_below_median_agreement_pct": round(float(med.mean() * 100), 1),
            "same_worst_year_months": f"{int((wm == wh).sum())}/12"}


def terra_aqua_anomaly_corr(M: pd.DataFrame) -> float:
    """Noise-floor reference: correlation of monthly log anomalies between the two MODIS instruments."""
    c = M.groupby(["ym", "satellite"]).size().unstack().fillna(0)
    moy = c.index.month
    la, lb = np.log1p(c.Terra), np.log1p(c.Aqua)
    aa = la - la.groupby(moy).transform("mean")
    ab = lb - lb.groupby(moy).transform("mean")
    return round(float(np.corrcoef(aa, ab)[0, 1]), 4)


def in_windows(p: pd.DataFrame) -> pd.Series:
    """Rows inside the calibration-excluded windows. Applied to ALL sensors (as in the research)."""
    bad = pd.Series(False, index=p.index)
    for _, _, s, e in EXCLUDED_WINDOWS:
        bad |= (p.date >= s) & (p.date <= e)
    return bad
