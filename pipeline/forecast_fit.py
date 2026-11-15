"""Fit + validate the PERS monthly forecast and write data/forecast_model.json.

Run from the repo root after build_harmonized.py:  py -3.14 -E -P pipeline/forecast_fit.py
Deterministic (no randomness except a seeded bootstrap).

1. Monthly main series (SUM w_modis_eq, series_role<>'excluded', not static) for Pakistan + 1-degree cells
   with mean >= 2 / month (same set as the bake-off). Last month used = last COMPLETE month in the data.
2. Rolling-origin backtest, origins 2015-12 .. last-1, horizons 1..3, coefficients refit every December on
   data <= origin only. Out-of-sample log1p residuals -> 80% band (q10/q90) by predicted-count bucket,
   pooled over horizons and levels. Band coverage is checked by cross-fitting (bands from odd target years
   scored on even years and vice versa).
3. Skill vs the 10-year climatology (same model with b=0) with a year-block bootstrap 90% CI.
4. Final coefficients fitted on every origin from 2003-01 up to the last complete month.
"""
import json
import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from api.forecast import BUCKETS, CLIM_K, H, bucket, clim_log, fit, point_log  # noqa: E402

PQ = (ROOT / "data/harmonized_points.parquet").as_posix()
OUT = ROOT / "data/forecast_model.json"
START = pd.Period("2000-11", "M")
FIRST_ORIGIN = pd.Period("2015-12", "M")
FIT_FROM = pd.Period("2003-01", "M")

last_day = pd.Timestamp(duckdb.sql(f"select max(date) from '{PQ}' where series_role <> 'excluded'").fetchall()[0][0])
last_complete = pd.Period(last_day, "M") if (last_day + pd.Timedelta(days=1)).day == 1 else pd.Period(last_day, "M") - 1
months = pd.period_range(START, last_complete, freq="M")

d = duckdb.sql(f"""select date_trunc('month', date) m, floor(lat)::int la, floor(lon)::int lo, sum(w_modis_eq) w
  from '{PQ}' where series_role <> 'excluded' and not static_flag group by all""").df()
d["m"] = pd.PeriodIndex(pd.to_datetime(d["m"]), freq="M")
d = d[(d.m >= START) & (d.m <= last_complete)]
cell = d.assign(s=d.la.astype(str) + "_" + d.lo.astype(str)).pivot_table(
    index="s", columns="m", values="w", aggfunc="sum").reindex(columns=months, fill_value=0).fillna(0)
cell = cell[cell.mean(axis=1) >= 2]
country = d.groupby("m").w.sum().reindex(months, fill_value=0)
Y = np.vstack([country.values[None, :], cell.values])
L = np.log1p(Y)
S, T = Y.shape
t_last = T - 1
t_fit0 = months.get_loc(FIT_FROM)
print(f"series {S} (country + {S - 1} cells), months {months[0]}..{months[-1]}")

# ---------- rolling-origin backtest ----------
rows, cache = [], {}
for t0 in range(months.get_loc(FIRST_ORIGIN), t_last):
    yr = months[t0].year
    if yr not in cache:
        cache[yr] = fit(L, t_fit0, t0)
    mu = point_log(L, t0, cache[yr])
    for h in range(1, H + 1):
        tt = t0 + h
        if tt > t_last:
            continue
        c = clim_log(L, tt, t0)
        for s in range(S):
            rows.append((s, h, tt, months[tt].year, months[tt].month, mu[s, h - 1], c[s], L[s, tt]))
R = pd.DataFrame(rows, columns=["s", "h", "t", "year", "moy", "mu", "clim", "ly"])
R["level"] = np.where(R.s == 0, "country", "cell1")
R["res"] = R.ly - R.mu
R["b"] = [bucket(x) for x in np.expm1(R.mu)]
R["ae"] = (R.ly - R.mu).abs()
R["ae_clim"] = (R.ly - R.clim).abs()


def bands_from(df):
    out = {}
    for _, _, name in BUCKETS:
        g = df[df.b == name]
        if len(g) >= 30:
            out[name] = (float(g.res.quantile(0.1)), float(g.res.quantile(0.9)), len(g))
    return out


