"""Aatish API core: load the harmonized parquet once, answer AOI x date-range queries.

Series definition (docs/plan.md §3, CLAUDE.md):
    main series = SUM(w_modis_eq) WHERE series_role <> 'excluded' AND NOT static_flag  (conf_ok rows; w=0 otherwise)
Uncertainty: calibration.json -> validation.loyo_merged.band_by_count (derived months, by predicted count),
terra_scaling.loyo_log1p_residual_quantiles_country_month (Terra-scaled months, combined with the count band
by taking the wider of the two). Native MODIS months are observed, so they have no model band.
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import Point, Polygon, box, shape
from shapely.ops import unary_union

from . import forecast as fc

ROOT = Path(os.environ.get("FC_ROOT", Path(__file__).resolve().parent.parent))
DATA = ROOT / "data"
PARQUET = DATA / "harmonized_points.parquet"
CALIB = DATA / "calibration.json"
NO_DATA = DATA / "no_data_days.csv"
ADM0 = Path(os.environ.get("FC_ADM0", ROOT / "raw_data" / "boundaries" / "pak_adm0_gb.geojson"))
ADM1 = DATA / "boundaries" / "pak_adm1_gb_simplified.geojson"
FORECAST = DATA / "forecast_model.json"

EPOCH = date(1970, 1, 1)
YM0 = 2000 * 12 + 10  # 2000-11 as year*12 + month-1
KIND = {"native": 0, "terra_scaled": 1, "derived": 2}  # 3 = VIIRS excluded (overlap), 4 = MODIS excluded
SAT = {"Terra": 0, "Aqua": 1, "N": 2, "N20": 3, "N21": 4}
SAT_NAME = {0: "Terra", 1: "Aqua", 2: "S-NPP", 3: "NOAA-20", 4: "NOAA-21"}
MAX_POLY_VERTICES = 2000
CSV_ROW_CAP = 1_000_000


def d2i(d: date) -> int:
    return (d - EPOCH).days


def i2d(i: int) -> date:
    return EPOCH + timedelta(days=int(i))


def ym_label(idx: int) -> str:
    v = YM0 + idx
    return f"{v // 12:04d}-{v % 12 + 1:02d}"


class AOIError(ValueError):
    pass


@dataclass
class AOI:
    key: str
    label: str
    geom: object  # shapely geometry (lon/lat)
    coverage: float  # share of AOI area inside Pakistan (harmonized coverage)


class Store:
    def __init__(self) -> None:
        self.calib = json.loads(CALIB.read_text(encoding="utf-8"))
        con = duckdb.connect()
        df = con.execute(
            f"""SELECT date, acq_time, lat, lon, satellite, quality, static_flag, series_role, sensor,
                       w_modis_eq, w_viirs_eq, frp, daynight
                FROM read_parquet('{PARQUET.as_posix()}') WHERE conf_ok"""
        ).df()
        con.close()
        d = pd.to_datetime(df["date"])
        self.n_rows_total = int(duckdb.sql(f"SELECT count(*) FROM read_parquet('{PARQUET.as_posix()}')").fetchall()[0][0])
        self.lat = df["lat"].to_numpy(np.float64)
        self.lon = df["lon"].to_numpy(np.float64)
        self.day = ((d - pd.Timestamp("1970-01-01")).dt.days).to_numpy(np.int32)
        self.year = d.dt.year.to_numpy(np.int16)
        self.month = d.dt.month.to_numpy(np.int8)
        self.dom = d.dt.day.to_numpy(np.int8)
        self.ym = (self.year.astype(np.int32) * 12 + self.month - 1 - YM0).astype(np.int16)
        self.wm = df["w_modis_eq"].to_numpy(np.float64)
        self.wv = df["w_viirs_eq"].to_numpy(np.float64)
        self.static = df["static_flag"].to_numpy(bool)
        self.nrt = (df["quality"] == "NRT").to_numpy(bool)
        self.sat = df["satellite"].map(SAT).to_numpy(np.int8)
        self.frp = df["frp"].fillna(0).to_numpy(np.float32)
        self.night = (df["daynight"] == "N").to_numpy(bool)
        self.hhmm = df["acq_time"].fillna(0).astype(np.int16).to_numpy()
        role = df["series_role"].map(KIND)
        is_modis = (df["sensor"] == "MODIS").to_numpy()
        kind = role.fillna(-1).to_numpy(np.int8)
        kind[(kind < 0) & ~is_modis] = 3
        kind[(kind < 0) & is_modis] = 4
        self.kind = kind
        series = self.kind <= 2
        self.first_day = int(self.day[series].min())
        self.last_day = int(self.day[series].max())
        self.n_ym = int(self.ym[series].max()) + 1
        self.n_series = int(series.sum())

        # boundaries
        g0 = json.loads(ADM0.read_text(encoding="utf-8"))
        self.pak = unary_union([shape(f["geometry"]) for f in g0["features"]]).buffer(0)
        self.regions: dict[str, dict] = {}
        self.region_code = np.full(len(self.lat), -1, np.int8)
        if ADM1.exists():
            g1 = json.loads(ADM1.read_text(encoding="utf-8"))
            for i, f in enumerate(g1["features"]):
                geom = shape(f["geometry"]).buffer(0)
                iso = f["properties"]["shapeISO"]
                self.regions[iso] = {"code": i, "name": f["properties"]["shapeName"], "geom": geom}
                shapely.prepare(geom)
                minx, miny, maxx, maxy = geom.bounds
                cand = np.flatnonzero((self.lon >= minx) & (self.lon <= maxx) & (self.lat >= miny) & (self.lat <= maxy))
                hit = shapely.contains_xy(geom, self.lon[cand], self.lat[cand])
                self.region_code[cand[hit & (self.region_code[cand] < 0)]] = i
        self._load_notes()
        self.fmodel = json.loads(FORECAST.read_text(encoding="utf-8")) if FORECAST.exists() else None

    # ---------- no-data / outage notes ----------
    def _load_notes(self) -> None:
        nd = pd.read_csv(NO_DATA)
        nd["d"] = pd.to_datetime(nd["date"])
        nd["ymi"] = (nd.d.dt.year * 12 + nd.d.dt.month - 1 - YM0).astype(int)
        # true gaps in the series: Terra 2001 gap (affects_series and MODIS satellite)
        gap = nd[nd.affects_series & nd.satellite.isin(["Terra", "Aqua", "MODIS"])]
        self.gap_days: dict[int, set[int]] = {}
        for _, r in gap.iterrows():
            self.gap_days.setdefault(int(r.ymi), set()).add(d2i(r.d.date()))
        self.notes: dict[int, list[str]] = {}
        for (ymi, sat, status), grp in nd.groupby(["ymi", "satellite", "status"]):
            days = grp.d.dt.date.unique()
            s = str(status)
            if s.startswith("rule:"):
                txt = f"{SAT_NAME.get(SAT.get(sat, -1), sat)}: {len(days)} day(s) with no detections while other VIIRS satellites saw fires; treated as inactive, the other satellites carry the series"
            elif s.startswith("DATA_NOTES"):
                txt = f"MODIS Terra gap ({len(days)} day(s)), no data: the month total is incomplete"
            elif s.startswith("official"):
                txt = f"{s.split(':', 1)[1].strip()}: {len(days)} day(s), flagged"
            else:
                txt = f"{sat}: {s} ({len(days)} day(s))"
            self.notes.setdefault(int(ymi), []).append(txt)

    # ---------- AOI ----------
    def presets(self) -> list[dict]:
        out = [{"key": "pakistan", "label": "Pakistan", "iso": "PAK"}]
        for iso, r in self.regions.items():
            out.append({"key": f"region:{iso}", "label": r["name"], "iso": iso})
        return out

    def preset_geojson(self) -> dict:
        feats = [{"type": "Feature", "properties": {"key": "pakistan", "label": "Pakistan"},
                  "geometry": shapely.geometry.mapping(self.pak.simplify(0.01))}]
        for iso, r in self.regions.items():
            feats.append({"type": "Feature", "properties": {"key": f"region:{iso}", "label": r["name"]},
                          "geometry": shapely.geometry.mapping(r["geom"].simplify(0.005))})
        return {"type": "FeatureCollection", "features": feats}

    def parse_aoi(self, s: str) -> AOI:
        s = (s or "pakistan").strip()
        if s == "pakistan":
            return AOI(s, "Pakistan", self.pak, 1.0)
        if s.startswith("region:"):
            iso = s.split(":", 1)[1]
            if iso not in self.regions:
                raise AOIError(f"unknown region {iso}")
            r = self.regions[iso]
            return AOI(s, r["name"], r["geom"], 1.0)
        nums = lambda t: [float(x) for x in re.split(r"[,\s]+", t.strip()) if x]
        try:
            if s.startswith("bbox:"):
                w, so, e, n = nums(s[5:])
                if not (-180 <= w < e <= 180 and -90 <= so < n <= 90):
                    raise AOIError("bbox must be west,south,east,north with west<east and south<north")
                g = box(w, so, e, n)
                label = f"Box {so:.2f}–{n:.2f}°N, {w:.2f}–{e:.2f}°E"
            elif s.startswith("circle:"):
                lon, lat, km = nums(s[7:])
                if not (0 < km <= 500 and -180 <= lon <= 180 and -90 <= lat <= 90):
                    raise AOIError("circle must be lon,lat,radius_km with 0 < radius <= 500")
                dlat = km / 111.32
                dlon = km / (111.32 * max(math.cos(math.radians(lat)), 1e-6))
                g = shapely.affinity.scale(Point(lon, lat).buffer(1.0, 64), dlon, dlat)
                label = f"{km:g} km around {lat:.3f}°N, {lon:.3f}°E"
            elif s.startswith("poly:"):
                pts = [tuple(nums(p)) for p in s[5:].split(";") if p.strip()]
                if len(pts) < 3 or any(len(p) != 2 for p in pts):
                    raise AOIError("poly needs at least 3 lon,lat pairs separated by ';'")
                if len(pts) > MAX_POLY_VERTICES:
                    raise AOIError(f"poly has more than {MAX_POLY_VERTICES} vertices")
                g = Polygon(pts).buffer(0)
                if g.is_empty or g.area == 0:
                    raise AOIError("polygon is empty or self-intersecting")
                label = "Drawn area"
            else:
                raise AOIError("aoi must be pakistan, region:<ISO>, bbox:w,s,e,n, circle:lon,lat,km or poly:lon,lat;...")
        except (ValueError, TypeError) as ex:
            if isinstance(ex, AOIError):
                raise
            raise AOIError(f"could not parse aoi: {ex}") from None
        cov = float(g.intersection(self.pak).area / g.area) if g.area else 0.0
        return AOI(s, label, g, round(cov, 4))

    @lru_cache(maxsize=96)
    def aoi_mask(self, key: str) -> np.ndarray:
        aoi = self.parse_aoi(key)
        if key == "pakistan":
            return np.ones(len(self.lat), bool)
        if key.startswith("region:"):
            return self.region_code == self.regions[key.split(":", 1)[1]]["code"]
        geom = aoi.geom
        minx, miny, maxx, maxy = geom.bounds
        cand = np.flatnonzero((self.lon >= minx) & (self.lon <= maxx) & (self.lat >= miny) & (self.lat <= maxy))
        m = np.zeros(len(self.lat), bool)
        if key.startswith("bbox:"):
            m[cand] = True
        else:
            shapely.prepare(geom)
            m[cand[shapely.contains_xy(geom, self.lon[cand], self.lat[cand])]] = True
        return m

    # ---------- bands ----------
    def _buckets(self):
        b = self.calib["validation"]["loyo_merged"]["band_by_count"]["buckets"]
        return [(0, 2, b["<2"]), (2, 5, b["2-5"]), (5, 20, b["5-20"]), (20, 100, b["20-100"]),
                (100, 1000, b["100-1000"]), (1000, float("inf"), b[">=1000"])]

    def band_q(self, h: float) -> tuple[float, float]:
        for lo, hi, q in self._buckets():
            if lo <= h < hi:
                return q["q10"], q["q90"]
        return self._buckets()[-1][2]["q10"], self._buckets()[-1][2]["q90"]

    def band(self, h: float, terra: bool = False) -> tuple[float, float]:
        if h <= 0:
            q10, q90 = self.band_q(0)
            return 0.0, float(np.expm1(np.log1p(0) + q90))
        q10, q90 = self.band_q(h)
        if terra:
            t = self.calib["terra_scaling"]["loyo_log1p_residual_quantiles_country_month"]
            q10, q90 = min(q10, t["q10"]), max(q90, t["q90"])
        lh = np.log1p(h)
        return max(0.0, float(np.expm1(lh + q10))), float(np.expm1(lh + q90))

    # ---------- calendar ----------
    def calendar(self, aoi_key: str, d_from: date | None, d_to: date | None,
                 include_static: bool = False, unit: str = "modis") -> dict:
        aoi = self.parse_aoi(aoi_key)
        mask = self.aoi_mask(aoi.key)
        f = max(d2i(d_from), self.first_day) if d_from else self.first_day
        t = min(d2i(d_to), self.last_day) if d_to else self.last_day
        if f > t:
            raise AOIError("empty date range (data covers %s to %s)" % (i2d(self.first_day), i2d(self.last_day)))
        base = mask & (self.kind <= 2)
        if not include_static:
            base &= ~self.static
        sel = base & (self.day >= f) & (self.day <= t)
        w = self.wm if unit == "modis" else self.wv
        n = self.n_ym
        parts_m = np.zeros((3, n)); parts_u = np.zeros((3, n))
        for k in range(3):
            s = sel & (self.kind == k)
            parts_m[k] = np.bincount(self.ym[s], weights=self.wm[s], minlength=n)[:n]
            parts_u[k] = np.bincount(self.ym[s], weights=w[s], minlength=n)[:n]
        npts = np.bincount(self.ym[sel], minlength=n)[:n]
        nrt = np.bincount(self.ym[sel & self.nrt], minlength=n)[:n]
        ym_f = (i2d(f).year * 12 + i2d(f).month - 1) - YM0
        ym_t = (i2d(t).year * 12 + i2d(t).month - 1) - YM0
        months = []
        for i in range(ym_f, ym_t + 1):
            v = float(parts_u[:, i].sum())
            lo = hi = 0.0
            for k in range(3):
                pm, pu = parts_m[k, i], parts_u[k, i]
                if pm <= 0:
                    continue
                if k == 0:
                    lo += pu; hi += pu
                else:
                    blo, bhi = self.band(pm, terra=(k == 1))
                    lo += blo * pu / pm; hi += bhi * pu / pm
            roles = [name for name, k in KIND.items() if parts_m[k, i] > 0]
            if not roles and self._era(i) != "native":
                hi = self.band(0)[1]  # zero predicted: the band still allows a few detections
            y, mo = divmod(YM0 + i, 12)
            m_start = date(y, mo + 1, 1)
            m_end = (date(y + (mo + 1) // 12, (mo + 1) % 12 + 1, 1) - timedelta(days=1))
            cov_f, cov_t = max(d2i(m_start), f), min(d2i(m_end), t)
            gap = len([d for d in self.gap_days.get(i, ()) if cov_f <= d <= cov_t])
            role = roles[0] if len(roles) == 1 else ("mixed" if roles else self._era(i))
            months.append({
                "ym": ym_label(i), "year": y, "month": mo + 1,
                "value": round(float(v), 3), "lo": round(float(lo), 3), "hi": round(float(hi), 3),
                "role": role, "provisional": bool(nrt[i] > 0), "n_detections": int(npts[i]),
                "days_covered": int(cov_t - cov_f + 1), "days_in_month": m_end.day,
                "gap_days": gap, "notes": self.notes.get(i, []),
            })
        self._add_cell_anomalies(months)
        stats = self._stats(months)
        anomaly = self._window_anomaly(base, w, t)
        return {
            "aoi": {"key": aoi.key, "label": aoi.label, "coverage_pakistan": aoi.coverage,
                    "bounds": [round(x, 4) for x in aoi.geom.bounds]},
            "range": {"from": str(i2d(f)), "to": str(i2d(t))},
            "data_extent": {"from": str(i2d(self.first_day)), "to": str(i2d(self.last_day))},
            "unit": unit, "include_static": include_static,
            "unit_label": "MODIS-equivalent detections (Terra+Aqua)" if unit == "modis" else "VIIRS-equivalent detections (S-NPP 375 m)",
            "months": months, "stats": stats, "anomaly": anomaly,
        }

    def _era(self, i: int) -> str:
        v = YM0 + i
        first = date(v // 12, v % 12 + 1, 1)
        if first < date(2002, 7, 6):
            return "terra_scaled"
        return "native" if first < date(2022, 10, 1) else "derived"

    def _add_cell_anomalies(self, months: list[dict]) -> None:
        by_m: dict[int, list[dict]] = {}
        for m in months:
            if m["days_covered"] == m["days_in_month"] and m["gap_days"] == 0:
                by_m.setdefault(m["month"], []).append(m)
        for m in months:
            others = [o["value"] for o in by_m.get(m["month"], []) if o is not m]
            m["baseline_n"] = len(others)
            if len(others) < 5 or m["days_covered"] != m["days_in_month"]:
                m["pct"] = m["ratio"] = m["diff"] = m["median"] = None
                continue
            arr = np.array(others)
            med = float(np.median(arr))
            m["median"] = round(med, 3)
            m["pct"] = round(float(((arr < m["value"]).sum() + 0.5 * (arr == m["value"]).sum()) / len(arr) * 100), 1)
            m["ratio"] = round(m["value"] / med, 3) if med >= 5 else None
            m["diff"] = round(m["value"] - med, 3)

    def _stats(self, months: list[dict]) -> dict:
        total = sum(m["value"] for m in months)
        tot_lo = sum(m["lo"] for m in months); tot_hi = sum(m["hi"] for m in months)
        years: dict[int, list[dict]] = {}
        for m in months:
            years.setdefault(m["year"], []).append(m)
        complete = {y: ms for y, ms in years.items()
                    if len(ms) == 12 and all(x["days_covered"] == x["days_in_month"] and x["gap_days"] == 0 for x in ms)}
        yearly = [{"year": y, "value": round(sum(x["value"] for x in ms), 2),
                   "lo": round(sum(x["lo"] for x in ms), 2), "hi": round(sum(x["hi"] for x in ms), 2),
                   "provisional": any(x["provisional"] for x in ms)} for y, ms in sorted(complete.items())]
        out: dict = {"total": round(total, 2), "total_lo": round(tot_lo, 2), "total_hi": round(tot_hi, 2),
                     "complete_years": len(yearly), "yearly": yearly}
        if yearly:
            srt = sorted(yearly, key=lambda r: -r["value"])
            top = srt[0]
            clear = len(srt) == 1 or top["lo"] > srt[1]["hi"]
            out["worst_year"] = {"year": top["year"], "value": top["value"], "clear": bool(clear),
                                 "wording": "the highest" if clear else "among the highest (within the uncertainty band of the next year)",
                                 "runner_up": srt[1]["year"] if len(srt) > 1 else None}
            # peak calendar month: highest median across complete years
            med = []
            for mo in range(1, 13):
                vals = [x["value"] for ms in complete.values() for x in ms if x["month"] == mo]
                med.append(float(np.median(vals)) if vals else 0.0)
            ann = sum(med)
            pk = int(np.argmax(med)) + 1
            out["climatology"] = [{"month": i + 1, "median": round(v, 2)} for i, v in enumerate(med)]
            out["peak_month"] = {"month": pk, "median": round(med[pk - 1], 2),
                                 "share_pct": round(med[pk - 1] / ann * 100, 1) if ann > 0 else None}
            out["trend"] = self._trend(yearly)
        return out

    def _trend(self, yearly: list[dict]) -> dict | None:
        if len(yearly) < 8:
            return None
        x = np.array([r["year"] for r in yearly], float)
        y = np.log1p(np.array([r["value"] for r in yearly], float))
        n = len(x)
        slopes = [(y[j] - y[i]) / (x[j] - x[i]) for i in range(n) for j in range(i + 1, n)]
        b = float(np.median(slopes))
        s = sum(np.sign(y[j] - y[i]) for i in range(n) for j in range(i + 1, n))
        var = n * (n - 1) * (2 * n + 5) / 18
        z = (s - np.sign(s)) / math.sqrt(var) if s != 0 else 0.0
        p = math.erfc(abs(z) / math.sqrt(2))
        change = math.expm1(b * (x[-1] - x[0]))
        med = float(np.median(np.expm1(y)))
        q10, q90 = self.band_q(med)
        half = (math.expm1(q90) - math.expm1(q10)) / 2
        claim = p < 0.05 and abs(change) > half
        return {"years": [int(x[0]), int(x[-1])], "pct_per_year": round(math.expm1(b) * 100, 2),
                "total_change_pct": round(change * 100, 1), "mann_kendall_p": round(p, 4),
                "band_halfwidth_pct": round(half * 100, 1), "claim": bool(claim),
                "method": "Theil-Sen slope on log1p(yearly total), Mann-Kendall test (normal approx.); a trend is claimed only if p<0.05 and the fitted change exceeds the 80% band half-width"}

    def _window_anomaly(self, base: np.ndarray, w: np.ndarray, t: int) -> dict | None:
        """Latest (partial) month vs the same day window in every earlier year."""
        end = i2d(t)
        mo, dd = end.month, end.day
        s = base & (self.month == mo) & (self.dom <= dd)
        yrs = np.bincount(self.year[s] - 2000, weights=w[s], minlength=end.year - 2000 + 1)
        cur = float(yrs[end.year - 2000])
        rows = []
        for y in range(2000, end.year):
            first = date(y, mo, 1)
            if d2i(first) < self.first_day:
                continue
            ymi = y * 12 + mo - 1 - YM0
            if any(d2i(first) <= g <= d2i(date(y, mo, dd)) for g in self.gap_days.get(ymi, ())):
                continue
            rows.append({"year": y, "value": round(float(yrs[y - 2000]), 3)})
        if len(rows) < 5:
            return None
        arr = np.array([r["value"] for r in rows])
        med = float(np.median(arr))
        lo, hi = self.band(cur)
        pct = float(((arr < cur).sum() + 0.5 * (arr == cur).sum()) / len(arr) * 100)
        rank = int((arr > cur).sum()) + 1
        return {"month": mo, "year": end.year, "window": f"{mo:02d}-01..{mo:02d}-{dd:02d}",
                "value": round(cur, 3), "lo": round(lo, 3), "hi": round(hi, 3),
                "baseline_years": [rows[0]["year"], rows[-1]["year"]], "baseline_n": len(rows),
                "median": round(med, 3), "pct": round(pct, 1), "rank": rank, "of": len(rows) + 1,
                "ratio": round(cur / med, 3) if med >= 5 else None, "diff": round(cur - med, 3),
                "provisional": True, "series": rows,
                "note": "Same day window in every year (partial month). Current values come from NRT data and are provisional."}

    # ---------- overlap / drift check ----------
    def overlap(self, aoi_key: str, include_static: bool = False) -> dict:
        mask = self.aoi_mask(self.parse_aoi(aoi_key).key)
        if not include_static:
            mask = mask & ~self.static
        n = self.n_ym
        cut = d2i(date(2022, 10, 1))
        def agg(sel):
            return np.bincount(self.ym[sel], weights=self.wm[sel], minlength=n)[:n]
        modis_obs = agg(mask & (self.kind == 0))
        viirs_derived_pre = agg(mask & (self.kind == 3) & (self.day < cut))
        derived = agg(mask & (self.kind == 2))
        post = mask & (self.kind == 4) & (self.day >= cut)
        terra_post = agg(post & (self.sat == 0)); aqua_post = agg(post & (self.sat == 1))
        out = []
        for i in range(n):
            y, mo = divmod(YM0 + i, 12)
            if y < 2012:
                continue
            out.append({"ym": ym_label(i), "modis_observed": round(float(modis_obs[i] + terra_post[i] + aqua_post[i]), 2),
                        "viirs_derived": round(float(viirs_derived_pre[i] + derived[i]), 2),
                        "terra": round(float(terra_post[i]), 2) if i >= (2022 * 12 + 9 - YM0) else None,
                        "aqua": round(float(aqua_post[i]), 2) if i >= (2022 * 12 + 9 - YM0) else None,
                        "fit_window": (y, mo + 1) < (2022, 10)})
        return {"months": out, "note": "2012-01..2022-09: MODIS observed vs VIIRS-derived MODIS-equivalent (the fit window, in-sample). From 2022-10 MODIS is not used in the series because of orbital drift; it is shown as a drift check only."}

    # ---------- one month of series points for the map ----------
    def points(self, aoi_key: str, ym: str, include_static: bool = False, limit: int = 40000) -> dict:
        m = re.fullmatch(r"(\d{4})-(\d{2})", ym or "")
        if not m:
            raise AOIError("ym must be YYYY-MM")
        i = int(m.group(1)) * 12 + int(m.group(2)) - 1 - YM0
        aoi = self.parse_aoi(aoi_key)
        sel = self.aoi_mask(aoi.key) & (self.kind <= 2) & (self.ym == i)
        if not include_static:
            sel &= ~self.static
        idx = np.flatnonzero(sel)
        n = len(idx)
        if n > limit:  # keep the heaviest weights so the map shows what drives the total
            idx = idx[np.argsort(-self.wm[idx])[:limit]]
        return {"ym": ym, "n": int(n), "truncated": bool(n > limit),
                "fields": ["lon", "lat", "w_modis_eq", "sat", "nrt", "date", "hhmm", "frp", "night"],
                "points": [[round(float(self.lon[j]), 4), round(float(self.lat[j]), 4), round(float(self.wm[j]), 4),
                            SAT_NAME[int(self.sat[j])], bool(self.nrt[j]), str(i2d(int(self.day[j]))), int(self.hhmm[j]),
                            round(float(self.frp[j]), 1), bool(self.night[j])] for j in idx]}

    # ---------- density grid over a date range (map overview) ----------
    def grid(self, aoi_key: str, d_from: date | None, d_to: date | None, include_static: bool = False,
             res: float = 0.1) -> dict:
        aoi = self.parse_aoi(aoi_key)
        f = max(d2i(d_from), self.first_day) if d_from else self.first_day
        t = min(d2i(d_to), self.last_day) if d_to else self.last_day
        sel = self.aoi_mask(aoi.key) & (self.kind <= 2) & (self.day >= f) & (self.day <= t)
        if not include_static:
            sel &= ~self.static
        ix = np.floor(self.lon[sel] / res).astype(np.int64)
        iy = np.floor(self.lat[sel] / res).astype(np.int64)
        key = (ix + 100_000) * 1_000_000 + (iy + 100_000)
        uk, inv = np.unique(key, return_inverse=True)
        w = np.bincount(inv, weights=self.wm[sel])
        n = np.bincount(inv)
        cx = (uk // 1_000_000 - 100_000 + 0.5) * res
        cy = (uk % 1_000_000 - 100_000 + 0.5) * res
        order = np.argsort(-w)
        cells = [[round(float(cx[k]), 4), round(float(cy[k]), 4), round(float(w[k]), 3), int(n[k])] for k in order]
        return {"aoi": aoi.key, "from": str(i2d(f)), "to": str(i2d(t)), "res": res,
                "fields": ["lon", "lat", "w_modis_eq", "n_detections"], "total": round(float(w.sum()), 2),
                "cells": cells}

    # ---------- per-province value + percentile (choropleth) ----------
    def region_stats(self, d_from: date | None, d_to: date | None, ym: str | None,
                     include_static: bool = False) -> dict:
        """ym given: each province's value for that month (same day window if the month is partial) against the
        same window in every earlier complete year. Otherwise: totals and shares over the date range."""
        base = (self.kind <= 2) & (self.region_code >= 0)
        if not include_static:
            base &= ~self.static
        R = len(self.regions)
        names = {r["code"]: (iso, r["name"]) for iso, r in self.regions.items()}
        out = []
        if ym:
            m = re.fullmatch(r"(\d{4})-(\d{2})", ym)
            if not m:
                raise AOIError("ym must be YYYY-MM")
            y, mo = int(m.group(1)), int(m.group(2))
            m_first = date(y, mo, 1)
            if d2i(m_first) > self.last_day or d2i(m_first) < self.first_day:
                raise AOIError("month outside the data range")
            m_last = date(y + mo // 12, mo % 12 + 1, 1) - timedelta(days=1)
            dd = min(m_last, i2d(self.last_day)).day
            s = base & (self.month == mo) & (self.dom <= dd)
            ny = y - 2000 + 1
            mat = np.bincount(self.region_code[s].astype(np.int64) * ny + (self.year[s].astype(np.int64) - 2000),
                              weights=self.wm[s], minlength=R * ny)[:R * ny].reshape(R, ny)
            ok_years = []
            for yy in range(2000, y):
                first = date(yy, mo, 1)
                if d2i(first) < self.first_day:
                    continue
                ymi = yy * 12 + mo - 1 - YM0
                if any(d2i(first) <= g <= d2i(date(yy, mo, dd)) for g in self.gap_days.get(ymi, ())):
                    continue
                ok_years.append(yy)
            for c in range(R):
                iso, name = names[c]
                v = float(mat[c, y - 2000])
                arr = np.array([mat[c, yy - 2000] for yy in ok_years])
                row = {"key": f"region:{iso}", "label": name, "value": round(v, 2)}
                if len(arr) >= 5:
                    med = float(np.median(arr))
                    row.update(median=round(med, 2),
                               pct=round(float(((arr < v).sum() + 0.5 * (arr == v).sum()) / len(arr) * 100), 1),
                               ratio=round(v / med, 3) if med >= 5 else None,
                               rank=int((arr > v).sum()) + 1, of=len(arr) + 1)
                else:
                    row.update(median=None, pct=None, ratio=None, rank=None, of=None)
                out.append(row)
            return {"mode": "month", "ym": ym, "window": f"{mo:02d}-01..{mo:02d}-{dd:02d}",
                    "partial": dd < m_last.day,
                    "baseline_years": [ok_years[0], ok_years[-1]] if ok_years else None,
                    "provisional": bool((self.nrt & s & (self.year == y)).any()), "regions": out}
        f = max(d2i(d_from), self.first_day) if d_from else self.first_day
        t = min(d2i(d_to), self.last_day) if d_to else self.last_day
        s = base & (self.day >= f) & (self.day <= t)
        v = np.bincount(self.region_code[s], weights=self.wm[s], minlength=R)
        tot = float(v.sum()) or 1.0
        for c in range(R):
            iso, name = names[c]
            out.append({"key": f"region:{iso}", "label": name, "value": round(float(v[c]), 2),
                        "share_pct": round(float(v[c]) / tot * 100, 1)})
        return {"mode": "range", "from": str(i2d(f)), "to": str(i2d(t)), "regions": out}

    # ---------- daily values within one month (day / night overpasses) ----------
    def daily(self, aoi_key: str, ym: str, include_static: bool = False) -> dict:
        m = re.fullmatch(r"(\d{4})-(\d{2})", ym or "")
        if not m:
            raise AOIError("ym must be YYYY-MM")
        y, mo = int(m.group(1)), int(m.group(2))
        i = y * 12 + mo - 1 - YM0
        sel = self.aoi_mask(self.parse_aoi(aoi_key).key) & (self.kind <= 2) & (self.ym == i)
        if not include_static:
            sel &= ~self.static
        nd = (date(y + mo // 12, mo % 12 + 1, 1) - timedelta(days=1)).day
        sd, sn = sel & ~self.night, sel & self.night
        day = np.bincount(self.dom[sd], weights=self.wm[sd], minlength=nd + 1)[1:nd + 1]
        night = np.bincount(self.dom[sn], weights=self.wm[sn], minlength=nd + 1)[1:nd + 1]
        gaps = {i2d(g).day for g in self.gap_days.get(i, ())}
        last = i2d(self.last_day)
        days = []
        for k in range(nd):
            dt = date(y, mo, k + 1)
            days.append({"date": str(dt), "day": round(float(day[k]), 3), "night": round(float(night[k]), 3),
                         "no_data": (k + 1) in gaps, "future": dt > last})
        return {"ym": ym, "days": days, "notes": self.notes.get(i, [])}

    # ---------- PERS forecast (pipeline/forecast_fit.py -> data/forecast_model.json) ----------
    def forecast(self, aoi_key: str, include_static: bool = False) -> dict:
        if not self.fmodel:
            raise AOIError("forecast model not built (run pipeline/forecast_fit.py)")
        fm = self.fmodel
        cal = self.calendar(aoi_key, None, None, include_static, "modis")
        ms = cal["months"]
        last = max(i for i, m in enumerate(ms) if m["days_covered"] == m["days_in_month"])
        vals = np.array([m["value"] for m in ms[:last + 1]], float)
        L = np.log1p(vals)[None, :]
        t0 = len(vals) - 1
        co = {int(h): np.array([c["b0"], c["b_last_month"], c["b_last_12_months"]]) for h, c in fm["coefficients"].items()}
        mu = fc.point_log(L, t0, co)[0]
        bands = fm["band_by_count"]
        y0, m0 = ms[last]["year"], ms[last]["month"]
        out = []
        for h in range(1, fc.H + 1):
            tt = t0 + h
            yy, mm = y0 + (m0 - 1 + h) // 12, (m0 - 1 + h) % 12 + 1
            idx = fc.same_moy_prior(tt, t0)
            hist = vals[idx]
            clim_med = float(np.median(hist))
            b = bands[fc.bucket(float(np.expm1(mu[h - 1])))]
            pt = float(np.expm1(mu[h - 1]))
            row = {"ym": f"{yy:04d}-{mm:02d}", "h": h, "value": round(pt, 2),
                   "lo": round(max(0.0, float(np.expm1(mu[h - 1] + b["q10"]))), 2),
                   "hi": round(float(np.expm1(mu[h - 1] + b["q90"])), 2),
                   "typical_median_10y": round(clim_med, 2),
                   "vs_typical_pct": round((pt / clim_med - 1) * 100, 1) if clim_med >= 5 else None}
            row["last_10_years"] = [{"year": int(yy - 1 - k), "value": round(float(vals[i]), 2)} for k, i in enumerate(idx)]
            if tt < len(ms):  # partially observed already (current month)
                o = ms[tt]
                row["observed_so_far"] = {"value": o["value"], "days": o["days_covered"], "of": o["days_in_month"],
                                          "provisional": o["provisional"]}
            out.append(row)
        # typical year beyond the forecast horizon (NOT a forecast): last 10 complete years per calendar month
        typical = []
        for mo in range(1, 13):
            v = [m["value"] for m in ms[:last + 1] if m["month"] == mo and m["gap_days"] == 0][-fc.CLIM_K:]
            a = np.array(v, float)
            typical.append({"month": mo, "median": round(float(np.median(a)), 2),
                            "low_q10": round(float(np.quantile(a, 0.1)), 2), "high_q90": round(float(np.quantile(a, 0.9)), 2),
                            "years": len(v)})
        a1 = float(L[0, t0] - fc.clim_log(L, t0, t0 - 1)[0])
        a12 = float(np.mean([L[0, t0 - j] - fc.clim_log(L, t0 - j, t0 - j - 1)[0] for j in range(12)]))
        sk = fm["validation"]["skill"]
        return {
            "aoi": cal["aoi"], "unit_label": cal["unit_label"], "issued_from": ms[last]["ym"],
            "method": fm["method"], "months": out, "typical_year": typical,
            "drivers": {"last_month_vs_typical_pct": round(math.expm1(a1) * 100, 1),
                        "last_12_months_vs_typical_pct": round(math.expm1(a12) * 100, 1)},
            "skill": {"country_h1": sk["country_h1"], "cell1_h1": sk["cell1_h1"], "country_h3": sk["country_h3"],
                      "cell1_h3": sk["cell1_h3"]},
            "coverage": fm["validation"]["crossfit_coverage_by_level_h"],
            "provisional": any(m["provisional"] for m in ms[max(0, last - 2):last + 1]),
            "notes": ["Forecast = the usual level for that month (last 10 years) nudged by how unusual the last month and "
                      "last 12 months were. Beyond 3 months only the typical range is shown; it is not a forecast.",
                      fm["validation"]["caveat"]],
        }

    # ---------- place summary for a coordinate (AI assistant tool) ----------
    def place(self, lat: float, lon: float, radius_km: float = 25.0) -> dict:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise AOIError("bad coordinate")
        radius_km = float(min(max(radius_km, 5.0), 100.0))
        pt = Point(lon, lat)
        prov = next(({"key": f"region:{iso}", "name": r["name"]} for iso, r in self.regions.items()
                     if r["geom"].contains(pt)), None)
        inside = bool(self.pak.contains(pt))
        key = f"circle:{lon:.4f},{lat:.4f},{radius_km:g}"
        cal = self.calendar(key, None, None)
        st = cal["stats"]
        m = self.aoi_mask(key) & (self.kind <= 2) & ~self.static
        n = int(m.sum())
        hours = np.bincount((self.hhmm[m] // 100).astype(np.int64), minlength=24) if n else np.zeros(24)
        recent = [x for x in cal["months"] if x["value"] > 0][-3:]
        return {
            "lat": lat, "lon": lon, "radius_km": radius_km, "inside_pakistan": inside, "province": prov,
            "aoi_key": key, "harmonized_coverage_share": cal["aoi"]["coverage_pakistan"],
            "total_since_2000": st["total"], "peak_month": st.get("peak_month"), "climatology": st.get("climatology"),
            "worst_year": st.get("worst_year"), "trend": st.get("trend"),
            "yearly_last_10": st["yearly"][-10:],
            "night_share_pct": round(float(self.night[m].mean() * 100), 1) if n else None,
            "median_frp_mw": round(float(np.median(self.frp[m])), 1) if n else None,
            "busiest_utc_hours": [int(h) for h in np.argsort(-hours)[:3]] if n else [],
            "static_sources_masked": int((self.aoi_mask(key) & self.static).sum()),
            "latest_active_months": [{"ym": x["ym"], "value": x["value"], "provisional": x["provisional"]} for x in recent],
            "current_month_anomaly": {k: v for k, v in (cal["anomaly"] or {}).items() if k != "series"} or None,
        }

    # ---------- hotspots CSV ----------
    def hotspots_frame(self, aoi_key: str, d_from: date | None, d_to: date | None,
                       include_static: bool, series_only: bool) -> pd.DataFrame:
        aoi = self.parse_aoi(aoi_key)
        minx, miny, maxx, maxy = aoi.geom.bounds
        f = d_from or i2d(self.first_day); t = d_to or i2d(self.last_day)
        where = [f"date BETWEEN DATE '{f}' AND DATE '{t}'",
                 f"lon BETWEEN {minx} AND {maxx}", f"lat BETWEEN {miny} AND {maxy}"]
        if series_only:
            where.append("conf_ok AND series_role <> 'excluded'")
            if not include_static:
                where.append("NOT static_flag")
        q = f"""SELECT date, acq_time, satellite, sensor, quality, version, lat, lon, daynight, frp, conf, type,
                       conf_ok, static_flag, series_role, round(w_modis_eq, 6) AS w_modis_eq, round(w_viirs_eq, 6) AS w_viirs_eq
                FROM read_parquet('{PARQUET.as_posix()}') WHERE {' AND '.join(where)} ORDER BY date, acq_time"""
        df = duckdb.sql(q).df()
        if aoi.key not in ("pakistan",) and not aoi.key.startswith("bbox:") and len(df):
            g = aoi.geom
            shapely.prepare(g)
            df = df[shapely.contains_xy(g, df["lon"].to_numpy(), df["lat"].to_numpy())]
        return df


_store: Store | None = None


def store() -> Store:
    global _store
    if _store is None:
        _store = Store()
    return _store
