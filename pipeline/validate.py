"""Validate data/harmonized_points.parquet + data/calibration.json (written by build_harmonized.py).

1. Rebuild the fit set from the parquet only, refit, and check the stored weights are reproduced.
2. Re-run LOYO / forward / NOAA-20 transfer and assert they match calibration.json and the research
   numbers (docs/harmonization-research.md §6) within tolerance.
3. Matching-radius sensitivity: 1.0 / 1.5 / 2.0 km.
4. Sanity: series seams (2002-07, 2022-10), 2012-2022 overlap (MODIS observed vs VIIRS-derived),
   NOAA-21 vs NOAA-20 derived agreement, post-2022 MODIS drift check.

Usage: py -3.14 -E -P pipeline/validate.py   (exit code 1 if any assertion fails)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np
import pandas as pd

import fc_lib as L
from build_harmonized import run_validation

pd.set_option("display.width", 200)
FAIL = []


def check(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {detail}")
    if not ok:
        FAIL.append(name)


def section(t):
    print(f"\n=== {t} ===")


# ---------------------------------------------------------------- load
cal = json.loads((L.DATA / "calibration.json").read_text(encoding="utf-8"))
p = pd.read_parquet(L.DATA / "harmonized_points.parquet")
p["date"] = pd.to_datetime(p.date)
p = L.add_keys(p)
L.apply_frp_scale(p, cal["frp_scale"])
nd =pd.read_csv(L.DATA / "no_data_days.csv", parse_dates=["date"])
print("rows", len(p), "| roles", p.series_role.value_counts().to_dict())

section("1. integrity + weight reproduction")
check("no NaN weights", bool(p.w_modis_eq.notna().all() and p.w_viirs_eq.notna().all()))
check("conf-failing rows have w=0", bool((p.w_modis_eq[~p.conf_ok] == 0).all()))
check("VIIRS rows have n_active>=1", bool((p.n_active[p.satellite.isin(L.VIIRS_SATS)] >= 1).all()))
check("no VIIRS detections on a flagged no-data sat-day",
      p[p.satellite.isin(L.VIIRS_SATS)].merge(nd[nd.satellite.isin(L.VIIRS_SATS)],
                                              on=["satellite", "date", "daynight"]).empty)
act = L.active_table(p, nd[nd.satellite.isin(L.VIIRS_SATS)])
snpp_active = act["N"].reindex(pd.MultiIndex.from_arrays([p.date, p.daynight]), fill_value=False).astype(bool).values
usable = p.conf_ok & ~p.static_flag
F_mask = usable & (p.date >= L.FIT_START) & (p.date <= L.FIT_END) & ~L.in_windows(p) & snpp_active
F = p[F_mask]
model = L.fit_model(F)
f_sat = cal["f_sat"]
v = p[p.satellite.isin(L.VIIRS_SATS) & p.conf_ok]
w_re = L.point_weight(v, model) * v.satellite.map(f_sat).values / v.n_active.values
err = np.abs(w_re - v.w_modis_eq.values).max()
check("VIIRS w_modis_eq reproduced from parquet-only refit", err < 1e-5, f"(max abs diff {err:.2e})")
P_cal = {(d["frp_bin"], d["daynight"]): d["value"] for d in cal["P_aqua"]}
P_err = max(abs(P_cal[(L.FRP_LABELS[b], dn)] - val) for (b, dn), val in model["P"].items())
check("P_aqua curve matches calibration.json", P_err < 1e-5, f"(max diff {P_err:.1e})")

section("2. LOYO / forward / transfer (from parquet) vs calibration.json and research")
val = run_validation(F, p[usable], model, f_sat)
stored = cal["validation"]
for k in ("loyo_snpp", "loyo_merged"):
    for lvl in ("country_month", "cell1_month"):
        a, b = val[k][lvl], stored[k][lvl]
        check(f"{k}.{lvl} == calibration.json", abs(a["MdAPE"] - b["MdAPE"]) < 0.01 and abs(a["R2"] - b["R2"]) < 1e-3,
              f"MdAPE {a['MdAPE']} R2 {a['R2']} bias {a['bias_pct']}%")
exp = stored["expected_from_research"]
r = val["loyo_snpp"]
check("LOYO country MdAPE ~10.7 (±1.5pp)", abs(r["country_month"]["MdAPE"] - 10.7) <= 1.5, str(r["country_month"]["MdAPE"]))
check("LOYO country R2 ~0.956 (±0.01)", abs(r["country_month"]["R2"] - 0.956) <= 0.01, str(r["country_month"]["R2"]))
check("LOYO cell MdAPE ~17.7 (±1.5pp)", abs(r["cell1_month"]["MdAPE"] - 17.7) <= 1.5, str(r["cell1_month"]["MdAPE"]))
check("LOYO cell R2 ~0.941 (±0.01)", abs(r["cell1_month"]["R2"] - 0.941) <= 0.01, str(r["cell1_month"]["R2"]))
fw = val["forward_2012-2017_to_2018-2022"]
check("forward country MdAPE ~11.0 (±2pp)", abs(fw["country_month"]["MdAPE"] - 11.0) <= 2, str(fw["country_month"]["MdAPE"]))
check("forward cell MdAPE ~18.1 (±2pp)", abs(fw["cell1_month"]["MdAPE"] - 18.1) <= 2, str(fw["cell1_month"]["MdAPE"]))
tr = val["n20_transfer_no_factor"]
check("NOAA-20 transfer bias ~+4.6% (±3pp)", abs(tr["country_month"]["bias_pct"] - 4.6) <= 3, str(tr["country_month"]["bias_pct"]))
check("NOAA-20 transfer country MdAPE ~8.5 (±2pp)", abs(tr["country_month"]["MdAPE"] - 8.5) <= 2, str(tr["country_month"]["MdAPE"]))
print("  NOAA-20 transfer with f_sat:", val["n20_transfer_with_f_sat"]["country_month"])
yb = val["loyo_merged"]["yearly_bias_pct"]
print("  yearly LOYO bias % (merged):", yb)
check("yearly bias within ±8% for 2013-2022", all(abs(v_) <= 8 for y, v_ in yb.items() if y >= 2013), "")
for lvl, q in val["loyo_merged"]["residual_quantiles"].items():
    print(f"  80% band {lvl}: [{q['q10']:+.3f}, {q['q90']:+.3f}] log1p, nested coverage {q['nested_80pct_coverage']}")
    check(f"80% band coverage {lvl} in 0.72..0.88", 0.72 <= q["nested_80pct_coverage"] <= 0.88)

print("  count-dependent 80% bands (log1p residual, nested LOYO coverage):")
bb = val["loyo_merged"]["band_by_count"]["buckets"]
for b, q in bb.items():
    print(f"    {b:>9s}: [{q['q10']:+.3f}, {q['q90']:+.3f}]  n={q['n']:5d}  coverage {q['nested_80pct_coverage']}")
    if q["n"] >= 100:
        check(f"band_by_count {b} coverage in 0.72..0.88", 0.72 <= q["nested_80pct_coverage"] <= 0.88)
check("band_by_count == calibration.json", bb == stored["loyo_merged"]["band_by_count"]["buckets"])
an = val["loyo_merged"]["anomaly_skill_country_month"]
print("  anomaly skill (merged, country-month):", an)
print("  noise floor, Terra vs Aqua anomaly corr:", val["noise_floor_terra_vs_aqua_anomaly_corr"])
check("anomaly skill == calibration.json", an == stored["loyo_merged"]["anomaly_skill_country_month"])
check("anomaly corr within 0.05 of the Terra-vs-Aqua floor",
      an["anomaly_corr"] >= val["noise_floor_terra_vs_aqua_anomaly_corr"] - 0.05,
      f"{an['anomaly_corr']} vs {val['noise_floor_terra_vs_aqua_anomaly_corr']}")

section("3. matching-radius sensitivity (LOYO, fit set identical)")
rows = []
for rad in (1.0, 1.5, 2.0):
    Vs = F[F.satellite == "N"]
    Pr = (Vs.d_aqua_km <= rad).groupby([Vs.fbin, Vs.daynight]).mean().unstack()
    M = F[F.sensor == "MODIS"]
    for mode in ("snpp", "merged"):
        Vin = Vs if mode == "snpp" else F[F.satellite.isin(L.VIIRS_SATS)]
        parts = []
        for y in sorted(F.year.unique()):
            m = L.fit_model(F[F.year != y], radius_km=rad)
            te = Vin[Vin.year == y]
            h = L.point_weight(te, m)
            if mode == "merged":
                h = h * te.satellite.map(f_sat).values / te.n_active.values
            parts.append(te.assign(h=h))
        mets = L.evaluate(M, pd.concat(parts))[0]
        rows.append({"radius_km": rad, "input": mode, **{f"cty_{k}": v_ for k, v_ in mets["country_month"].items() if k in ("MdAPE", "RMSLE", "R2")},
                     **{f"cell_{k}": v_ for k, v_ in mets["cell1_month"].items() if k in ("MdAPE", "RMSLE", "R2")}})
    print(f"  P_aqua at {rad} km (rows FRP bin <1..>=32):\n" + Pr.rename(index=dict(enumerate(L.FRP_LABELS))).round(3).T.to_string())
sens = pd.DataFrame(rows)
print(sens.to_string(index=False))
spread = sens.groupby("input")[["cty_MdAPE", "cell_MdAPE"]].agg(lambda s: s.max() - s.min())
print("  spread (max-min) across radii:\n" + spread.to_string())

section("4. sanity: series seams, overlap, satellites, drift")
main = p[(p.series_role != "excluded") & ~p.static_flag]
ser = main.groupby(["ym", "series_role"]).w_modis_eq.sum().unstack().fillna(0)
ser["total"] = ser.sum(axis=1)
print("Main series, months around 2002-07 seam:")
print(ser.loc[pd.Period("2002-01", "M"):pd.Period("2002-12", "M")].round(0).to_string())
# direct seam check: Terra x factor vs observed Terra+Aqua for the first native months
tf = {int(k): v_ for k, v_ in cal["terra_scaling"]["factor_by_moy"].items()}
mu = p[usable & (p.sensor == "MODIS") & (p.date >= L.AQUA_START) & (p.date < "2003-07-01")]
c = mu.groupby(["ym", "satellite"]).size().unstack().fillna(0)
c["terra_scaled"] = c.Terra * c.index.month.map(tf).values
c["obs_T+A"] = c.Terra + c.Aqua
c["ratio"] = c["obs_T+A"] / c.terra_scaled
print("Terra-scaled vs observed Terra+Aqua, first 12 months with Aqua:")
print(c.round(2).to_string())
print(f"  pooled ratio obs/scaled 2002-07..2003-06: {c['obs_T+A'].sum() / c.terra_scaled.sum():.3f}")
print("Main series, months around 2022-10 seam (with MODIS observed for reference, drift-affected):")
mod = p[usable & (p.sensor == "MODIS")].groupby("ym").size().rename("modis_obs")
vd = p[usable & p.satellite.isin(L.VIIRS_SATS)].groupby("ym").w_modis_eq.sum().rename("viirs_derived")
seam = pd.concat([mod, vd], axis=1).loc[pd.Period("2022-04", "M"):pd.Period("2023-03", "M")]
seam["ratio_derived/obs"] = seam.viirs_derived / seam.modis_obs
print(seam.round(2).to_string())

print("\nOverlap 2012-01-20..2022-09-30 (country, non-static; VIIRS-derived = production weights, in-sample):")
ov = pd.concat([mod, vd], axis=1).loc[pd.Period("2012-01", "M"):pd.Period("2022-09", "M")].fillna(0)
ov["year"] = ov.index.year
yr = ov.groupby("year")[["modis_obs", "viirs_derived"]].sum()
yr["derived/obs"] = yr.viirs_derived / yr.modis_obs
print(yr.round(3).to_string())
big = ov[ov.modis_obs >= 20]
ape = (big.viirs_derived - big.modis_obs).abs() / big.modis_obs * 100
print(f"  in-sample monthly MdAPE {ape.median():.1f}%  corr(log1p) "
      f"{np.corrcoef(np.log1p(ov.modis_obs), np.log1p(ov.viirs_derived))[0, 1]:.3f}  total ratio {ov.viirs_derived.sum() / ov.modis_obs.sum():.3f}")
moy = ov.assign(moy=ov.index.month).groupby("moy")[["modis_obs", "viirs_derived"]].sum()
print("  by month-of-year derived/obs:", (moy.viirs_derived / moy.modis_obs).round(3).to_dict())

print("\nNOAA-21 FRP rescale (self-audit S5): scale", cal["frp_scale"], "| f_sat", cal["f_sat"])
s21_re, _ = L.fit_frp_scale(p, act, usable)
check("FRP scale reproduced from parquet", abs(s21_re - cal["frp_scale"]["N21"]) < 1e-5, f"{s21_re:.4f}")
cnt_ratio = cal["f_sat_diagnostics"]["N21"]["n21_over_n20_count_ratio"]
w_ratio = cal["f_sat_diagnostics"]["N21"]["n21_over_n20_weighted_ratio"]
check("after rescale, N21/N20 weight ratio within 0.03 of count ratio", abs(w_ratio - cnt_ratio) <= 0.03,
      f"weighted {w_ratio} vs count {cnt_ratio}")
# seasonal check: N21/N20 monthly MODIS-eq ratio by month-of-year should not depend on the fire-size mix
vs_ = p[usable & p.satellite.isin(["N20", "N21"]) & (p.quality == "SP")]
k_ = pd.MultiIndex.from_arrays([vs_.date, vs_.daynight])
b_ = (act["N20"] & act["N21"]).reindex(k_, fill_value=False).astype(bool).values
q_ = vs_[b_].assign(w1=lambda d: d.w_modis_eq * d.n_active).groupby(["moy", "satellite"]).w1.sum().unstack()
print("  N21/N20 MODIS-eq ratio by month-of-year:", (q_.N21 / q_.N20).round(3).to_dict())

print("\nPer-satellite derived totals on days all compared sats active (SP), should be ~1:")
vs = p[usable & p.satellite.isin(L.VIIRS_SATS) & (p.quality == "SP")].copy()
vs["w_single"] = vs.w_modis_eq * vs.n_active  # undo the 1/n_active averaging
key = pd.MultiIndex.from_arrays([vs.date, vs.daynight])
for a, b in (("N20", "N"), ("N21", "N20")):
    both_ = (act[a] & act[b]).reindex(key, fill_value=False).astype(bool).values
    q = vs[both_].groupby(["ym", "satellite"]).w_single.sum().unstack()[[a, b]].dropna()
    q = q[q[b] >= 50]
    rr = q[a] / q[b]
    print(f"  {a}/{b} monthly MODIS-eq ratio: median {rr.median():.3f}, IQR {rr.quantile(.25):.3f}-{rr.quantile(.75):.3f}, n={len(rr)}")
    check(f"{a}/{b} derived monthly ratio median within 0.95..1.05", 0.95 <= rr.median() <= 1.05)

print("\nDrift check, Oct-Nov: MODIS observed (T+A) / VIIRS-derived, and Terra's share of MODIS detections:")
on = usable & (p.year >= 2016) & p.moy.isin([10, 11])
pm = p[on & (p.sensor == "MODIS")].groupby(["year", "satellite"]).size().unstack()
pv = p[on & p.satellite.isin(L.VIIRS_SATS)].groupby("year").w_modis_eq.sum()
print(pd.DataFrame({"modis_obs": pm.sum(axis=1), "viirs_derived": pv.round(0),
                    "obs/derived": (pm.sum(axis=1) / pv).round(3),
                    "terra_share": (pm.Terra / pm.sum(axis=1)).round(3)}).to_string())
print("  note: 2026 Nov is partial (to", p.date.max().date(), ") and NRT")

section("summary")
print("FAILED:" if FAIL else "ALL CHECKS PASSED", FAIL if FAIL else "")
sys.exit(1 if FAIL else 0)
