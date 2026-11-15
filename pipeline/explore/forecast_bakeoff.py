"""Forecast bake-off on the harmonized monthly series (2026-11-14).

Question: can we forecast next 1-3 months of harmonized burning activity better than
"the usual same month" (climatology)?

Series: monthly SUM(w_modis_eq) (main-series rule) for Pakistan + 1-degree cells.
Rolling origin: forecast issued at end of month T for T+1..T+3, T = 2015-12 .. 2026-07.
Every model only sees data up to T.

Models
  0  CLIM   median of same calendar month over all prior years
  0b CLIM10 median of same calendar month over the last 10 years (stronger bar to beat)
  A  PERS   statistical: log1p climatology (last 10 yrs) + pooled linear anomaly persistence
  B  LGBM   LightGBM global model across all series (M5-style), lag + climatology features
  C  CHR2   Chronos-2 zero-shot foundation model (amazon/chronos-2)

Usage: py -3.14 -E -P pipeline/explore/forecast_bakeoff.py [--no-chronos]
"""
import sys, time, json
from pathlib import Path
import numpy as np, pandas as pd, duckdb

ROOT = Path(__file__).resolve().parents[2]
PQ = (ROOT / "data/harmonized_points.parquet").as_posix()
OUT = ROOT / "data/explore"
H = 3
Q = [0.1, 0.5, 0.9]
FIRST_ORIGIN, LAST_ORIGIN = pd.Period("2015-12", "M"), pd.Period("2026-07", "M")
START, END = pd.Period("2000-11", "M"), pd.Period("2026-10", "M")  # Nov 2026 is partial
NO_CHRONOS = "--no-chronos" in sys.argv

# ---------- monthly series ----------
q = f"""
select date_trunc('month', date) m, floor(lat)::int la, floor(lon)::int lo, sum(w_modis_eq) w
from '{PQ}' where series_role <> 'excluded' and not static_flag group by all"""
d = duckdb.sql(q).df()
d["m"] = pd.PeriodIndex(pd.to_datetime(d["m"]), freq="M")
d = d[(d.m >= START) & (d.m <= END)]
months = pd.period_range(START, END, freq="M")
cell = d.assign(s=d.la.astype(str) + "_" + d.lo.astype(str)).pivot_table(
    index="s", columns="m", values="w", aggfunc="sum").reindex(columns=months, fill_value=0).fillna(0)
# keep cells with real activity (mean >= 2 MODIS-eq / month over the record)
cell = cell[cell.mean(axis=1) >= 2]
country = d.groupby("m").w.sum().reindex(months, fill_value=0)
Y = pd.concat([pd.DataFrame([country.values], index=["PAK"], columns=months), cell])
print(f"series: {len(Y)} (1 country + {len(cell)} cells), months {len(months)}")
Yv = Y.values  # (S, T)
S, T = Yv.shape
moy = np.array([p.month for p in months])
L = np.log1p(Yv)
origins = [months.get_loc(p) for p in pd.period_range(FIRST_ORIGIN, LAST_ORIGIN, freq="M")]


def same_moy_prior(t_target, t_origin, k=None):
    """indices of months with same month-of-year as target, observed by origin."""
    idx = [i for i in range(t_target - 12, -1, -12) if i <= t_origin]
    return idx[:k] if k else idx


# ---------- model 0: climatology ----------
def m_clim(t0):
    out = np.zeros((S, H, 3))
    for h in range(1, H + 1):
        idx = same_moy_prior(t0 + h, t0)
        out[:, h - 1, :] = np.quantile(Yv[:, idx], Q, axis=1).T
    return out


def m_clim10(t0):
    out = np.zeros((S, H, 3))
    for h in range(1, H + 1):
        idx = same_moy_prior(t0 + h, t0, 10)
        out[:, h - 1, :] = np.quantile(Yv[:, idx], Q, axis=1).T
    return out


# ---------- model A: climatology + pooled anomaly persistence (log1p) ----------
def clim_log(t_target, t_origin, k=10):
    idx = same_moy_prior(t_target, t_origin, k)
    return L[:, idx].mean(axis=1)


