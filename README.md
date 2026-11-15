# Aatish

**One consistent fire record for Pakistan, built from 26 years of MODIS and VIIRS satellite detections.**

*Aatish* (آتش) is Urdu for "fire". It was built in 48 hours by team **Aero Snipers** at **NASA Space Apps Challenge 2026** (Karachi) for the challenge [Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/).

![Aatish explorer: November 2026 hotspots over Pakistan](fillings/assets/shots/month_dots.png)

**App:** [aatishspace.vercel.app](https://aatishspace.vercel.app) · **Demo slides:** [`fillings/02_slides/slides.pdf`](fillings/02_slides/slides.pdf) · **Data:** [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/)

---

## The problem

NASA has tracked active fires from space since 2000 with **MODIS** (Terra, Aqua, 1 km pixels). Its successor **VIIRS** (Suomi NPP, NOAA-20, NOAA-21, 375 m pixels) is much more sensitive: over Pakistan in 2012–2022 it recorded **4.0× more hotspots by day and 14.6× more at night**. If you simply add the two, Pakistan's fire count jumps **6.9× from 2011 to 2012**. The fires didn't change; the satellites did.

Aatish converts every VIIRS detection into **MODIS-equivalent** units, so the series runs from November 2000 to today on one scale, and a jump in the chart means more burning, not a new instrument.

| Raw counts: a fake ×6.9 jump in 2012 | Harmonized: +2.7 % a year, 2002–2025 |
|---|---|
| ![raw](fillings/assets/shots/illusion_raw.png) | ![harmonized](fillings/assets/shots/illusion_harmonized.png) |

## What you can do in the app

- **Pick an area:** click a province, draw a polygon or box, or type a point and radius.
- **Burning calendar:** every month since Nov 2000 on a colour-blind-safe ramp, with values on hover.
- **Is now unusual?** The partial current month is compared with the **same days** in every earlier year: ratio, percentile, rank and an 80% band.
- **Key figures:** total, peak month, highest year, long-term trend. A year is only called "the highest", and a change a "trend", when the gap is bigger than the uncertainty band.
- **Map playback:** density heat, individual hotspots (time, satellite, fire power, weight), a province anomaly map and NASA GIBS true-colour imagery for a chosen day.
- **1–3 month outlook** with its tested skill.
- **Downloads:** hotspots CSV (with weights), monthly table CSV, calendar PNG, shareable URL.
- **Ask Aatish AI:** questions in English or Urdu. Answers use only numbers from our data tools (Gemini with function calling).
- **Archive Mode:** if the API is unreachable, the site falls back to a bundled offline archive.

## Method

```
w = P_aqua[FRP bin, day/night] × f[day/night, month] × L[1° cell, day/night, season] × f_sat / n_active_VIIRS
area-month total = Σ w        (additive, so any drawn area is consistent)
```

1. **Clean every stream the same way.** MODIS confidence ≥ 30, VIIRS nominal/high. One location mask (1,443 cells at 0.01°) removes static heat sources (kilns, flares) for all sensors and years, including near-real-time data, which has no `type` field. Satellite outages are flagged as **no data**, never as zero fires.
2. **Weight each VIIRS detection** by the measured probability that Aqua MODIS detected the same fire (within 1.5 km, same day), by fire radiative power and day/night. This is fitted on 2012-01-20 → 2022-09-30, when both instruments flew with stable orbits. The series uses the mean of the active VIIRS satellites.
3. **Stitch three eras:** Terra scaled to Terra+Aqua (to 2002-07-05) → MODIS observed (to 2022-09-30) → VIIRS-derived (from 2022-10-01; MODIS orbital drift is visible in the data after that).
4. **Uncertainty:** an 80% band on every derived month from held-out residuals, sized by the month's count.

Full write-up: [`docs/plan.md` §3](docs/plan.md), [`docs/harmonization-research.md`](docs/harmonization-research.md), and the app's `/method` page.

### Validation (leave-one-year-out, 2012–2022)

| Test | Result |
|---|---|
| Pakistan monthly totals | **MdAPE 9.5 %, R² 0.957** |
| 1° grid-cell months | MdAPE 17.1 %, R² 0.943 |
| Forward in time (fit ≤2017, test 2018–22) | MdAPE 10.5 % |
| S-NPP fit applied to NOAA-20 | bias +1.5 % |
| Anomaly correlation | 0.855 (Terra vs Aqua noise floor: 0.875) |
| 2022 seam (Oct–Dec, derived ÷ MODIS) | 0.94 / 1.01 / 1.06 |
| Matching radius 1 / 1.5 / 2 km | MdAPE changes ≤ 0.4 pp |

`pipeline/validate.py` re-checks all of this from the Parquet file and exits 1 on any regression. The build is deterministic: two runs give identical MD5s.

## Repository layout

```
raw_data/        NASA FIRMS CSVs for Pakistan (read-only) + boundaries + DATA_NOTES.md
pipeline/        firms_fetch.py, audit_raw.py, fc_lib.py, build_harmonized.py, validate.py, forecast_fit.py
                 explore/  research scripts behind docs/harmonization-research.md
data/            derived outputs: harmonized_points.parquet, calibration.json, no_data_days.csv, forecast_model.json
api/             FastAPI + DuckDB service (core.py, forecast.py, ask.py, main.py, Dockerfile)
web/             Next.js app (explorer, method, data, about pages)
docs/            plan, challenge brief, event notes, research
fillings/        submission text, demo slides, social images, screenshots
SI-LOG.md        log of every SI (AI) contribution and how it was checked
```

## Run it locally

**Requirements:** Python 3.14 with `pandas numpy scipy pyarrow duckdb shapely fastapi uvicorn httpx` (see `api/requirements.txt`; the pipeline also needs `scipy`), Node + pnpm. Tested on Windows 11.

```bash
# 1. secrets (optional: only needed for the live FIRMS layer and the assistant)
cp .env.example .env        # FIRMS_MAP_KEY=..., AI_STUDIO=...

# 2. (re)build the harmonized data from raw_data/ (~30 s) and check it
py -3.14 -E -P pipeline/build_harmonized.py
py -3.14 -E -P pipeline/validate.py          # exit 0 = all checks pass
py -3.14 -E -P pipeline/forecast_fit.py      # ~10 s

# 3. start API (:8000) + web (:3000) together; Ctrl+C stops both
.\dev.cmd                                    # or .\dev.ps1 -Open
```

The derived files in `data/` are committed, so step 2 is optional. On Windows, use `py -3.14 -E -P` rather than `-I`, because pandas' dependencies live in user site-packages.

Manual start, if you prefer:

```bash
py -3.14 -E -P -m uvicorn api.main:app --port 8000
cd web && pnpm install && pnpm dev
```

### API

| Endpoint | What it returns |
|---|---|
| `GET /api/calendar?aoi=&from=&to=` | year × month matrix, bands, anomalies, stats, "this month so far" |
| `GET /api/hotspots.csv` · `GET /api/monthly.csv` | downloads |
| `GET /api/points` · `GET /api/grid` · `GET /api/daily` | map layers |
| `GET /api/regions.geojson` · `GET /api/regions/stats` | provinces and their anomaly |
| `GET /api/forecast` · `GET /api/place` | outlook, point profile |
| `GET /api/overlap` · `GET /api/calibration` | 2012–2022 overlap, fitted parameters + validation |
| `GET /api/current?bbox=` | live FIRMS near-real-time (raw, provisional) |
| `POST /api/ask` | assistant (streams NDJSON) |
| `GET /api/meta` · `GET /api/health` | metadata |

`aoi` accepts `pakistan`, `region:PK-xx`, `bbox:…`, `circle:…` or `poly:…`.

## Limitations

- **A detection is not a fire**, and not burned area.
- **Near-real-time months are provisional** and labelled in the app.
- **Pakistan only.** The method is general, but the weights are fitted to this region. Bands for very small drawn areas are an extrapolation (validated on country and 1° cells).
- MODIS after Sep 2022 is not used in the series, because of orbital drift.
- Anything we could not confirm against an official source is marked **not verified** in the docs (for example the cause of NOAA-21's +21 % FRP offset).

## Data and credits

- **NASA FIRMS:** MODIS Collection 6.1 and VIIRS 375 m active fire (S-NPP, NOAA-20, NOAA-21), standard and near-real-time. https://firms.modaps.eosdis.nasa.gov/
- **NASA GIBS:** true-colour imagery. https://nasa-gibs.github.io/gibs-api-docs/
- **geoBoundaries** (gbOpen PAK ADM0/ADM1) · **Natural Earth** (disputed areas) · **OpenFreeMap / OpenMapTiles / © OpenStreetMap contributors** (basemap)
- Papers: Schroeder et al. 2014 ([doi](https://doi.org/10.1016/j.rse.2013.12.008)), Giglio et al. 2016 ([doi](https://doi.org/10.1016/j.rse.2016.02.054)), Vadrevu & Lasko 2018 ([doi](https://doi.org/10.3390/rs10070978)), Chen et al. 2026 GFED5NRT ([doi](https://doi.org/10.5194/essd-18-7535-2026))
- Challenge partner: CONAE (Argentina)

All raw data was downloaded and processed after the event start (2026-11-14 09:00 PKT), as the event rules require.

## Use of SI (AI) tools

**Claude Code** (Anthropic, Claude Opus 5.5) was used throughout the event as a coding and analysis assistant: data audit, method research and bake-offs, the pipeline, the API, the web app, the docs, and the layout code of the slides and social images. Every contribution and what was checked by hand is logged in [`SI-LOG.md`](SI-LOG.md). The in-app assistant uses **Google Gemini**. It can only report numbers returned by our data tools, and general background is labelled "not from our data". **No images, video or audio were SI-generated**; all visuals are screenshots of the app. No NASA logos or branding are used.

## Team

**Aero Snipers**, NASA Space Apps Challenge 2026, Karachi. Developer: [Rehan Sathio](https://rehansathio.dev).
