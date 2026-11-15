"""'Ask anything' assistant: Gemini (Google AI Studio) with function calling over the Aatish store.

The model never sees raw files; it can only call the read-only tools below, which return the same numbers the
website shows. Key: env AI_STUDIO (server side only, never sent to the browser).
Models: env FC_AI_MODELS (comma list, tried in order; default below, checked against the key's model list on
2026-11-15: gemini-3.5-flash answered with tools in ~8 s, gemini-3.5-flash-lite in ~2 s; 3.7/3.8-flash timed out).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import date, timedelta

import httpx

from .core import AOIError, store

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODELS = [m.strip() for m in os.environ.get("FC_AI_MODELS", "gemini-3.5-flash,gemini-3.5-flash-lite").split(",") if m.strip()]
CALL_TIMEOUT = float(os.environ.get("FC_AI_TIMEOUT", "40"))
MAX_ROUNDS = 6
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

SYSTEM = """You are the Aatish helper on a NASA Space Apps 2026 website (team Aero Snipers). The site shows how much
fire activity satellites saw in Pakistan, month by month, from Nov 2000 until {data_to}. Your readers may be farmers,
students, journalists or officials with no science background. Make them understand.

HOW TO ANSWER
- Reply in the user's language and script (English, Urdu, or Roman Urdu, whatever they used).
- Short and plain: 2-6 short sentences or a few bullets. No jargon. If you must use a term, explain it in brackets.
- Lead with the direct answer, then one line of "what this means", then the caveat if it matters.
- Round numbers for humans (about 1,500, not 1541.21). Name months and years in words.
- Use Markdown sparingly: **bold** for the key number, bullets for lists. No tables unless asked.

GROUNDING (strict)
- Every number about fires MUST come from a tool result in this conversation. Never invent or estimate numbers.
  If a tool cannot answer, say so plainly and suggest what the user can do on the site.
- Call tools first whenever the question touches data: history, comparisons, "how bad", forecasts, a place.
- Areas: "pakistan", a province name (Punjab, Sindh, Khyber Pakhtunkhwa, Balochistan, Islamabad, Gilgit-Baltistan,
  Azad Kashmir), "current" (the area the user has selected on the map, if any), or a coordinate. For a city or district,
  use its approximate coordinates with describe_place and say that a {radius}-km circle around it was used.
- Data covers Pakistan only. Outside Pakistan you have no harmonized history; say so.
- Things not in the tool results (why fires happen there, crops, land use, weather, policy) may come from your general
  knowledge, but mark them clearly, e.g. "General background (not from our satellite data): ...". Keep it cautious
  and do not state precise facts you are unsure of.

WHAT THE NUMBERS MEAN (explain when useful)
- Unit = "MODIS-equivalent detections": how many hot spots the older NASA MODIS satellites (Terra + Aqua) would have
  counted. It is NOT the number of separate fires and NOT burned area. One big fire can give several detections.
- Newer VIIRS satellites see smaller fires. After Oct 2022 the MODIS-like numbers are estimated from VIIRS, so those
  months carry an uncertainty band ("lo"-"hi", 80% range). Before Jul 2002 only one satellite (Terra) existed, so
  those months are scaled and also uncertain. Recent weeks use near-real-time (NRT) data: provisional.
- Gas flares, brick kilns and other always-hot industrial spots are removed from the main series.
- "Percentile" = how this month ranks against the same month in other years (90 = higher than 90% of years).

FORECASTS
- get_forecast gives the next 3 months only, with an 80% range. Say plainly that it is only slightly better than
  "the usual for that month" (state the skill from the tool), and that month 3 is about as good as the usual level.
- For anything further ahead (e.g. most of 2027) there is NO forecast. Use typical_year and say clearly: "this is what
  a normal year looks like, not a prediction". Never claim to predict specific future fires, days or places.

