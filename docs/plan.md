# Game plan: MODIS + VIIRS burning activity calendar

Every decision was made before the event, so the 48 hours go into building, not deciding. The challenge itself is in [challenge.md](challenge.md).

> **Rule check:** no project code before **Nov 14, 9:00 AM**. Everything in "Before the hackathon" is research, accounts and tooling practice, which is allowed. Write the real code in the event window only.

## 1. What we'll ship (the pitch)

**Working name:** *FireCalendar*, a harmonized burning activity calendar.

The user draws an area (or types lat/lon), picks a date range, and gets:
1. **A calendar heatmap**: years (2001→2026) × months, colored by **harmonized** hotspot count.
2. **An anomaly view**: this month vs the historical median for the same month (a percentile and a "x times normal" figure).
3. **Key figures**: total hotspots, worst year, peak month, trend over time.
4. **A science panel**: how MODIS and VIIRS were made comparable, with a calibration plot and validation numbers.
5. **Downloads**: a CSV of the hotspots in the AOI and range, a CSV of the monthly table, and a PNG of the calendar.

**Demo story (Local Impact):** "It's smog season in Lahore *right now*." Draw Punjab, and the calendar lights up every Oct–Nov (rice stubble) and Apr–May (wheat). November 2026 vs the historical median shows whether this year is worse. Then draw an area anywhere else (Amazon, California, Argentina, the partner's country) to show it works worldwide.

## 2. Scope decision (updated 2026-11-14)

| Layer | Coverage | Why |
|---|---|---|
| Harmonized history, 2000-11→2026-11-13 | **Pakistan** (FIRMS country files + clipped area API, see [DATA_NOTES](../raw_data/DATA_NOTES.md)). North India was **not** downloaded. Add showcase regions only if time allows | Discussion #2016: a well-done single region beats weak global coverage |
| Current month | **Any AOI worldwide**, live from the FIRMS area API (max 5 days per call: DAY_RANGE 1..5, checked on the FIRMS API page 2026-11-14) | Keeps the "works anywhere" promise for recent data |
| Method | Applies to any region. Calibration is fitted per region and month | The method is the product, not the coverage |

## 3. Harmonization method (revised 2026-11-14 11:30, evidence in [harmonization-research.md](harmonization-research.md))

Every step below was tested on our data. The old v1 (one log-log power law plus 1 km grid snapping) **lost the bake-off** and is dropped.

**Step 0: Clean every stream the same way**
- Confidence: MODIS `≥ 30`, VIIRS `n`/`h`. Unchanged; show the choice in the app.
- **Static sources:** one **location mask for all sensors, all years, SP and NRT**. Use 0.01° cells with >5 type≠0 detections in VIIRS SP history (GFED5NRT rule), plus MODIS type≠0 cells from 2018+ (no buffer). Reason: MODIS typing changes in 2018 (type≠0 jumps from ~0.1% to ~1.6–2.2%), and NRT has no `type`. Toggle: include static/industrial sources.
- No-data windows (S-NPP outages, MODIS 2001 gap, Aqua FMU 2020) are flagged, never treated as zero.
- **No grid-snap.** We count detections (points). Tested: 1 km cells were never better.

**Step 1: Calibrate VIIRS → MODIS-equivalent with a ratio model**
- Unit: **MODIS-equivalent** (Terra+Aqua, as FIRMS MODIS). VIIRS→MODIS is a well-posed degradation. "VIIRS-equivalent" is the exact inverse, offered as a display toggle, and anomaly percentiles are the same in both units.
- Fit window: **2012-01-20 → 2022-09-30**. Orbital drift is measurable in our own data from 2022 Q4.
- Model (updated 12:10 after round 2–4, see [harmonization-research.md](harmonization-research.md) §6): weight per VIIRS detection
  `w = P_aqua[FRP bin, daynight] × f[daynight, month-of-year] × L[1° cell, daynight, season]`.
  `P_aqua` = measured probability that Aqua detects (within 1.5 km, same day) a fire S-NPP detects, by FRP. `f` = ratio of totals on top of that (absorbs Terra and unmatched pixels). `L` = local adjustment shrunk toward 1 (k≈200). This is additive, so **any AOI sum = Σw**.
  Previous ratio-only model (`R[dn, moy] × L`) is kept as the simple fallback. Poisson GBM is an independent cross-check for the science panel.
- VIIRS input: the **mean of the active VIIRS satellites** for that date and day/night. Each point gets weight `w × f_sat / n_active_sats`. If one satellite has an outage, the others carry it (GFED5NRT approach). A satellite is inactive when it has 0 detections while another VIIRS satellite has ≥1 in the same date + day/night, plus the official S-NPP window. **Re-fit 2026-11-14 on MODIS-eq weight sums** (days where both satellites are active, SP): `f_sat` = S-NPP 1, **NOAA-20 0.9765** (count ratio 0.978), **NOAA-21 0.869**. **Updated 12:55 (self-audit S5):** NOAA-21 FRP is now divided by **1.21** before FRP binning (geometric mean of N21/N20 FRP quantile ratios q10–q90, day+night; the offset is uniform across quantiles). NOAA's JPSS NOAA-21 readme (2023-06-01) documents an "up to ~10%" positive FRP bias from the M13 spectral shift; our larger 21% is **not explained/verified**. After the rescale `f_sat` NOAA-21 = **1.005** (was 0.869), i.e. the FRP rescale explains the whole offset, and the N21/N20 weight ratio 0.972 equals the count ratio 0.972. Effect on the series ≤0.2%, and the month-of-year N21/N20 pattern (Jul 0.89, Aug 0.84) is unchanged, so this is a physics/cleanliness fix, not an accuracy gain. Derived monthly totals: NOAA-20/S-NPP median 1.003, NOAA-21/NOAA-20 0.992.
- Validation (LOYO, research run, filter `type==0`): country-month **MdAPE 10.7%, R² 0.956**. 1° cell-month **MdAPE 17.7%, R² 0.941**. Forward test (fit ≤2017, test 2018–22): 11.0% / 18.1%. Yearly bias within ±8% (2012: −14.5%, early VIIRS calibration). NOAA-20 transfer bias +4.6% (the +1.9% figure was GBM's).
- **Production pipeline** (`pipeline/build_harmonized.py`, location static mask, checked by `pipeline/validate.py` 2026-11-14): S-NPP-input LOYO country **9.96% / R² 0.956**, cell **17.65% / 0.941**. Production input (mean of active satellites): country **9.5% / 0.957**, cell **17.1% / 0.943**. Forward 10.5% / 17.65%. NOAA-20 transfer bias +3.9% without f_sat and +1.5% with it. Pooled 80% band, nested coverage: 0.80 (country) and 0.80 (cell). **Matching radius 1/1.5/2 km: MdAPE changes ≤0.4 pp, so 1.5 km is kept** (not sensitive).

**Step 2: Build the series**
| Period | Source | Flag |
|---|---|---|
| 2000-11-01 → 2002-07-05 | Terra × (Terra+Aqua)/Terra monthly factor (2003–2021 fit) | "Terra-only, scaled", wider band |
| 2002-07-06 → 2022-09-30 | MODIS observed | native |
| 2022-10-01 → SP end | VIIRS-derived MODIS-equivalent | derived |
| SP end → today | VIIRS NRT-derived | derived + **provisional** |
- In the 2012–2022 overlap the science panel shows both lines (MODIS observed vs VIIRS-derived).
- MODIS after 2022-09 is **not used** in the series. It is shown only as a "drift check": Terra Oct–Nov obs/pred falls to 0.30–0.61, while Aqua rises to 1.2–1.5.

**Step 3: Uncertainty and anomalies**
- **Prediction band depends on the predicted AOI-month count (updated 12:55, self-audit S4):** `calibration.json → validation.loyo_merged.band_by_count.buckets`. LOYO log1p residuals pooled over country, 1°, 0.5° and 0.25° cell-months, bucketed by predicted count. 80% band q10/q90: <2 [−0.60, +0.69]; 2–5 [−1.23, +0.52]; 5–20 [−0.86, +0.45]; 20–100 [−0.44, +0.36]; 100–1000 [−0.25, +0.24]; ≥1000 [−0.19, +0.16] (n=50 only). Nested coverage 0.76–0.83. Band for total h = [expm1(log1p(h)+q10), expm1(log1p(h)+q90)]. The old single pooled band was too wide for big AOIs and too narrow on the low side for small ones. A trend is only claimed if it exceeds the band.
- **Anomaly skill (state it, not just R²):** country-month LOYO anomaly R² 0.73, anomaly corr 0.855 (noise-floor reference: Terra vs Aqua 0.875), within-month percentile error 10.4 pp mean / 23.6 pp p90, above/below-median agreement 84.5%, same worst year in 6/12 calendar months. → Say "among the highest" unless the margin exceeds the band.
- **Partial current month:** compare the same day window (e.g. Nov 1–13) across years, not the full month.
- Anomaly = percentile rank + ratio to the baseline median over the same window. Show the ratio only when the baseline median is ≥5; otherwise show the absolute difference.

**Caveats to state openly:** detections ≠ fires ≠ burned area. The burning-time shift in Indian Punjab (ISRO, *Current Science* 2025, not verified for Pakistan) affects every polar orbiter. MODIS orbital drift. NRT is provisional.

**Papers to cite:** see [harmonization-research.md](harmonization-research.md) §1 (Schroeder 2014, Giglio 2016, Vadrevu & Lasko 2018, Chen 2026 GFED5NRT, Giglio 2025).

## 4. Architecture

```
FIRMS archive (yearly country CSVs, or a Download Tool request) ──┐
FIRMS area API (NRT, current month) ───────────────────────────────┤
                                                                   ▼
  pipeline/ (Python: pandas + DuckDB)
    clean → static mask → calibrate → data/harmonized_points.parquet (one row per detection + w_modis_eq)
                                                                   ▼
  api/ (FastAPI + DuckDB over Parquet)
    GET /calendar?aoi=<geojson>&from&to   → year×month matrix + stats
    GET /hotspots.csv?aoi&from&to         → raw points
    GET /calibration?region               → fit params + validation
    GET /current?aoi                      → live NRT via FIRMS API
                                                                   ▼
  web/ (Vite + React, MapLibre + maplibre-gl-draw, ECharts heatmap)
    map + draw/latlon input │ calendar │ anomaly cards │ science tab │ downloads
```

**Fallback if the backend is late:** precompute the calendar JSON for fixed regions (Punjab, Sindh, the whole of Pakistan) and serve it statically. The demo still works.

**Hosting:** frontend on Vercel, API on Render or Fly (or Hugging Face Spaces). Choose and try deploying a hello-world before the event, since that counts as tooling practice.

**Color:** `cividis` or `viridis` for counts, and a colorblind-safe diverging scale (blue↔orange) for anomalies. Every cell also shows its number on hover, so the chart doesn't rely on color alone.

## 5. Team roles

Scale this to however many people join. With fewer people, the roles merge from the bottom up.

| Role | Owns | Solo/duo fallback |
|---|---|---|
| **Data/Science lead** | Download data, cleaning, grid-snap, calibration, validation numbers, science text | Me |
| **Backend** | DuckDB queries, AOI clipping, CSV export, NRT proxy, deploy | Me |
| **Frontend** | Map, draw tool, calendar heatmap, anomaly cards, downloads | Me / teammate 1 |
| **Story/Design** | Pitch, demo video, slides, submission text, SI-usage note, Local Impact framing | Teammate 2 |
| **QA/Domain** | Check results against known events (2019–2024 Punjab burning peaks), test AOIs | Anyone |

## 6. 48-hour timeline (PKT)

| When | Data/Science | App | Story |
|---|---|---|---|
| **Sat 09:00–10:00** | Read the Resources tab. Start the data downloads *first*, because they're slow | Create the repo and scaffold the 3 folders | Create the project page draft |
| **10:00–14:00** | Clean + grid-snap MODIS and VIIRS for the AOI region | API skeleton + `/hotspots.csv` on raw data | Collect visuals and Punjab smog context |
| **14:00–20:00** | **v1 calibration** + validation numbers. Produce `harmonized.parquet` | Map + draw + calendar heatmap on **raw** counts (swap in harmonized data later) | Pitch script draft |
| **20:00–02:00** | Anomaly stats (median, percentile, trend) | Wire the harmonized data in. Anomaly cards. Live NRT current month | — |
| **Sat night** | Sleep in shifts. **Milestone: end-to-end demo works locally** | | |
| **Sun 08:00–14:00** | v2 calibration if time allows. Science panel plots | Science tab, downloads (CSV/PNG), lat/lon input, mobile check | Record screen captures |
| **14:00–18:00** | Freeze the data | **Deploy.** Fix bugs. Feature freeze at 18:00 | Demo video + slides |
| **18:00–22:00** | Write the method + limitations | Final deploy check on the public URL | Write the submission text + **SI-usage note** |
| **22:00–23:00** | **SUBMIT** (deadline 23:59 PKT, so leave buffer) | | |

## 7. Status (2026-11-14, 12:25 PKT)

**Done**
- [x] FIRMS MAP_KEY works (stored in `.env`, gitignored).
- [x] Resources tab copied and checked: FIRMS only, plan unchanged ([challenge.md](challenge.md)).
- [x] **Data collection complete** in `raw_data/` (all files created after 09:00 PKT, so allowed per #2011). Audited 2026-11-14: no duplicates across files, SP→NRT handovers have no gaps or overlaps.

| Stream | Rows (Pakistan) | Range |
|---|---|---|
| MODIS Terra+Aqua | 244,020 | 2000-11-01 → 2026-11-13 (SP to 08-31, then NRT) |
| VIIRS S-NPP | 872,217 | 2012-01-20 → 2026-11-02 (end of S-NPP) |
| VIIRS NOAA-20 | 540,990 | 2018-04-01 → 2026-11-13 (SP to 07-31, then NRT) |
| VIIRS NOAA-21 | 229,584 | 2023-03-01 → 2026-11-13 (SP to 07-31, then NRT) |

- [x] Papers to cite: see [harmonization-research.md](harmonization-research.md) §1.
- [x] Harmonization method researched and tested (2026-11-14 11:30–12:10).
- [x] `pyarrow` 26.0.1 + `duckdb` 2.0.0 installed for py -3.14 (`--user`).
- [x] **Pipeline built and validated (12:25).** Run `py -3.14 -E -P pipeline/build_harmonized.py` (about 30 s), then `py -3.14 -E -P pipeline/validate.py` (exit 0 = all checks pass; report in `data/validate_report.txt`). The build is deterministic: two runs give identical MD5s.
  - `data/harmonized_points.parquet` (1,886,811 rows, 47 MB): every raw detection with `conf_ok`, `static_flag`, `series_role` (native 182,874 / terra_scaled 6,073 / derived 648,563 / excluded), `w_modis_eq`, `w_viirs_eq`, `n_active`, `d_aqua_km`. **Main series = `SUM(w_modis_eq) WHERE series_role <> 'excluded' AND NOT static_flag`.** VIIRS rows before 2022-10 still carry `w_modis_eq` (role excluded) for the overlap line.
  - `data/calibration.json`: P_aqua, f, L, R (VIIRS-eq conversion), f_sat, Terra factors, all validation metrics, pooled residual quantiles (80% band: country log1p residual [−0.242, +0.190]; 1° cell [−0.717, +0.548]).
  - `data/no_data_days.csv`: 422 sat-day-daynight rows (S-NPP 138 days, NOAA-20 57, NOAA-21 32, plus MODIS runs ≥7 d and the Aqua FMU window, which is listed but partial).
  - Static mask: 1,443 cells at 0.01° (190 from VIIRS, 1,262 from MODIS 2018+), covering 142,398 rows. 834 rows typed ≠0 fall outside the mask and are kept as fires (one mask for every row).
  - Sanity: 2022-10 seam is continuous (Oct–Dec 2022 derived/MODIS obs 0.94, 1.01, 1.06). 2012–2022 overlap, in-sample: total ratio 0.995, monthly MdAPE 8.5%, yearly 0.84 (2012) and 0.95–1.07 after. Jul–Aug derived/obs is 0.91 / 0.87 (monsoon, low counts). 2002-07 seam: Terra-scaled vs observed T+A over the first 12 Aqua months gives a pooled ratio of 0.97, but single months range 0.62–1.11 (Sep–Oct 2002 at 0.69/0.62), which is why that period gets the wider band.
- [x] Resolved: NOAA-20 2023-07-19 (4 d) zero run → flagged as no-data by the rule (other VIIRS satellites saw fires). MODIS 2025-09-07..13 (7 d): 0 MODIS while VIIRS had 248 rows, consistent with a MODIS outage, but the cause is **not verified**. It's post-2022, so the series is unaffected. MODIS 2002-03-20 (10 d) and 2001-08-19 (8 d): pre-VIIRS, so they can't be checked. They're flagged only, and their cause is **not verified**.

**Open**
- [x] **Self-audit fixes 1–3 done (12:55):** count-dependent bands, NOAA-21 FRP rescale, anomaly skill + Terra-vs-Aqua noise floor in `calibration.json` and checked by `validate.py` (exit 0, build still deterministic).
- [ ] **Open from the self-audit:** (4) decide on non-Pakistan AOIs (label raw VIIRS / refit a second region), user decision; (5) soften "worst year" wording in the app.
- [x] **`api/` built (2026-11-14 evening).** FastAPI + DuckDB/NumPy over the parquet (loads in ~2 s, ~50 ms per calendar query). Run: `set -a; source .env; set +a; FC_CORS_ORIGINS=http://localhost:3000 py -3.14 -E -P -m uvicorn api.main:app --port 8000`. Endpoints: `/api/calendar`, `/api/hotspots.csv`, `/api/monthly.csv`, `/api/points`, `/api/overlap`, `/api/calibration`, `/api/regions.geojson`, `/api/current` (live FIRMS NRT, raw, any bbox ≤400 deg²), `/api/meta`, `/api/health`. AOI: `pakistan`, `region:PK-xx`, `bbox:`, `circle:`, `poly:`. Implements: same-day-window anomaly for the partial month, percentile + ratio only if median ≥5, count-dependent bands (Terra-scaled months use the wider of Terra and count bands), NRT provisional flags, Terra 2001 gap days flagged and dropped from baselines, worst-year wording ("among the highest" unless top.lo > runner-up.hi), Theil–Sen + Mann–Kendall trend claimed only if p<0.05 and change > band half-width. `api/export_static.py` writes the site's pre-rendered JSON (`web/content/data/`). `api/Dockerfile` for deploy. Province outlines: geoBoundaries gbOpen PAK ADM1 simplified (`data/boundaries/`, downloaded 2026-11-14 from the wmgeolab GitHub mirror because geoboundaries.org timed out).
  - **Not verified:** `/api/current` could not be tested end to end: `firms.modaps.eosdis.nasa.gov` timed out from this machine on 2026-11-14 evening (curl and Python). The endpoint returns a clean 502 in that case.
- [x] **`web/` built (2026-11-14 evening).** Next.js 16 (App Router, Cache Components) using the user's site-dna kit, instead of the Vite plan in §4 (user asked for site-dna). Pages: `/` (3D instanced calendar hero with React Three Fiber + SVG fallback), `/explore` (MapLibre + OpenFreeMap basemap, own polygon/box drawing, ECharts calendar/window/yearly charts, CSV/PNG/JSON downloads, live NRT panel), `/method`, `/data` (+ API reference), `/about` (requirements + SI usage). SEO: metadata, OG image, sitemap, robots (AI crawlers allowed), manifest, JSON-LD (Organization, WebSite, WebApplication, Dataset), `/llms.txt` + `/llms-full.txt`. `pnpm typecheck && pnpm lint && pnpm build` pass; every route is static. Env: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` (see `web/.env.example`). If the API is down, `/explore` falls back to the bundled Pakistan calendar (plan §4 fallback).
- [ ] Deploy: API (Render/Fly/HF Spaces, Dockerfile ready; 47 MB parquet ships in the image) and web (Vercel, root `web/`). Then set `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_API_URL` and `FC_CORS_ORIGINS`, and fill `repoUrl` in `web/content/site.json`.
- [x] **`/explore` redesigned map-first (2026-11-15 ~06:30).** Full-screen map with density heat on load; bottom timeline (80% band, era markers, play / ← → / Space / Esc); a selected month shows its hotspots (heat → dots, click popup with date/time/satellite/FRP/weight), the province anomaly choropleth (percentile vs the same month, or same day window for the partial current month), a day-by-day chart, and NASA GIBS true-colour imagery for the chosen day (Terra before 2018-04, NOAA-20 after; S-NPP tile test returned 404 so it is not used). New API: `/api/grid`, `/api/regions/stats`, `/api/daily`; `/api/points` returns date, time, FRP, day/night. All state lives in the URL (shareable). CSP allows `gibs.earthdata.nasa.gov`.
- [ ] Human check of the UI (map drawing, 3D hero, charts, new explorer, playback, imagery) in a browser, including 360 px mobile and reduced motion.
- [ ] API must implement: anomaly over the same day-window for the partial current month, percentile + ratio (only if baseline median ≥5), band from `validation.loyo_merged.band_by_count` (by predicted count) (wider `terra_scaling` band before 2002-07-06), NRT flagged provisional, months with no-data days flagged.
- [x] **Forecast shipped (2026-11-15 ~07:00).** `py -3.14 -E -P pipeline/forecast_fit.py` (~10 s, after build_harmonized) writes `data/forecast_model.json`; `GET /api/forecast?aoi=` (any AOI, ~50 ms); forecast card on `/explore`. Rolling origin 2015-12→2026-09: country h=1 skill +7.8% [90% CI +1.5, +13.1], 1° cells +5.2% [+3.5, +6.9], peak months cells +7.5%; h=3 not significant (said so in the UI). 80% band = out-of-sample residuals by predicted-count bucket; cross-fit coverage 0.79–0.80 per bucket, **country only 0.73–0.75** (slightly narrow). Beyond 3 months only the 10-year typical range is shown, labelled "not a forecast". Bands for small drawn areas are an extrapolation (validated on country + 1° cells).
- [x] **"Ask anything" assistant (2026-11-15 ~07:15).** `POST /api/ask` (Gemini via `AI_STUDIO` in `.env`, server side only; models `FC_AI_MODELS`, default `gemini-3.5-flash,gemini-3.5-flash-lite`) with function calling over read-only tools: history (`calendar`), forecast, place (`GET /api/place`), provinces (`regions/stats`), method facts. Answers in the user's language; numbers only from tools; general background labelled "not from our data". Rate limits: `FC_AI_PER_MIN` (8/IP), `FC_AI_PER_DAY` (1500). Floating widget on every page; knows the explorer's area/month. **Deploy:** set `AI_STUDIO` on the API host. Free-tier quota of the key: **not verified**.
- [ ] Old forecast note (2026-11-14 ~13:45): bake-off in `pipeline/explore/forecast_bakeoff.py` (report `data/explore/forecast_bakeoff_report.txt`). Chosen: **PERS** = log1p climatology of the last 10 years + pooled linear anomaly persistence (last month and last 12 months). h=1 skill vs 10-yr climatology (90% year-bootstrap CI): country +8.6% [+2.9, +13.4], 1° cells +6.3% [+4.2, +8.8], peak months cells +9.9%. LightGBM is statistically tied, so the simpler model wins. Chronos-2 not tested (Hugging Face HTTP 429). PERS country 80% band is too wide (coverage 0.98), so bands need refitting per level/count before use. Caveat: harmonization weights were fit on 2012–2022, which overlaps the test years (affects all models equally).
- [ ] Poisson GBM cross-check for the science panel (not in the pipeline yet; code in `pipeline/explore/common.py`).
- [ ] `.gitignore` currently ignores **`docs/`**. Decide whether docs belong in the public repo. Parquet is 47 MB (GitHub's limit is 100 MB per file).
- [ ] Read the **Project Submission and Judging guides** and write the exact required items into §8.
- [ ] Claim the useful **Global Offers** (cloud credits, Miro), if any are still needed.
- [ ] Keep [SI-LOG.md](../SI-LOG.md) up to date.
- [ ] Known Punjab burning peaks for the QA sanity check.
- [ ] Re-check the Resources tab on Sunday morning.
- [ ] Not verified: Terra's official status after Dec 2025; the Pakistan burning-time shift; the cause of the 2020–21 Aqua/VIIRS ratio anomaly; the cause of NOAA-21's higher FRP vs NOAA-20.

## 8. Submission must-haves (confirm with the Submission guide)

- [ ] Public app URL + public repo
- [ ] Demo video and/or slides (format per guide)
- [ ] Project description: problem, method, results, limitations
- [ ] **How SI (AI) tools were used.** Keep a running log during the event in [SI-LOG.md](../SI-LOG.md), recording the tool, what it did and what we checked by hand.
- [ ] NASA data used (FIRMS MODIS C6.1, VIIRS 375 m) + any partner data, with citations
- [ ] Local Impact paragraph: Punjab/Sindh crop burning, smog, health