def feats_A(t0, h):
    a1 = L[:, t0] - clim_log(t0, t0 - 1)  # last month anomaly (clim excludes itself)
    a12 = np.mean([L[:, t0 - j] - clim_log(t0 - j, t0 - j - 1) for j in range(12)], axis=0)
    return np.c_[np.ones(S), a1, a12]


A_cache = {}


def fit_A(t0):
    # pooled OLS per horizon on all (series, origin) pairs whose target <= t0, origins from 2003-01
    co = {}
    for h in range(1, H + 1):
        X, y = [], []
        for t in range(months.get_loc(pd.Period("2003-01", "M")), t0 - h + 1):
            X.append(feats_A(t, h)); y.append(L[:, t + h] - clim_log(t + h, t))
        X, y = np.vstack(X), np.concatenate(y)
        b = np.linalg.lstsq(X, y, rcond=None)[0]
        r = y - X @ b
        co[h] = (b, np.quantile(r, [0.1, 0.9]))
    return co


def m_pers(t0):
    yr = months[t0].year
    if yr not in A_cache:  # refit once a year (Dec origin), only on data <= t0
        A_cache[yr] = fit_A(t0)
    co = A_cache[yr]
    out = np.zeros((S, H, 3))
    for h in range(1, H + 1):
        b, (r10, r90) = co[h]
        mu = clim_log(t0 + h, t0) + feats_A(t0, h) @ b
        out[:, h - 1] = np.expm1(np.c_[mu + r10, mu, mu + r90]).clip(0)
    return out


# ---------- model B: LightGBM global ----------
import lightgbm as lgb

ser_scale = None


def feats_B(t0, h):
    tt = t0 + h
    c10 = clim_log(tt, t0)
    idx = same_moy_prior(tt, t0)
    cmed = np.log1p(np.median(Yv[:, idx], axis=1))
    lvl = L[:, max(0, t0 - 35):t0 + 1].mean(axis=1)
    return np.c_[np.full(S, h), np.full(S, moy[tt]), L[:, t0], L[:, t0 - 1], L[:, t0 - 2],
                 L[:, tt - 12], L[:, tt - 24], c10, cmed, L[:, t0] - clim_log(t0, t0 - 1), lvl,
                 np.arange(S) == 0]


B_cache = {}


def fit_B(t0):
    X, y = [], []
    for t in range(months.get_loc(pd.Period("2003-01", "M")), t0):
        for h in range(1, H + 1):
            if t + h <= t0:
                X.append(feats_B(t, h)); y.append(L[:, t + h])
    X, y = np.vstack(X), np.concatenate(y)
    ms = {}
    for a in Q:
        p = dict(objective="quantile", alpha=a) if a != 0.5 else dict(objective="l2")
        ms[a] = lgb.LGBMRegressor(n_estimators=300, learning_rate=0.03, num_leaves=15,
                                  min_child_samples=40, subsample=0.8, subsample_freq=1,
                                  colsample_bytree=0.8, random_state=0, verbose=-1, **p).fit(X, y)
    return ms


def m_lgbm(t0):
    yr = months[t0].year
    if yr not in B_cache:
        B_cache[yr] = fit_B(t0)
    ms = B_cache[yr]
    out = np.zeros((S, H, 3))
    for h in range(1, H + 1):
        X = feats_B(t0, h)
        out[:, h - 1] = np.expm1(np.c_[[ms[a].predict(X) for a in Q]].T).clip(0)
    out.sort(axis=2)
    return out


# ---------- model C: Chronos-2 zero-shot ----------
chr_pipe = None


def m_chr2(t0):
    global chr_pipe
    import torch
    from chronos import BaseChronosPipeline
    if chr_pipe is None:
        chr_pipe = BaseChronosPipeline.from_pretrained("amazon/chronos-2", device_map="cpu",
                                                       torch_dtype=torch.float32)
    ctx = [torch.tensor(Yv[s, :t0 + 1], dtype=torch.float32) for s in range(S)]
    qs, _ = chr_pipe.predict_quantiles(ctx, prediction_length=H, quantile_levels=Q)
    out = np.stack([x[0].numpy() for x in qs])  # (S, H, 3)
    out = np.sort(out.clip(0), axis=2)
    return out