Today is {today}. The user's current view on the site: {view}.
"""

TOOLS = [{"functionDeclarations": [
    {"name": "get_fire_history",
     "description": "Monthly and yearly satellite fire activity for an area: totals, worst year, peak month, trend, "
                    "the selected months with uncertainty and percentile vs other years, and how the current partial "
                    "month compares with the same days in earlier years.",
     "parameters": {"type": "object", "properties": {
         "area": {"type": "string", "description": "pakistan | province name | current | 'lat,lon' | 'lat,lon,radius_km'"},
         "from_month": {"type": "string", "description": "YYYY-MM, optional (default: whole record)"},
         "to_month": {"type": "string", "description": "YYYY-MM, optional"}},
         "required": ["area"]}},
    {"name": "get_forecast",
     "description": "Forecast of the next 1-3 months (with 80% range and validation skill) plus the typical range "
                    "for every calendar month (last 10 years) for questions further ahead.",
     "parameters": {"type": "object", "properties": {
         "area": {"type": "string", "description": "pakistan | province name | current | 'lat,lon' | 'lat,lon,radius_km'"}},
         "required": ["area"]}},
    {"name": "describe_place",
     "description": "Fire profile around a coordinate: province, fire season (typical month by month), peak month, "
                    "worst year, trend, last 10 years, day/night share, typical fire intensity, recent activity.",
     "parameters": {"type": "object", "properties": {
         "lat": {"type": "number"}, "lon": {"type": "number"},
         "radius_km": {"type": "number", "description": "5-100, default 25"}},
         "required": ["lat", "lon"]}},
    {"name": "compare_provinces",
     "description": "All provinces side by side: for one month (value, percentile vs the same month in earlier years) "
                    "or totals and shares over a date range.",
     "parameters": {"type": "object", "properties": {
         "month": {"type": "string", "description": "YYYY-MM (optional)"},
         "from_date": {"type": "string", "description": "YYYY-MM-DD (optional, range mode)"},
         "to_date": {"type": "string", "description": "YYYY-MM-DD (optional, range mode)"}}}},
    {"name": "get_method_facts",
     "description": "How the data was made: satellites, sources, harmonization method, accuracy on held-out years, "
                    "known gaps and caveats.",
     "parameters": {"type": "object", "properties": {}}},
]}]

PROVINCE_ALIASES = {
    "punjab": "PK-PB", "sindh": "PK-SD", "sind": "PK-SD", "khyber": "PK-KP", "kpk": "PK-KP", "kp": "PK-KP",
    "pakhtunkhwa": "PK-KP", "nwfp": "PK-KP", "balochistan": "PK-BA", "baluchistan": "PK-BA", "islamabad": "PK-IS",
    "ict": "PK-IS", "gilgit": "PK-GB", "baltistan": "PK-GB", "gb": "PK-GB", "azad": "PK-JK", "ajk": "PK-JK",
    "kashmir": "PK-JK",
}


def _resolve_area(area: str | None, view_aoi: str | None) -> str:
    s = (area or "pakistan").strip()
    low = s.lower()
    st = store()
    if low in ("", "pakistan", "country", "all", "pak"):
        return "pakistan"
    if low in ("current", "selected", "this", "here", "current view"):
        return view_aoi or "pakistan"
    if re.match(r"^(region|bbox|circle|poly):", low):
        return s
    nums = re.findall(r"-?\d+(?:\.\d+)?", s)
    if len(nums) in (2, 3) and not re.search(r"[a-z]{3,}", low):
        lat, lon = float(nums[0]), float(nums[1])
        km = float(nums[2]) if len(nums) == 3 else 25.0
        return f"circle:{lon},{lat},{max(5.0, min(km, 100.0))}"
    for iso, r in st.regions.items():
        if r["name"].lower() == low:
            return f"region:{iso}"
    for k, iso in PROVINCE_ALIASES.items():
        if k in low and iso in st.regions:
            return f"region:{iso}"
    raise AOIError(f"unknown area '{s}'. Use pakistan, a province name, current, or 'lat,lon[,radius_km]'")


def _ym_to_date(s: str | None, end: bool) -> date | None:
    if not s:
        return None
    m = re.fullmatch(r"(\d{4})-(\d{1,2})(?:-(\d{1,2}))?", s.strip())
    if not m:
        raise AOIError(f"bad month '{s}', use YYYY-MM")
    y, mo = int(m.group(1)), int(m.group(2))
    if m.group(3):
        return date(y, mo, int(m.group(3)))
    if not end:
        return date(y, mo, 1)
    return date(y + mo // 12, mo % 12 + 1, 1) - timedelta(days=1)


def _month_row(m: dict) -> dict:
    r = {"month": f"{MONTHS[m['month'] - 1]} {m['year']}", "value": round(m["value"], 1)}
    if m["hi"] != m["lo"] or m["role"] != "native":
        r["range80"] = [round(m["lo"], 1), round(m["hi"], 1)]
    if m.get("pct") is not None:
        r["percentile_vs_same_month"] = m["pct"]
    if m.get("median") is not None:
        r["usual_for_month"] = round(m["median"], 1)
    if m["provisional"]:
        r["provisional"] = True
    if m["days_covered"] != m["days_in_month"]:
        r["partial_days"] = f"{m['days_covered']}/{m['days_in_month']}"
    if m["gap_days"]:
        r["no_data_days"] = m["gap_days"]
    return r


def tool_history(args: dict, view_aoi: str | None) -> dict:
    key = _resolve_area(args.get("area"), view_aoi)
    st = store()
    full = st.calendar(key, None, None)
    f, t = _ym_to_date(args.get("from_month"), False), _ym_to_date(args.get("to_month"), True)
    months = full["months"]
    if f or t:
        sel = [m for m in months if (not f or (m["year"], m["month"]) >= (f.year, f.month))
               and (not t or (m["year"], m["month"]) <= (t.year, t.month))]
    else:
        sel = months[-13:]
    note = None
    if len(sel) > 48:
        sel = sorted(sel, key=lambda m: -m["value"])[:24]
        sel.sort(key=lambda m: (m["year"], m["month"]))
        note = "range too long: only the 24 highest months are listed; use yearly totals for the rest"
    s = full["stats"]
    out = {
        "area": full["aoi"]["label"], "area_key": key, "unit": full["unit_label"],
        "share_of_area_inside_pakistan": full["aoi"]["coverage_pakistan"],
        "data_from": full["data_extent"]["from"], "data_to": full["data_extent"]["to"],
        "total_whole_record": round(s["total"]), "worst_year": s.get("worst_year"),
        "peak_month": ({"month": MONTHS[s["peak_month"]["month"] - 1], "typical": s["peak_month"]["median"],
                        "share_of_year_pct": s["peak_month"]["share_pct"]} if s.get("peak_month") else None),
        "typical_month_by_month": ({MONTHS[c["month"] - 1]: c["median"] for c in s["climatology"]} if s.get("climatology") else None),
        "trend": s.get("trend"),
        "yearly_totals": [{"year": y["year"], "value": round(y["value"]), "range80": [round(y["lo"]), round(y["hi"])]}
                          for y in s["yearly"]],
        "months": [_month_row(m) for m in sel],
        "current_partial_month_vs_same_days_in_past": ({k: v for k, v in full["anomaly"].items() if k != "series"}
                                                        if full["anomaly"] else None),
    }
    if note:
        out["note"] = note
    if not (f or t):
        out["note"] = "months = last 13 months; ask with from_month/to_month for others"
    return out


def tool_forecast(args: dict, view_aoi: str | None) -> dict:
    key = _resolve_area(args.get("area"), view_aoi)
    f = store().forecast(key)
    for m in f["months"]:
        m["last_10_years"] = {str(x["year"]): x["value"] for x in m["last_10_years"]}
    f["typical_year"] = {MONTHS[t["month"] - 1]: {"median": t["median"], "low": t["low_q10"], "high": t["high_q90"]}
                         for t in f["typical_year"]}
    f["area_key"] = key
    return f


def tool_place(args: dict, view_aoi: str | None) -> dict:
    p = store().place(float(args["lat"]), float(args["lon"]), float(args.get("radius_km") or 25))
    if p.get("climatology"):
        p["typical_month_by_month"] = {MONTHS[c["month"] - 1]: c["median"] for c in p.pop("climatology")}
    if p.get("peak_month"):
        p["peak_month"]["month"] = MONTHS[p["peak_month"]["month"] - 1]
    p["busiest_hours_pkt"] = [(h + 5) % 24 for h in p.pop("busiest_utc_hours")]
    return p


def tool_provinces(args: dict, view_aoi: str | None) -> dict:
    st = store()
    ym = (args.get("month") or "").strip() or None
    f = _ym_to_date(args.get("from_date"), False) if args.get("from_date") else None
    t = _ym_to_date(args.get("to_date"), True) if args.get("to_date") else None
    return st.region_stats(f, t, ym)


def tool_method(args: dict, view_aoi: str | None) -> dict:
    st = store()
    c = st.calib
    v = c["validation"]["loyo_merged"]
    return {
        "sources": "NASA FIRMS active-fire detections: MODIS Collection 6.1 (Terra from 2000, Aqua from Jul 2002) and VIIRS "
                   "375 m (Suomi NPP 2012 to Nov 2026, NOAA-20 from 2018, NOAA-21 from 2023). Province borders: geoBoundaries.",
        "data_extent": [str(store().calendar("pakistan", None, None)["data_extent"][k]) for k in ("from", "to")],
        "method": c["method"], "fit_window": c["fit_window"], "unit": c["unit"],
        "eras": {"Nov 2000 - Jul 2002": "Terra only, scaled to Terra+Aqua (wider uncertainty)",
                 "Jul 2002 - Sep 2022": "observed MODIS Terra+Aqua (no model)",
                 "Oct 2022 onwards": "MODIS-equivalent estimated from VIIRS (80% band shown)"},
        "accuracy_held_out_years": {"country_month": v["country_month"], "one_degree_cell_month": v["cell1_month"]},
        "static_sources": "Gas flares, kilns and other persistent industrial hot spots are masked out of the main series.",
        "known_gaps": "Satellite outages are marked as no-data (not zero fires). Recent weeks are near-real-time and provisional.",
        "forecast": (st.fmodel or {}).get("validation", {}).get("design"),
        "team": "Aero Snipers, NASA Space Apps Challenge 2026, Karachi",
    }


HANDLERS = {"get_fire_history": (tool_history, "Checking past fire records"),
            "get_forecast": (tool_forecast, "Running the forecast model"),
            "describe_place": (tool_place, "Looking up that place"),
            "compare_provinces": (tool_provinces, "Comparing provinces"),
            "get_method_facts": (tool_method, "Reading how the data was made")}


def run_tool(name: str, args: dict, view_aoi: str | None) -> dict:
    h = HANDLERS.get(name)
    if not h:
        return {"error": f"unknown tool {name}"}
    try:
        return h[0](args or {}, view_aoi)
    except (AOIError, ValueError, KeyError, TypeError) as ex:
        return {"error": str(ex)}


# ---------- rate limit (in memory, per process) ----------
_hits: dict[str, list[float]] = {}
PER_MIN = int(os.environ.get("FC_AI_PER_MIN", "8"))
PER_DAY_GLOBAL = int(os.environ.get("FC_AI_PER_DAY", "1500"))
_day = {"d": "", "n": 0}


def allow(ip: str) -> str | None:
    now = time.time()
    h = [t for t in _hits.get(ip, []) if now - t < 60]
    if len(h) >= PER_MIN:
        return "Too many questions in a minute. Please wait a moment."
    today = date.today().isoformat()
    if _day["d"] != today:
        _day.update(d=today, n=0)
    if _day["n"] >= PER_DAY_GLOBAL:
        return "The assistant has reached today's limit. Please try again tomorrow."
    h.append(now); _hits[ip] = h; _day["n"] += 1
    return None


def _view_text(view: dict | None) -> str:
    if not view:
        return "none"
    parts = []
    if view.get("aoi"):
        parts.append(f"area={view.get('aoi_label') or view['aoi']} (key {view['aoi']}, use area='current')")
    if view.get("ym"):
        parts.append(f"selected month={view['ym']}")
    if view.get("page"):
        parts.append(f"page={view['page']}")
    return ", ".join(parts) or "none"


async def answer(question: str, history: list[dict], view: dict | None):
    """Async generator of events: {type: tool|text|done|error}."""
    key = os.environ.get("AI_STUDIO")
    if not key:
        yield {"type": "error", "text": "The assistant is not configured on this server (AI_STUDIO missing)."}
        return
    st = store()
    from .core import i2d
    view_aoi = None
    if view and view.get("aoi"):
        try:
            view_aoi = st.parse_aoi(str(view["aoi"])).key
        except AOIError:
            view_aoi = None
    sys_txt = SYSTEM.format(data_to=i2d(st.last_day), today=date.today().isoformat(), view=_view_text(view), radius=25)
    base = []
    for turn in history[-8:]:
        role = "model" if turn.get("role") == "assistant" else "user"
        txt = str(turn.get("text", ""))[:2000]
        if txt:
            base.append({"role": role, "parts": [{"text": txt}]})
    base.append({"role": "user", "parts": [{"text": question}]})

    last_err = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(CALL_TIMEOUT, connect=10)) as client:
        for model in MODELS:
            contents = list(base)
            used = []
            try:
                for _ in range(MAX_ROUNDS):
                    body = {"systemInstruction": {"parts": [{"text": sys_txt}]}, "contents": contents, "tools": TOOLS,
                            "generationConfig": {"maxOutputTokens": 2048}}
                    r = await client.post(API.format(model=model), headers={"x-goog-api-key": key}, json=body)
                    if r.status_code != 200:
                        raise RuntimeError(f"{model}: HTTP {r.status_code} {r.text[:200]}")
                    d = r.json()
                    cand = (d.get("candidates") or [{}])[0]
                    content = cand.get("content") or {}
                    parts = content.get("parts") or []
                    calls = [p["functionCall"] for p in parts if "functionCall" in p]
                    if not calls:
                        text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                        if not text:
                            raise RuntimeError(f"{model}: empty answer ({cand.get('finishReason')})")
                        yield {"type": "text", "text": text}
                        yield {"type": "done", "model": d.get("modelVersion", model), "tools": used}
                        return
                    contents.append(content)  # keep thought signatures exactly as returned
                    resp_parts = []
                    for c in calls:
                        name, args = c.get("name", ""), c.get("args") or {}
                        yield {"type": "tool", "name": name, "label": HANDLERS.get(name, (None, name))[1], "args": args}
                        res = await asyncio.to_thread(run_tool, name, args, view_aoi)
                        used.append(name)
                        fr = {"name": name, "response": {"result": json.loads(json.dumps(res, default=str))}}
                        if c.get("id"):
                            fr["id"] = c["id"]
                        resp_parts.append({"functionResponse": fr})
                    contents.append({"role": "user", "parts": resp_parts})
                raise RuntimeError(f"{model}: too many tool rounds")
            except (httpx.HTTPError, RuntimeError, ValueError) as ex:
                last_err = f"{type(ex).__name__}: {ex}"
                yield {"type": "retry", "model": model}
                continue
    yield {"type": "error", "text": "The assistant could not answer right now. Please try again in a minute.",
           "detail": (last_err or "")[:300]}
