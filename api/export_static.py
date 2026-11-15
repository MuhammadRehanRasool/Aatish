"""Write the pre-rendered JSON the website ships with (home page hero, method page charts).
Run from the repo root after build_harmonized.py:  py -3.14 -E -P api/export_static.py
Output: web/content/data/*.json (deterministic; regenerate when the parquet changes)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.core import store  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "web" / "content" / "data"
OUT.mkdir(parents=True, exist_ok=True)
s = store()

def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(name, (OUT / name).stat().st_size, "bytes")

cal = s.calendar("pakistan", None, None)
slim = {k: cal[k] for k in ("aoi", "range", "data_extent", "unit_label", "stats", "anomaly")}
slim["months"] = [{k: m[k] for k in ("ym", "year", "month", "value", "lo", "hi", "role", "provisional", "pct", "gap_days", "days_covered", "days_in_month")} for m in cal["months"]]
dump("pakistan_calendar.json", slim)

regions = {}
for p in s.presets():
    c = s.calendar(p["key"], None, None)
    st = c["stats"]
    regions[p["key"]] = {"label": p["label"], "total": st["total"], "worst_year": st.get("worst_year"),
                         "peak_month": st.get("peak_month"), "trend": st.get("trend"),
                         "anomaly": {k: v for k, v in (c["anomaly"] or {}).items() if k != "series"}}
dump("regions_summary.json", regions)
dump("overlap_pakistan.json", s.overlap("pakistan"))

c = s.calib
v = c["validation"]
dump("calibration_summary.json", {
    "unit": c["unit"], "method": c["method"], "fit_window": c["fit_window"], "filters": c["filters"],
    "match_radius_km": c["match_radius_km"], "shrinkage_k": c["shrinkage_k"], "frp_bins_mw": c["frp_bins_mw"],
    "P_aqua": c["P_aqua"], "f": c["f"], "f_sat": c["f_sat"], "frp_scale": c.get("frp_scale"),
    "terra_scaling": c["terra_scaling"], "series": c["series"], "excluded_windows": c["excluded_windows"],
    "validation": {"loyo_merged": {k: v["loyo_merged"][k] for k in ("country_month", "cell1_month", "yearly_bias_pct", "anomaly_skill_country_month")},
                   "band_by_count": {k: {kk: b[kk] for kk in ("q10", "q90", "n", "nested_80pct_coverage")} for k, b in v["loyo_merged"]["band_by_count"]["buckets"].items()},
                   "loyo_snpp": {k: v["loyo_snpp"][k] for k in ("country_month", "cell1_month")},
                   "forward": v.get("forward_2012-2017_to_2018-2022"),
                   "n20_transfer_no_factor": v.get("n20_transfer_no_factor"),
                   "n20_transfer_with_f_sat": v.get("n20_transfer_with_f_sat"),
                   "noise_floor": v.get("noise_floor_terra_vs_aqua_anomaly_corr")},
    "rows_total": s.n_rows_total, "series_rows": s.n_series,
})
dump("regions.geojson", s.preset_geojson())