bands = bands_from(R)
# cross-fitted coverage
cov = []
for par in (0, 1):
    cal, test = R[R.year % 2 == par], R[R.year % 2 != par]
    bq = bands_from(cal)
    t = test[test.b.isin(bq.keys())]
    lo = t.b.map(lambda x: bq[x][0]); hi = t.b.map(lambda x: bq[x][1])
    cov.append(t.assign(hit=(t.res >= lo) & (t.res <= hi)))
C = pd.concat(cov)
cover_bucket = C.groupby("b").hit.mean().round(3).to_dict()
cover_level_h = {f"{lv}_h{h}": round(float(g.hit.mean()), 3) for (lv, h), g in C.groupby(["level", "h"])}

# skill with year-block bootstrap
rng = np.random.default_rng(0)


def skill(df):
    years = sorted(df.year.unique())
    by = df.groupby("year")[["ae", "ae_clim"]].sum()
    n = df.groupby("year").size()
    point = 1 - by.ae.sum() / by.ae_clim.sum()
    bs = []
    for _ in range(2000):
        pick = rng.choice(years, len(years))
        a, c = by.ae.loc[pick].sum(), by.ae_clim.loc[pick].sum()
        bs.append(1 - a / c)
    return {"skill_pct": round(100 * point, 1), "ci90_pct": [round(100 * np.quantile(bs, 0.05), 1),
                                                            round(100 * np.quantile(bs, 0.95), 1)],
            "MAE_log": round(float(by.ae.sum() / n.sum()), 3), "MAE_log_clim": round(float(by.ae_clim.sum() / n.sum()), 3),
            "MdAPE_pct_y_ge_20": round(float(100 * ((np.expm1(df.mu) - np.expm1(df.ly)).abs() / np.expm1(df.ly))[np.expm1(df.ly) >= 20].median()), 1),
            "n": int(len(df))}


val = {}
for lv in ("country", "cell1"):
    for h in range(1, H + 1):
        g = R[(R.level == lv) & (R.h == h)]
        val[f"{lv}_h{h}"] = skill(g)
        val[f"{lv}_h{h}_peak"] = skill(g[g.moy.isin([4, 5, 10, 11])])

final = fit(L, t_fit0, t_last)
model = {
    "method": "PERS: log1p 10-year same-month climatology + pooled linear anomaly persistence (last month, last 12 months); one coefficient set per horizon",
    "unit": "MODIS-equivalent detections (Terra+Aqua) per month, main series",
    "horizons": H, "clim_years": CLIM_K,
    "fit": {"origins": [str(FIT_FROM), str(months[t_last - 1])], "last_complete_month": str(months[t_last]),
            "series": "Pakistan + %d one-degree cells (mean >= 2 per month)" % (S - 1)},
    "coefficients": {str(h): {"b0": round(float(b[0]), 5), "b_last_month": round(float(b[1]), 5),
                              "b_last_12_months": round(float(b[2]), 5)} for h, b in final.items()},
    "band_by_count": {k: {"q10": round(v[0], 4), "q90": round(v[1], 4), "n": v[2],
                          "crossfit_80pct_coverage": cover_bucket.get(k)} for k, v in bands.items()},
    "validation": {
        "design": f"rolling origin {FIRST_ORIGIN}..{months[t_last - 1]}, coefficients refit each year on data <= origin; "
                  "skill = 1 - MAE_log(PERS) / MAE_log(10-year climatology); 90% CI = year-block bootstrap; "
                  "peak = Apr, May, Oct, Nov",
        "skill": val,
        "crossfit_coverage_by_level_h": cover_level_h,
        "caveat": "Harmonization weights were fit on 2012-2022, which overlaps the test years (same for every model). "
                  "Bands validated on Pakistan and 1-degree cells; for small drawn areas they are an extrapolation.",
    },
}
OUT.write_text(json.dumps(model, indent=1), encoding="utf-8")
print(json.dumps({k: model[k] for k in ("coefficients", "band_by_count")}, indent=1))
print(json.dumps(model["validation"]["crossfit_coverage_by_level_h"]))
for k in ("country_h1", "country_h1_peak", "cell1_h1", "cell1_h1_peak", "country_h3", "cell1_h3"):
    print(k, val[k])