models = {"CLIM": m_clim, "CLIM10": m_clim10, "PERS": m_pers, "LGBM": m_lgbm}
if not NO_CHRONOS:
    models["CHR2"] = m_chr2

preds = {k: [] for k in models}
times = {}
for k, f in models.items():
    t_ = time.time()
    for t0 in origins:
        preds[k].append(f(t0))
    times[k] = time.time() - t_
    print(f"{k}: {times[k]:.1f}s")

# ---------- scoring ----------
rows = []
for k in models:
    P = np.stack(preds[k])  # (O, S, H, 3)
    for i, t0 in enumerate(origins):
        for h in range(1, H + 1):
            tt = t0 + h
            clim_med = np.median(Yv[:, same_moy_prior(tt, t0)], axis=1)
            for s in range(S):
                rows.append((k, s, h, tt, moy[tt], Yv[s, tt], *P[i, s, h - 1], clim_med[s]))
R = pd.DataFrame(rows, columns=["model", "s", "h", "t", "moy", "y", "q10", "q50", "q90", "clim"])
R["ae_log"] = (np.log1p(R.q50) - np.log1p(R.y)).abs()
R["cover"] = (R.y >= R.q10) & (R.y <= R.q90)
R["width"] = np.log1p(R.q90) - np.log1p(R.q10)
R["ape"] = (R.q50 - R.y).abs() / R.y.where(R.y >= 20)
# direction of anomaly vs climatology median (only where actual differs from median by >20%)
big = (R.y - R.clim).abs() > 0.2 * R.clim.clip(lower=5)
R["dir_hit"] = np.where(big, np.sign(R.q50 - R.clim) == np.sign(R.y - R.clim), np.nan)
R["level"] = np.where(R.s == 0, "country", "cell1")
R["peak"] = R.moy.isin([4, 5, 10, 11])
R["year"] = [months[t].year for t in R.t]


def summ(g):
    return pd.Series(dict(MAE_log=g.ae_log.mean(), MdAPE=100 * g.ape.median(),
                          cover80=g.cover.mean(), width=g.width.mean(),
                          dir_hit=g.dir_hit.mean(), n=len(g)))


res = R.groupby(["level", "h", "model"]).apply(summ, include_groups=False)
base = res.xs("CLIM", level="model")["MAE_log"]
res["skill_vs_clim"] = 1 - res["MAE_log"] / base.reindex(res.index.droplevel("model")).values
pk = R[R.peak].groupby(["level", "h", "model"]).apply(summ, include_groups=False)
pk["skill_vs_clim"] = 1 - pk["MAE_log"] / pk.xs("CLIM", level="model")["MAE_log"].reindex(
    pk.index.droplevel("model")).values
# per-year skill (country, h=1) to see stability
yr = R[(R.level == "country") & (R.h == 1)].groupby(["year", "model"]).ae_log.mean().unstack()
yr_sk = 1 - yr.div(yr["CLIM"], axis=0)

pd.set_option("display.width", 200, "display.precision", 3)
rep = []
rep.append(f"series {S} (country + {S-1} 1-degree cells), origins {months[origins[0]]}..{months[origins[-1]]} ({len(origins)}), horizons 1..{H}")
rep.append(f"runtime s: {json.dumps({k: round(v, 1) for k, v in times.items()})}")
rep.append("\n=== ALL MONTHS ===\n" + res.to_string())
rep.append("\n=== PEAK MONTHS (Apr, May, Oct, Nov) ===\n" + pk.to_string())
rep.append("\n=== country h=1 skill vs CLIM by target year (1 - MAE_log/MAE_log_CLIM) ===\n" + yr_sk.to_string())
txt = "\n".join(rep)
print(txt)
(OUT / "forecast_bakeoff_report.txt").write_text(txt, encoding="utf-8")
R.to_parquet(OUT / "forecast_bakeoff_preds.parquet")
