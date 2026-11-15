"""Build the harmonized FireCalendar dataset from raw_data/ (read-only) into data/.

Outputs (deterministic, re-runnable):
  data/harmonized_points.parquet  one row per raw detection with flags + per-point weights
  data/calibration.json           P_aqua curve, f, L, f_sat, Terra factors, validation, residual quantiles
  data/no_data_days.csv           satellite no-data (outage) sat-days per daynight

Method: docs/plan.md §3. Usage:  py -3.14 -E -P pipeline/build_harmonized.py

Main series = SUM(w_modis_eq) WHERE series_role IN ('native','terra_scaled','derived') AND NOT static_flag.
w_modis_eq is also filled for VIIRS rows before 2022-10 (role 'excluded'), so the science panel can draw
the VIIRS-derived line over the 2012-2022 overlap, and for MODIS rows after 2022-09 (drift check).
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -P drops the script dir
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

import fc_lib as L

T0 = time.time()
log = lambda *a: print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)


def zero_runs(p, min_days):
    """Runs of >= min_days consecutive days with zero MODIS detections (Terra+Aqua, any daynight)."""
    s = p[p.sensor == "MODIS"]
    days = pd.date_range(s.date.min(), s.date.max(), freq="D")
    z = ~days.isin(s.date.unique())
    out, i = [], 0
    while i < len(days):
        if z[i]:
            j = i
            while j + 1 < len(days) and z[j + 1]:
                j += 1
            if j - i + 1 >= min_days:
                out.append((days[i], days[j]))
            i = j + 1
        else:
            i += 1
    return out


def main():
    L.DATA.mkdir(exist_ok=True)
    p = L.add_keys(L.load_raw())
    log("loaded", len(p), "rows")
    raw_files = sorted(str(f.relative_to(L.ROOT)).replace("\\", "/") for f in L.RAW.rglob("*.csv"))

    # ---------------- step 0: filters ----------------
    p["conf_ok"] = L.conf_ok(p)
    p["static_flag"], static_info = L.static_mask(p)
    usable = p.conf_ok & ~p.static_flag
    log("static mask", static_info, "| static rows", int(p.static_flag.sum()))

    # ---------------- no-data days ----------------
    nd = L.detect_no_data(p, ref_min=1)
    nd["status"] = "rule: 0 detections while another VIIRS sat has >=1 (same date+daynight)"
    nd["evidence"] = "max other VIIRS count = " + nd.ref_max_other.astype(str)
    off = []
    for label, sat, s, e in L.EXCLUDED_WINDOWS:
        for d in pd.date_range(s, e):
            for dn in ("D", "N"):
                off.append((sat, d, dn, "official: " + label))
    off = pd.DataFrame(off, columns=["satellite", "date", "daynight", "status_off"])
    # VIIRS: official S-NPP window is forced inactive; Aqua FMU is partial (data present) -> listed only
    nd = nd.merge(off, on=["satellite", "date", "daynight"], how="outer")
    nd["status"] = nd.status_off.fillna(nd.status)
    nd["evidence"] = nd.evidence.fillna("")
    nd = nd.drop(columns=["status_off", "ref_max_other"])
    modis_rows = []
    for a, b in zero_runs(p, 7):
        sat = "Terra" if b < L.AQUA_START else "MODIS"
        vv = p[(p.sensor != "MODIS") & (p.date >= a) & (p.date <= b)]
        ev = f"0 MODIS detections {a.date()}..{b.date()} ({(b - a).days + 1} d); VIIRS rows in run = {len(vv)}"
        st = "MODIS zero run >=7 d, cause not verified (flagged only, not filled)"
        if a <= pd.Timestamp("2001-07-04") and b >= pd.Timestamp("2001-06-14"):
            st = "DATA_NOTES gotcha 3: 2001 Terra gap, treat as no-data (official cause not verified)"
        for d in pd.date_range(a, b):
            for dn in ("D", "N"):
                modis_rows.append((sat, d, dn, st, ev))
    nd = pd.concat([nd, pd.DataFrame(modis_rows, columns=["satellite", "date", "daynight", "status", "evidence"])])
    nd["affects_series"] = (nd.satellite.isin(L.VIIRS_SATS) & ~nd.status.str.startswith("official: Aqua")) | nd.status.str.startswith("DATA_NOTES")
    nd = nd.sort_values(["satellite", "date", "daynight"]).reset_index(drop=True)
    nd.assign(date=nd.date.dt.strftime("%Y-%m-%d")).to_csv(L.DATA / "no_data_days.csv", index=False, lineterminator="\n")
    nd_v = nd[nd.satellite.isin(L.VIIRS_SATS)]
    act = L.active_table(p, nd_v)
    log("no-data rows", len(nd), nd.groupby("satellite").size().to_dict())

    # n_active per row (VIIRS rows only meaningful)
    key = pd.MultiIndex.from_arrays([p.date, p.daynight])
    p["n_active"] = act.n_active.reindex(key).fillna(0).astype("int8").values
    snpp_active = act["N"].reindex(key, fill_value=False).astype(bool).values

    # ---------------- NOAA-21 FRP -> NOAA-20-equivalent before binning (self-audit S5) ----------------
    s21, frp_diag = L.fit_frp_scale(p, act, usable)
    frp_scale = {"N21": s21}
    L.apply_frp_scale(p, frp_scale)
    log("FRP scale N21/N20", round(s21, 4))

    # ---------------- matching: nearest Aqua (same date+dn) for usable VIIRS points ----------------
    p["d_aqua_km"] = L.nearest_aqua_km(p, usable)
    log("matched; S-NPP points with an Aqua detection same date+dn:",
        int(p.d_aqua_km[p.satellite == "N"].notna().sum()))

    # ---------------- fit set ----------------
    infit = (p.date >= L.FIT_START) & (p.date <= L.FIT_END)
    F_mask = usable & infit & ~L.in_windows(p) & snpp_active
    F = p[F_mask]
    model = L.fit_model(F)
    log("fitted P/f/L on", int((F.satellite == "N").sum()), "S-NPP and", int((F.sensor == "MODIS").sum()), "MODIS points")

    # ---------------- per-satellite factors (VIIRS -> S-NPP-equivalent) ----------------
    vu = p[usable & p.satellite.isin(L.VIIRS_SATS) & (p.quality == "SP")].copy()
    vu["w0"] = L.point_weight(vu, model)
    both = lambda a, b: act[a] & act[b]
    def sums(df, sats, mask_idx, col):
        k = pd.MultiIndex.from_arrays([df.date, df.daynight])
        m = mask_idx.reindex(k).fillna(False).values.astype(bool)
        return {s: float(df.loc[m & (df.satellite == s).values, col].sum()) for s in sats}
    vu["one"] = 1.0
    fsat_diag = {}
    ab = both("N", "N20")
    s_w, s_n = sums(vu, ["N", "N20"], ab, "w0"), sums(vu, ["N", "N20"], ab, "one")
    f_n20 = s_w["N"] / s_w["N20"]
    early = vu[vu.date <= L.FIT_END]
    s_w_e, s_n_e = sums(early, ["N", "N20"], ab, "w0"), sums(early, ["N", "N20"], ab, "one")
    fsat_diag["N20"] = {"factor_weighted_all_overlap": round(f_n20, 4),
                        "count_ratio_all_overlap": round(s_n["N"] / s_n["N20"], 4),
                        "factor_weighted_2018-04_to_2022-09": round(s_w_e["N"] / s_w_e["N20"], 4),
                        "count_ratio_2018-04_to_2022-09": round(s_n_e["N"] / s_n_e["N20"], 4),
                        "overlap": "SP days where S-NPP and NOAA-20 are both active, 2018-04-01..2026-07-31"}
    ab2 = both("N20", "N21")
    s_w2, s_n2 = sums(vu, ["N20", "N21"], ab2, "w0"), sums(vu, ["N20", "N21"], ab2, "one")
    f_n21 = f_n20 * s_w2["N20"] / s_w2["N21"]
    fsat_diag["N21"] = {"factor_weighted": round(f_n21, 4),
                        "n21_over_n20_count_ratio": round(s_n2["N21"] / s_n2["N20"], 4),
                        "n21_over_n20_weighted_ratio": round(s_w2["N21"] / s_w2["N20"], 4),
                        "overlap": "SP days where NOAA-20 and NOAA-21 are both active, 2023-03-01..2026-07-31"}
    f_sat = {"N": 1.0, "N20": f_n20, "N21": f_n21}
    log("f_sat", {k: round(v, 4) for k, v in f_sat.items()})

    # ---------------- Terra-only scaling (pre-Aqua) ----------------
    mu = p[usable & (p.sensor == "MODIS") & (p.year >= L.TERRA_FACTOR_YEARS[0]) & (p.year <= L.TERRA_FACTOR_YEARS[1])
           & ~((p.date >= "2020-08-16") & (p.date <= "2020-09-02"))]
    tm = mu.groupby(["year", "moy"]).satellite.value_counts().unstack().fillna(0)
    tm["all"] = tm.Terra + tm.Aqua
    g = tm.groupby("moy")[["all", "Terra"]].sum()
    terra_factor = (g["all"] / g.Terra)
    lr = []
    for y in sorted(tm.index.get_level_values("year").unique()):
        o = tm.drop(index=y, level="year").groupby("moy")[["all", "Terra"]].sum()
        fo = o["all"] / o.Terra
        t = tm.xs(y, level="year")
        lr += list(np.log1p(t["all"]) - np.log1p(t.Terra * fo.reindex(t.index)))
    lr = np.array(lr)
    terra_q = {"q10": float(np.quantile(lr, .1)), "q90": float(np.quantile(lr, .9)),
               "q05": float(np.quantile(lr, .05)), "q95": float(np.quantile(lr, .95))}
    log("terra factor", terra_factor.round(2).to_dict())

    # ---------------- per-point weights ----------------
    isV = p.satellite.isin(L.VIIRS_SATS)
    isM = p.sensor == "MODIS"
    w = np.zeros(len(p))
    vk = (isV & p.conf_ok).values
    pv = p[vk]
    w[vk] = L.point_weight(pv, model) * pv.satellite.map(f_sat).values / np.maximum(pv.n_active.values, 1)
    mk = (isM & p.conf_ok).values
    w[mk] = 1.0
    tk = (isM & p.conf_ok & (p.date < L.AQUA_START)).values
    w[tk] = terra_factor.reindex(p.moy[tk]).values
    p["w_modis_eq"] = w
    if (vk & (p.n_active.values == 0)).any():
        raise SystemExit("VIIRS rows on a day with 0 active VIIRS sats - no-data rule inconsistent")

    role = np.full(len(p), "excluded", dtype=object)
    role[(isM & p.conf_ok & (p.date < L.AQUA_START)).values] = "terra_scaled"
    role[(isM & p.conf_ok & (p.date >= L.AQUA_START) & (p.date < L.DERIVED_START)).values] = "native"
    role[(isV & p.conf_ok & (p.date >= L.DERIVED_START)).values] = "derived"
    p["series_role"] = role

    # VIIRS-equivalent display unit: exact inverse of the conversion ratio R[dn,moy] * L[cell,dn,season]
    Vf = F[F.satellite == "N"]
    pf = model["P"].reindex(pd.MultiIndex.from_arrays([Vf.fbin, Vf.daynight])).values * \
         model["f"].reindex(pd.MultiIndex.from_arrays([Vf.daynight, Vf.moy])).values
    R = pd.Series(pf, index=Vf.index).groupby([Vf.daynight, Vf.moy]).mean().rename("R")
    Rp = R.reindex(pd.MultiIndex.from_arrays([p.daynight, p.moy])).values
    Lp = model["L"].reindex(pd.MultiIndex.from_arrays([p.cell1, p.daynight, p.season])).fillna(1.0).values
    p["w_viirs_eq"] = p.w_modis_eq.values / (Rp * Lp)

    # ---------------- validation (LOYO etc.) ----------------
    F = p[F_mask]  # now with n_active/d_aqua_km columns
    val = run_validation(F, p[usable], model, f_sat)
    log("LOYO S-NPP input:", val["loyo_snpp"]["country_month"], val["loyo_snpp"]["cell1_month"])
    log("LOYO merged input:", val["loyo_merged"]["country_month"], val["loyo_merged"]["cell1_month"])

    # ---------------- write parquet ----------------
    cols = ["date", "acq_time", "sensor", "satellite", "quality", "version", "lat", "lon", "daynight", "frp",
            "conf", "type", "scan", "track", "conf_ok", "static_flag", "series_role", "w_modis_eq", "w_viirs_eq",
            "n_active", "d_aqua_km"]
    out = p[cols].copy()
    out.loc[~isV.values, ["n_active"]] = 0
    tbl = pa.Table.from_pandas(out, preserve_index=False)
    tbl = tbl.set_column(0, "date", tbl.column("date").cast(pa.date32()))
    tbl = tbl.replace_schema_metadata(None)  # no pandas/version metadata -> byte-stable output
    pq.write_table(tbl, L.DATA / "harmonized_points.parquet", compression="zstd", row_group_size=250_000)
    log("wrote parquet", len(out), "rows")

    # ---------------- calibration.json ----------------
    def ser(s, names):
        return [dict(zip(names, (k if isinstance(k, tuple) else (k,))), value=round(float(v), 6)) for k, v in s.items()]
    P = model["P"].copy()
    P.index = P.index.set_levels([L.FRP_LABELS[i] for i in P.index.levels[0]], level=0)
    seasons = {0: "DJF", 1: "MAM", 2: "JJA", 3: "SON"}
    Ls = model["L"].copy()
    cal = {
        "generated_by": "pipeline/build_harmonized.py",
        "unit": "MODIS-equivalent detections (Terra+Aqua, FIRMS MODIS C6.1, conf>=30, non-static)",
        "method": "w = P_aqua[FRP bin, daynight] * f[daynight, month-of-year] * L[1deg cell, daynight, season] "
                  "* f_sat / n_active_viirs_sats; FRP bin uses frp / frp_scale[sat]; any AOI total = SUM(w_modis_eq). "
                  "Uncertainty: validation.band_by_count (band on log1p of the AOI-month total, chosen by its "
                  "predicted count). docs/plan.md §3",
        "fit_window": [str(L.FIT_START.date()), str(L.FIT_END.date())],
        "excluded_windows": [dict(label=a, satellite=b, start=c, end=d) for a, b, c, d in L.EXCLUDED_WINDOWS],
        "fit_set_also_excludes": "(date, daynight) where S-NPP is inactive (data/no_data_days.csv)",
        "filters": {"modis_conf_min": L.MODIS_CONF_MIN, "viirs_conf": list(L.VIIRS_CONF_OK),
                    "static_mask": "0.01deg cells with >5 type!=0 VIIRS SP detections (all years) "
                                   "+ 0.01deg cells with >=1 MODIS type!=0 detection 2018+; one mask for all rows",
                    "static_info": static_info},
        "match_radius_km": L.MATCH_RADIUS_KM, "shrinkage_k": L.K_SHRINK,
        "frp_bins_mw": [0, 1, 2, 4, 8, 16, 32, None],
        "P_aqua": ser(P, ["frp_bin", "daynight"]),
        "P_aqua_n": ser(F[F.satellite == "N"].groupby(["fbin", "daynight"]).size().rename(
            index=dict(enumerate(L.FRP_LABELS)), level=0), ["frp_bin", "daynight"]),
        "f": ser(model["f"], ["daynight", "moy"]),
        "L": [dict(cell1=c, daynight=d, season=seasons[s], value=round(float(v), 6)) for (c, d, s), v in Ls.items()],
        "R_viirs_to_modis": ser(R, ["daynight", "moy"]),
        "frp_scale": {k: round(v, 6) for k, v in frp_scale.items()},
        "frp_scale_note": "NOAA-21 FRP is divided by this before FRP binning (NOAA-20-equivalent). NOAA JPSS "
                          "NOAA-21 AF readme (2023-06-01): 'minor (up to ~10%) positive bias' from the M13 SRF shift "
                          "(NOAA operational product). Our FIRMS data shows a larger, uniform offset; cause of the "
                          "size difference not verified. Geometric mean of q10..q90 ratios, day+night, SP shared days.",
        "frp_scale_diagnostics": frp_diag,
        "f_sat": {k: round(v, 6) for k, v in f_sat.items()},
        "f_sat_diagnostics": fsat_diag,
        "terra_scaling": {"factor_by_moy": {int(k): round(float(v), 4) for k, v in terra_factor.items()},
                          "fit_years": list(L.TERRA_FACTOR_YEARS), "applies_before": str(L.AQUA_START.date()),
                          "loyo_log1p_residual_quantiles_country_month": {k: round(v, 4) for k, v in terra_q.items()}},
        "series": [
            {"from": "2000-11-01", "to": "2002-07-05", "source": "MODIS Terra x (Terra+Aqua)/Terra[moy]", "role": "terra_scaled"},
            {"from": "2002-07-06", "to": "2022-09-30", "source": "MODIS observed (Terra+Aqua)", "role": "native"},
            {"from": "2022-10-01", "to": None, "source": "VIIRS-derived MODIS-equivalent (mean of active sats); NRT rows provisional", "role": "derived"},
        ],
        "validation": val,
        "inputs": {"raw_files": raw_files, "n_rows": int(len(p)),
                   "max_date": str(p.date.max().date())},
    }
    (L.DATA / "calibration.json").write_text(json.dumps(cal, indent=1), encoding="utf-8")
    for f in ("harmonized_points.parquet", "calibration.json", "no_data_days.csv"):
        log(f, hashlib.md5((L.DATA / f).read_bytes()).hexdigest(), (L.DATA / f).stat().st_size // 1024, "KB")


def run_validation(F, U, model, f_sat):
    """LOYO (S-NPP input = research reproduction; merged input = production), forward, NOAA-20 transfer,
    pooled residual quantiles + nested coverage, per-year bias."""
    M = F[F.sensor == "MODIS"]
    years = sorted(F.year.unique())
    res = {}
    for mode in ("snpp", "merged"):
        Vin = F[F.satellite == "N"] if mode == "snpp" else F[F.satellite.isin(L.VIIRS_SATS)]
        parts = []
        for y in years:
            m = L.fit_model(F[F.year != y])
            te = Vin[Vin.year == y]
            h = L.point_weight(te, m)
            if mode == "merged":
                h = h * te.satellite.map(f_sat).values / te.n_active.values
            parts.append(te.assign(h=h))
        Vp = pd.concat(parts)
        mets, cty, cel = L.evaluate(M, Vp)
        r = dict(mets)
        cty = cty.assign(year=cty.index.year)
        r["yearly_bias_pct"] = {int(y): round(float((g.h.sum() / g.m.sum() - 1) * 100), 2) for y, g in cty.groupby("year")}
        qs = {}
        for lvl, t in (("country_month", cty), ("cell1_month", cel)):
            lr = np.log1p(t.m) - np.log1p(t.h)
            yrs = t.index.get_level_values("ym").year
            cov = []
            for y in years:  # nested: quantiles from other years -> coverage on held-out year
                o, k = lr[yrs != y], lr[yrs == y]
                cov += list((k >= o.quantile(.1)) & (k <= o.quantile(.9)))
            qs[lvl] = {"q05": round(float(lr.quantile(.05)), 4), "q10": round(float(lr.quantile(.1)), 4),
                       "q50": round(float(lr.quantile(.5)), 4), "q90": round(float(lr.quantile(.9)), 4),
                       "q95": round(float(lr.quantile(.95)), 4), "nested_80pct_coverage": round(float(np.mean(cov)), 3),
                       "definition": "log1p(MODIS observed) - log1p(predicted), pooled over all held-out months"}
        r["residual_quantiles"] = qs
        r["anomaly_skill_country_month"] = L.anomaly_skill(cty.drop(columns="year"))
        if mode == "merged":
            rt = L.residual_table(M, Vp)
            r["band_by_count"] = {
                "definition": "log1p(MODIS observed) - log1p(predicted), LOYO held-out months pooled over country, "
                              "1/0.5/0.25 deg cell-months; bucket = predicted AOI-month count. "
                              "Band for a predicted total h: [expm1(log1p(h)+q10), expm1(log1p(h)+q90)] (80%).",
                "buckets": L.band_by_count(rt)}
        res[f"loyo_{mode}"] = r
    res["noise_floor_terra_vs_aqua_anomaly_corr"] = L.terra_aqua_anomaly_corr(M)
    # forward in time
    m = L.fit_model(F[F.year <= 2017])
    te = F[(F.satellite == "N") & (F.year >= 2018)]
    res["forward_2012-2017_to_2018-2022"] = L.evaluate(M[M.year >= 2018], te.assign(h=L.point_weight(te, m)))[0]
    # NOAA-20 transfer: fitted on S-NPP <=2017, applied to NOAA-20 points 2018-04..2022-09
    n20 = F[(F.satellite == "N20")]
    h = L.point_weight(n20, m)
    res["n20_transfer_no_factor"] = L.evaluate(M[M.date >= "2018-04-01"], n20.assign(h=h))[0]
    res["n20_transfer_with_f_sat"] = L.evaluate(M[M.date >= "2018-04-01"], n20.assign(h=h * f_sat["N20"]))[0]
    res["expected_from_research"] = {"loyo_country_month": {"MdAPE": 10.7, "R2": 0.956},
                                     "loyo_cell1_month": {"MdAPE": 17.7, "R2": 0.941},
                                     "forward": {"country_MdAPE": 11.0, "cell_MdAPE": 18.1, "cell_R2": 0.943},
                                     "n20_transfer": {"bias_pct": 4.6, "country_MdAPE": 8.5, "cell_R2": 0.947},
                                     "source": "docs/harmonization-research.md §6 (filters: type==0, not the location mask)"}
    return res


if __name__ == "__main__":
    main()
