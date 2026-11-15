"""Aatish API (FastAPI). Run from the repo root:
    py -3.14 -E -P -m uvicorn api.main:app --port 8000
Env: FIRMS_MAP_KEY (only for /api/current), AI_STUDIO (Gemini key, only for /api/ask),
FC_CORS_ORIGINS (comma list, default *).
"""
from __future__ import annotations

import csv
import io
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import ask as ai
from .core import CSV_ROW_CAP, AOIError, store

@asynccontextmanager
async def lifespan(_app):
    store()  # load the parquet once at startup
    yield


app = FastAPI(
    lifespan=lifespan,
    title="Aatish API",
    version="1.0.0",
    description="Harmonized MODIS + VIIRS hotspot calendar for Pakistan (NASA Space Apps 2026, team Aero Snipers). "
                "Unit: MODIS-equivalent detections. Method: docs/plan.md §3.",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("FC_CORS_ORIGINS", "*").split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

Unit = Literal["modis", "viirs"]
CACHE_HDR = {"Cache-Control": "public, max-age=3600"}


def _bad(ex: Exception):
    raise HTTPException(status_code=400, detail=str(ex))


def _dates(d_from: date | None, d_to: date | None):
    if d_from and d_to and d_from > d_to:
        raise HTTPException(400, "'from' is after 'to'")
    return d_from, d_to


@app.get("/api/health")
def health():
    s = store()
    return {"ok": True, "rows": s.n_rows_total, "series_rows": s.n_series,
            "data_to": str(date(1970, 1, 1) + timedelta(days=s.last_day))}


@app.get("/api/meta")
def meta():
    s = store()
    c = s.calib
    v = c["validation"]
    return JSONResponse({
        "data_extent": {"from": str(date(1970, 1, 1) + timedelta(days=s.first_day)),
                        "to": str(date(1970, 1, 1) + timedelta(days=s.last_day))},
        "rows_total": s.n_rows_total, "series_rows": s.n_series,
        "unit": c["unit"], "method": c["method"], "series": c["series"], "fit_window": c["fit_window"],
        "filters": c["filters"], "presets": s.presets(),
        "validation": {
            "loyo_country_month": v["loyo_merged"]["country_month"],
            "loyo_cell1_month": v["loyo_merged"]["cell1_month"],
            "forward": v.get("forward_2012-2017_to_2018-2022"),
            "n20_transfer_with_f_sat": v.get("n20_transfer_with_f_sat"),
            "anomaly_skill": v["loyo_merged"]["anomaly_skill_country_month"],
            "noise_floor_terra_vs_aqua_anomaly_corr": v.get("noise_floor_terra_vs_aqua_anomaly_corr"),
        },
    }, headers=CACHE_HDR)


@app.get("/api/regions.geojson")
def regions():
    return JSONResponse(store().preset_geojson(), headers=CACHE_HDR)


@app.get("/api/calendar")
def calendar(aoi: str = "pakistan", d_from: date | None = Query(None, alias="from"),
             d_to: date | None = Query(None, alias="to"), static: bool = False, unit: Unit = "modis"):
    d_from, d_to = _dates(d_from, d_to)
    try:
        return JSONResponse(store().calendar(aoi, d_from, d_to, static, unit), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


@app.get("/api/overlap")
def overlap(aoi: str = "pakistan", static: bool = False):
    try:
        return JSONResponse(store().overlap(aoi, static), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


@app.get("/api/points")
def points(aoi: str = "pakistan", ym: str = Query(..., description="YYYY-MM"), static: bool = False):
    try:
        return JSONResponse(store().points(aoi, ym, static), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


@app.get("/api/grid")
def grid(aoi: str = "pakistan", d_from: date | None = Query(None, alias="from"),
         d_to: date | None = Query(None, alias="to"), static: bool = False,
         res: Literal["0.05", "0.1", "0.25", "0.5"] = "0.1"):
    """Density grid of the harmonized series (sum of w_modis_eq per cell) for the map overview."""
    d_from, d_to = _dates(d_from, d_to)
    try:
        return JSONResponse(store().grid(aoi, d_from, d_to, static, float(res)), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


@app.get("/api/regions/stats")
def region_stats(ym: str | None = Query(None, description="YYYY-MM; omit for range totals"),
                 d_from: date | None = Query(None, alias="from"), d_to: date | None = Query(None, alias="to"),
                 static: bool = False):
    """Per-province value; with ym also the percentile against the same month (same day window) in earlier years."""
    d_from, d_to = _dates(d_from, d_to)
    try:
        return JSONResponse(store().region_stats(d_from, d_to, ym, static), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


@app.get("/api/daily")
def daily(aoi: str = "pakistan", ym: str = Query(..., description="YYYY-MM"), static: bool = False):
    try:
        return JSONResponse(store().daily(aoi, ym, static), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


@app.get("/api/forecast")
def forecast(aoi: str = "pakistan", static: bool = False):
    """PERS forecast for the next 1-3 months after the last complete month, 80% band, plus the typical year."""
    try:
        return JSONResponse(store().forecast(aoi, static), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


@app.get("/api/place")
def place(lat: float, lon: float, radius_km: float = Query(25, ge=5, le=100)):
    """Fire profile around a coordinate (province, season, worst year, trend, recent activity)."""
    try:
        return JSONResponse(store().place(lat, lon, radius_km), headers=CACHE_HDR)
    except AOIError as ex:
        _bad(ex)


class AskTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=4000)


class AskBody(BaseModel):
    question: str = Field(min_length=1, max_length=600)
    history: list[AskTurn] = Field(default_factory=list, max_length=12)
    view: dict | None = None  # {aoi, aoi_label, ym, page} from the explorer


@app.post("/api/ask")
async def ask(body: AskBody, request: Request):
    """'Ask anything' assistant (Gemini + read-only tools over this API). Streams NDJSON events:
    {type: tool|retry|text|done|error}."""
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    msg = ai.allow(ip)
    if msg:
        raise HTTPException(429, msg)
    view = {k: str(v)[:4000] for k, v in (body.view or {}).items() if k in ("aoi", "aoi_label", "ym", "page") and v}

    async def gen():
        async for ev in ai.answer(body.question.strip(), [t.model_dump() for t in body.history], view):
            if not os.environ.get("FC_AI_DEBUG"):
                ev.pop("detail", None)
            yield json.dumps(ev, ensure_ascii=False) + "\n"
    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store"})


@app.get("/api/calibration")
def calibration():
    c = store().calib
    keep = ["unit", "method", "fit_window", "excluded_windows", "filters", "match_radius_km", "shrinkage_k",
            "frp_bins_mw", "P_aqua", "P_aqua_n", "f", "f_sat", "frp_scale", "frp_scale_note", "terra_scaling",
            "series", "validation"]
    return JSONResponse({k: c[k] for k in keep if k in c}, headers=CACHE_HDR)


def _stream_csv(df, filename: str, header_lines: list[str]):
    def gen():
        for line in header_lines:
            yield f"# {line}\n"
        yield df.iloc[:0].to_csv(index=False)
        for i in range(0, len(df), 50_000):
            yield df.iloc[i:i + 50_000].to_csv(index=False, header=False)
    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/hotspots.csv")
def hotspots_csv(aoi: str = "pakistan", d_from: date | None = Query(None, alias="from"),
                 d_to: date | None = Query(None, alias="to"), static: bool = False, series_only: bool = True):
    d_from, d_to = _dates(d_from, d_to)
    try:
        df = store().hotspots_frame(aoi, d_from, d_to, static, series_only)
    except AOIError as ex:
        _bad(ex)
    if len(df) > CSV_ROW_CAP:
        raise HTTPException(413, f"{len(df):,} rows; the limit is {CSV_ROW_CAP:,}. Narrow the area or the date range.")
    df["date"] = df["date"].astype(str)
    hdr = [f"Aatish hotspots, aoi={aoi}, from={d_from or 'start'}, to={d_to or 'end'}, series_only={series_only}, include_static={static}",
           "Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m S-NPP/NOAA-20/NOAA-21). NRT rows (quality=NRT) are provisional.",
           "w_modis_eq: harmonized weight; the main series is SUM(w_modis_eq) over rows with series_role<>'excluded' and not static_flag."]
    return _stream_csv(df, f"aatish_hotspots_{date.today()}.csv", hdr)


@app.get("/api/monthly.csv")
def monthly_csv(aoi: str = "pakistan", d_from: date | None = Query(None, alias="from"),
                d_to: date | None = Query(None, alias="to"), static: bool = False, unit: Unit = "modis"):
    d_from, d_to = _dates(d_from, d_to)
    try:
        res = store().calendar(aoi, d_from, d_to, static, unit)
    except AOIError as ex:
        _bad(ex)
    buf = io.StringIO()
    buf.write(f"# Aatish monthly table, aoi={res['aoi']['label']} ({aoi}), unit={res['unit_label']}, include_static={static}\n")
    buf.write("# lo/hi = 80% prediction band (derived/Terra-scaled months); pct = percentile vs the same month in other complete years; NRT months are provisional\n")
    cols = ["ym", "value", "lo", "hi", "role", "provisional", "n_detections", "days_covered", "gap_days", "median", "pct", "ratio", "diff"]
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(cols)
    for m in res["months"]:
        w.writerow([m.get(c) for c in cols])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="aatish_monthly_{date.today()}.csv"'})


# ---------- live NRT for any AOI worldwide (raw counts, not harmonized) ----------
FIRMS_SOURCES = {"VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"}
_live_cache: dict[str, tuple[float, str]] = {}
LIVE_TTL = 900


async def _firms_chunk(client: httpx.AsyncClient, key: str, src: str, bbox: str, span: int, start: date) -> str:
    ck = f"{src}|{bbox}|{span}|{start}"
    hit = _live_cache.get(ck)
    if hit and time.time() - hit[0] < LIVE_TTL:
        return hit[1]
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/{bbox}/{span}/{start.isoformat()}"
    try:
        r = await client.get(url, timeout=httpx.Timeout(60, connect=15))
    except httpx.HTTPError as ex:
        raise HTTPException(502, f"FIRMS is unreachable from the server right now ({type(ex).__name__}); try again later")
    if r.status_code != 200 or not r.text.startswith("latitude"):
        raise HTTPException(502, f"FIRMS returned {r.status_code}: {r.text[:120]}")
    _live_cache[ck] = (time.time(), r.text)
    return r.text


@app.get("/api/current")
async def current(bbox: str = Query(..., description="west,south,east,north"),
                  source: str = "VIIRS_NOAA20_NRT", days: int = Query(10, ge=1, le=31)):
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        raise HTTPException(503, "live FIRMS lookups are not configured on this server (FIRMS_MAP_KEY missing)")
    if source not in FIRMS_SOURCES:
        raise HTTPException(400, f"source must be one of {sorted(FIRMS_SOURCES)}")
    try:
        w, s, e, n = [float(x) for x in bbox.split(",")]
    except ValueError:
        raise HTTPException(400, "bbox must be west,south,east,north")
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise HTTPException(400, "bad bbox")
    if (e - w) * (n - s) > 400:
        raise HTTPException(400, "bbox larger than 400 square degrees; draw a smaller area")
    bb = f"{w:.3f},{s:.3f},{e:.3f},{n:.3f}"
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    points, by_day = [], {}
    async with httpx.AsyncClient() as client:
        d = start
        while d <= today:
            span = min(5, (today - d).days + 1)
            txt = await _firms_chunk(client, key, source, bb, span, d)
            for row in csv.DictReader(io.StringIO(txt)):
                ad = row.get("acq_date", "")
                by_day[ad] = by_day.get(ad, 0) + 1
                if len(points) < 20000:
                    points.append([round(float(row["longitude"]), 4), round(float(row["latitude"]), 4), ad,
                                   int(row.get("acq_time") or 0), float(row.get("frp") or 0),
                                   row.get("confidence", ""), row.get("daynight", "")])
            d += timedelta(days=span)
    return {"source": source, "bbox": [w, s, e, n], "from": str(start), "to": str(today),
            "count": sum(by_day.values()), "by_day": dict(sorted(by_day.items())),
            "points_fields": ["lon", "lat", "acq_date", "acq_time", "frp", "confidence", "daynight"],
            "points": points, "truncated": sum(by_day.values()) > len(points),
            "label": "Raw NRT detections from the FIRMS area API, provisional, NOT harmonized (harmonized history covers Pakistan only)."}
