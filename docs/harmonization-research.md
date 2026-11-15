# Harmonization research and evidence (2026-11-14, 11:00–11:30 PKT)

This file is the evidence behind the method in [plan.md](plan.md) §3. Online research came first, then every key assumption was tested on our own Pakistan data. The scripts are in `pipeline/explore/` (`load_all.py`, `drift_check.py`, `method_bakeoff.py`, `checks2.py`) and can be re-run.

Filters in all tests: `type == 0`, MODIS `confidence ≥ 30`, VIIRS `confidence ∈ {n, h}`. The official S-NPP outage (2022-07-27 → 08-10) and the Aqua FMU window (2020-08-16 → 09-02) are excluded.

## 1. What the literature says (verified sources only)

| Source | What it gives us |
|---|---|
| Schroeder, Oliva, Giglio, Csiszar (2014), RSE 143:85–96, doi:10.1016/j.rse.2013.12.008 | VIIRS 375 m algorithm builds on MODIS MOD14 contextual approach. It finds ~3× more fire pixels than the VIIRS 750 m product by day and ~25× more at night. This explains why the day/night ratios differ. |
| Giglio, Schroeder, Justice (2016), RSE 178:31–41, doi:10.1016/j.rse.2016.02.054 | MODIS C6 algorithm. Detection gains were "driven largely by fire size", so small fires are where the sensors diverge. |
| Vadrevu & Lasko (2018), Remote Sens. 10(7):978, doi:10.3390/rs10070978 | Indian Punjab, 2012–2016: VIIRS 4.8× MODIS Terra+Aqua and 6.5× Aqua-only. Monthly FRP sums correlate at r² = 0.98. **No fire-count regression, no seasonal ratios, no spatial matching.** |
| Chen et al. (2026), GFED5NRT, ESSD 18:7535–7555, doi:10.5194/essd-18-7535-2026 | Closest operational analogue. Uses a **ratio of totals** (burned area per VIIRS detection) per region × land-cover class, fitted on **2012–2022**. Combines S-NPP and NOAA-20 as the **arithmetic mean** and falls back to one satellite when the other is missing. No NOAA-20 vs S-NPP correction factor. Static mask: 0.01° cells with >5 type≠0 detections. GFED5 "ends in 2022, when orbital drift-induced changes surpassed the thresholds defined for high-quality science products". |
| Giglio et al. (2025), RSE 331:115006, doi:10.1016/j.rse.2025.115006 (as cited by GFED5NRT; we did not read it) | Merging VIIRS platforms reduces day-to-day noise from viewing geometry. Scan-angle effects "largely average out over monthly timescales". |
| NSIDC MODIS page + MODIS Land news (modis-land.gsfc.nasa.gov/news.html, last updated 2025-11-13) | Terra: last maneuver Feb 2020, 10:15 MLT by Oct 2022, projected **9:00 by Dec 2025**. Aqua: final maneuvers 2021-03-18, drifting later since Jul 2021, past 13:45 in Feb 2023, projected **15:50 by Aug 2026**. "End of the mission" given as **Dec 2025 (Terra)** and **Aug 2026 (Aqua)**. |
| Zheng et al. (2026), Remote Sens. 18(10):1650, doi:10.3390/rs18101650 (abstract only) | MYD14 + VNP14IMG FRP fusion: duplicate correction, footprint matching, VZA-dependent correction. Works at the FRP and pixel level, so it's heavier than we need for monthly counts. |
| ISRO study, *Current Science*, 2025-11-25 (via Tribune news; **paper not read**) | In Indian Punjab and Haryana, SEVIRI shows the peak burning time moving from ~13:30 (2020) to ~17:00 (2024), apparently to avoid polar-orbiter overpasses. **Not verified for Pakistan.** |

**No paper gives a MODIS↔VIIRS hotspot-count calibration we could reuse.** We have to build and validate our own, which is what the challenge expects.

Not readable (HTTP 403): Earthdata "Aqua MODIS Acquisition Plan Through August 2026" and the VIIRS C2 AF 375 m User Guide v1.2 PDF. Their contents are **not verified**.

## 2. Assumptions we doubted, and what the data said

| # | Assumption in the old plan | Test | Verdict |
|---|---|---|---|
| A1 | Fit on **2012–2022** | Median local solar time of daytime detections per year/quarter (`drift_check.py`) | **Partly wrong.** Aqua holds at 13:15 through 2022 Q3, then 13:31 (2023), 13:52 (2024), 14:23 (2025), **15:09 (2026)**. Terra holds at 10:48 through 2021, then 10:41 (2022), 10:27, 10:09, 09:49, **09:20 (2026)**. Drift is measurable from **2022 Q4**. → Fit window **2012-01-20 → 2022-09-30**. |
| A2 | Snapping to a ~1 km grid and counting cells removes the resolution difference | Same methods, points vs 1 km cells per satellite-day-daynight (`method_bakeoff.py`) | **Wrong.** Cells are never better, and slightly worse (country MdAPE 13.1% points vs 14.3% cells). The gap is small-fire *sensitivity*, not one fire producing several pixels. → **Drop grid-snap.** |
| A3 | `MODIS_eq = a·VIIRS^b` (log-log), one fit per region (v1) | Leave-one-year-out CV | **Worst method tested.** Country MdAPE 29.7%, R² 0.80. It is also **not additive**: applied per 1° cell it gets RMSLE 0.88, and sums over a user-drawn AOI would not match. |
| A4 | A season-specific fit is only a v2 extra | Ratio per (day/night × month-of-year) | **This is the core of the method.** MdAPE 29% → **13%**, R² 0.79 → **0.94**. The ratio swings from 2.1 (Aug) to 7.3 (Jun) by day and from 7.6 to 36 at night, so one number per region is wrong. |
| A5 | MODIS 2001–2011 is one homogeneous series | Satellite start dates | **Wrong.** Before 2002-07-06 there is **Terra only** (21 months). (Terra+Aqua)/Terra ranges 1.6 (Apr) to **6.7 (Nov)**, with year-to-year CV up to 0.36 in Oct–Nov. → Scale and flag that period. |
| A6 | `type == 0` filters the same way in every year | type≠0 share per year | **Wrong for MODIS.** type≠0 is ~0.1% for 2012–2017 and **1.6–2.2% from 2018**, the same year version 6.03 (v3 typing) starts. Pre-2018 MODIS has static sources labelled as vegetation. → Use **one location-based static mask** for all sensors and all years (it also fixes NRT, which has no `type`). |
| A7 | Ratio is stable over time (needed for trend claims) | LOYO bias per year | **Mostly yes.** Yearly bias is within **±8%** for 2013–2022. 2012 is −14.5%, which matches the documented 2012–2017 poorly calibrated VIIRS granules (VNP14 guide). Trend claims under ~±10%/yr are within noise. |
| A8 | NOAA-20 can replace S-NPP | Fit on S-NPP 2012–2017, apply to NOAA-20 2018-04 → 2022-09 | **Yes.** NOAA-20 → S-NPP factor 0.975. MdAPE 12.7% vs 14.5% with S-NPP itself. Mean(S-NPP, NOAA-20) gives **12.0%**, so merging helps, consistent with GFED5NRT / Giglio 2025. |
| A9 | MODIS after 2022 is still usable as truth | Model fit to Sep 2022, applied after; obs/pred by satellite and season | **No.** Yearly totals look fine (0.96–1.03) only because errors cancel. **Terra Oct–Nov obs/pred = 0.41 (2022), 0.61, 0.40, 0.30 (2025)**: the morning overpass misses the afternoon rice burning. **Aqua Oct–Nov = 1.22, 1.47, 1.28, 1.21**: the later overpass catches more. → From 2022-10, MODIS is not a consistent instrument, so use VIIRS-derived values. |
| A10 | Terra ended Dec 2025 (NASA page) | Terra rows in our files | **Data still flows**: Terra rows exist up to 2026-11-10 (89 NRT rows Sep–Nov 2026). The current official status is **not verified**. It does not matter for us after A9. |
| A11 | A spatially uniform ratio is enough for small AOIs | Ratio × local (1° cell × day/night × season) adjustment with shrinkage, at the 1°-cell scale | **Local adjustment helps**: MdAPE 25.0% → **20.3%**, R² 0.89 → **0.92**. |

Unexplained, reported as-is: Aqua Oct–Nov obs/pred was already 1.20 in 2020–2021, before drift. Apr–May 2020–2021 was 0.6–0.7 for both Terra and Aqua. Possible causes (burning-time shift, COVID-era practices) are **not verified**.

## 3. Bake-off numbers (leave-one-year-out, 2012-01-20 → 2022-09-30)

| Scale | Method | Bias % | MdAPE % (months ≥20 fires) | RMSLE | R² |
|---|---|---|---|---|---|
| Country-month | one global ratio | 0.0 | 29.8 | 0.457 | 0.788 |
| Country-month | ratio per day/night | 0.1 | 28.9 | 0.437 | 0.792 |
| Country-month | power law per day/night (old v1) | 1.2 | 29.7 | 0.448 | 0.798 |
| Country-month | **ratio per day/night × month-of-year** | −0.1 | **13.1** | **0.267** | **0.936** |
| 1° cell-month | ratio per day/night × month-of-year | −0.1 | 25.0 | 0.599 | 0.888 |
| 1° cell-month | power law applied per cell | 2.0 | 27.2 | 0.878 | 0.788 |
| 1° cell-month | **+ local cell × day/night × season adjustment (shrunk)** | −0.5 | **20.3** | **0.579** | **0.920** |

(1 km cells instead of points: the same ranking, every number slightly worse.)

## 4. Why "MODIS-equivalent" is the base unit

- Going **VIIRS → MODIS** is a *degradation*: it predicts what a coarser, less sensitive sensor would have seen, which is well-posed. Going **MODIS → VIIRS** asks the model to invent small fires MODIS never saw, which is ill-posed (a MODIS zero gives a VIIRS-equivalent zero).
- The ratio model is multiplicative per (cell, day/night, month-of-year). So "VIIRS-equivalent" is the exact inverse and can be offered as a **display toggle**. **Anomaly percentiles are identical in both units**, because every year of a given calendar month is scaled by the same factor.
- The additive per-point weight means **any AOI sum is consistent**: country = sum of provinces = sum of cells. The API becomes `SUM(w)` in DuckDB.

## 5. Ideas considered but not adopted

- **FRP-threshold degradation** (drop VIIRS detections below MODIS-detectable FRP). Physically appealing, but the MODIS detection limit depends on scan angle, and we have no tested threshold. Not tested; a possible v3.
- **Event or pixel matching** (discussion #1786, Zheng 2026). Needs near-simultaneous pairs and footprint geometry. Too heavy for monthly counts; could become a "match-rate" science figure if there is time.
- **Aqua-only target.** It would avoid the Terra 10:30 problem, but it throws away half of the MODIS record, and FIRMS MODIS = Terra+Aqua is what users know.

## 6. Round 2–4: trying to beat the ratio model (2026-11-14, ~11:40–12:10 PKT)

Scripts: `pipeline/explore/method_bakeoff2.py`, `method_bakeoff3.py`, `method_bakeoff4.py` (shared data in `common.py`).

**Inspiration:** Sofiev & Kouznetsov (GMD 19:10123, 2026; earlier as EGUsphere preprint egusphere-2026-89, *abstract and search snippets only, not read in full*). They treat the FRP detection limit as a function of pixel area. MODIS's limit is ~3.7 MW at nadir on a clear night and up to ~40 MW for a daytime side view. So VIIRS's extra detections are the low-FRP fires MODIS cannot see, and the right weight for a VIIRS detection depends on its FRP.

**New method: detection-probability weighting.** We measured this ourselves. For each S-NPP detection, we checked whether Aqua (same day, same day/night, both at ~13:10 LST) has a detection within 1.5 km:

| S-NPP FRP (MW) | <1 | 1–2 | 2–4 | 4–8 | 8–16 | 16–32 | ≥32 |
|---|---|---|---|---|---|---|---|
| P(Aqua detects), day | 0.011 | 0.024 | 0.044 | 0.083 | 0.130 | 0.205 | 0.320 |
| P(Aqua detects), night | 0.010 | 0.038 | 0.116 | 0.243 | 0.388 | 0.556 | 0.475 |

The curve is monotonic, and night is more sensitive than day, as in Sofiev & Kouznetsov. It also **explains the month-of-year effect**: 56–60% of daytime S-NPP detections in Oct–Dec are <4 MW, against 28–32% in Apr–May. So the rice season has more fires that MODIS can't see.

Per-point weight: `w = P_aqua(FRP bin, dn) × f[dn, month-of-year] × L[1° cell, dn, season]`. `f` absorbs Terra, unmatched Aqua and overpass offsets. `L` is the shrunk local adjustment. The weight is still additive.

**Results** (country-month / 1° cell-month; MdAPE on months ≥20; `rank_rho` = mean Spearman of year ranks within each calendar month; `pctl_err` = mean percentile-rank error in pp):

| Method | Country MdAPE | Country RMSLE | Country R² | Cell MdAPE | Cell RMSLE | Cell R² | rank_rho | pctl_err |
|---|---|---|---|---|---|---|---|---|
| ratio[dn, moy] (previous) | 13.1 | 0.267 | 0.936 | 25.0 | 0.599 | 0.888 | 0.797 | 12.4 |
| ratio + local (previous best) | 13.4 | 0.264 | 0.932 | 20.3 | 0.579 | 0.920 | 0.804 | 12.4 |
| FRP-bin NNLS (free weights) | 22.3 | 0.402 | 0.902 | 29.1 | 0.705 | 0.868 | 0.846 | 10.2 |
| FRP-bin NNLS + moy | 9.6 | 0.275 | 0.968 | 25.7 | 0.684 | 0.894 | 0.814 | 11.3 |
| Poisson gradient boosting (cell-month, redistributed to points) | 11.5 | **0.216** | 0.951 | 19.6 | **0.518** | 0.921 | 0.848 | **10.4** |
| **detection-prob. weight + moy + local** | **10.7** | 0.234 | **0.956** | **17.7** | 0.562 | **0.941** | **0.849** | 10.7 |
| mean(detection-prob., GBM) | 10.7 | 0.217 | 0.956 | 18.2 | 0.520 | 0.939 | 0.848 | 10.6 |

- **Forward-in-time** (train 2012–2017, test 2018–2022-09): detection-prob. weight gives country MdAPE **11.0**, cell MdAPE **18.1**, cell R² **0.943**. That beats ratio+local (14.9 / 19.7 / 0.912). GBM is 13.2 / 20.0 / 0.902. The method extrapolates in time.
- **NOAA-20 transfer** (S-NPP-fitted, applied to NOAA-20 points): detection-prob. weight gives bias +4.6%, country MdAPE **8.5**, cell R² 0.947. GBM: +1.9%, 9.9, 0.911. NOAA-20 and S-NPP median daytime FRP are 4.28 vs 4.26 MW, so the FRP curve transfers.
- The free NNLS weights are not physical (0 weight for 4–16 MW by day) because the bins are collinear. **Using the measured curve as a fixed shape is what makes it work.**
- **FRP sums instead of counts (rejected):** country MdAPE 12.4 vs 11.0 for counts, and the within-month ratio CV is 0.227 vs 0.208. FRP is not more stable here.
- **Uncertainty bands:** 80% intervals from per-month residual quantiles cover only **65%** of held-out months, because ~10 residuals per month is too few. Intervals from **pooled** residuals (all months) cover **78–79%**. → Use pooled LOYO log-residual quantiles for the bands.
- Caveat: the matching uses a fixed 1.5 km radius and ignores the ~10 min S-NPP/Aqua time gap and MODIS pixel growth at the scan edge. The radius was not tuned (no sensitivity test yet).

**Decision:** ship the **detection-probability weight** as the main method. It is the best or tied on most metrics, extrapolates best, and is physically explainable, which matters for the science panel: "MODIS sees 2% of the 1–2 MW fires VIIRS sees and 32% of the >32 MW ones". GBM is kept as an **independent cross-check** in the science panel. The ensemble is only marginally better and adds a black box.

## 7. Self-audit (2026-11-14, ~12:30–12:50 PKT)

Asked by the user to counter-check the method online and critique it. Scripts: `pipeline/explore/self_audit.py`, `self_audit2.py` (parquet only, LOYO 2012-01-20 → 2022-09-30, merged VIIRS input as in production).

### 7.1 Online checks

| Source | Status | What it says / means for us |
|---|---|---|
| NOAA JPSS "NOAA-21 Provisional maturity" readme (Csiszar, 2023-06-01), star.nesdis.noaa.gov | **Read in full** | "the spectral shift of the VIIRS M13 Spectral Response Function towards a more transparent spectral region of the atmosphere results in a minor (up to ~10%) positive bias between NOAA-21 and Suomi NPP or NOAA-20." Detections: "high level of consistency between the three products". Algorithms identical "with the exception of the coefficient used in the fire radiative power retrieval". This is the **NOAA operational (NDE)** product; whether the NASA product in FIRMS has the same bias or correction is **not verified**. |
| Li, Zhang, Kondragunta (2020), Remote Sens. 12(10):1561, doi:10.3390/rs12101561 | **Search snippet only** (MDPI 403) | Africa: MODIS misses many low-intensity fires (daily FRP underestimated ≥42.8% vs VIIRS); underestimation depends on grid size and view angle; adjustment models at 0.05–0.5°. Supports the FRP-dependent weighting idea. Details not read. |
| Fu et al. (2020), Remote Sens. 12(18):2870 | **Search snippet only** | NE Asia: 65% (forest) and 83% (low-biomass) of VIIRS fire pixels missed by MODIS. Same order as our low P_aqua. Not read. |
| Csiszar et al. (2012), AMS talk "Establishing active fire data continuity between Aqua MODIS and Suomi NPP VIIRS" | **Search snippet only** | Daily maps do not match, aggregated statistics are compatible. Supports monthly aggregation. Not read. |
| ISRO, *Current Science* 2025-11-25 (burning-time shift, NW India) | **News reports only** | Peak burning ~13:30 (2020) → ~17:00 (2024). A rebuttal is reported in the press (source unclear). Paper not read; Pakistan not covered. |
| FIRMS geostationary layer (Meteosat IODC etc.) | **Search snippet only** (earthdata.nasa.gov 403) | FIRMS lists Meteosat 9 (IODC) among geostationary sources, "provisional". Whether it covers Pakistan in FIRMS and how far back the archive goes is **not verified**. |
| Boschetti, MODIS ST meeting 2023 "Is the world burning less?" | **Not readable** (connection refused) | Harmonized MODIS/VIIRS burned area per search snippet. Method not verified. |

Still true after this round: no peer-reviewed, reusable MODIS↔VIIRS **hotspot-count** calibration was found. Other Space Apps 2026 teams' public repos (search results) use OLS / linear calibration on gridded counts (not reviewed in detail).

### 7.2 Data checks of our own weak spots

| # | Suspicion | Result | Verdict |
|---|---|---|---|
| S1 | No-data rule with `ref_min=1` inflates weights on quiet days (one satellite 0 by chance → the other gets weight /1 instead of /2) | 109 of 175 rule runs have <5 detections on the other satellite in total, but the excess weight is **4.5 MODIS-eq of 46,127 (0.01%)**; worst month 2025-08 +1.2% | **Not a problem.** Keep. |
| S2 | Headline R² 0.956 overstates skill, because the seasonal cycle dominates | Country-month, LOYO: raw log R² 0.960, but **deseasonalised (anomaly) R² 0.731**, anomaly corr 0.855. Within-month percentile error mean **10.4 pp**, 90th pct **23.6 pp**. Above/below-median agreement **84.5%**. Same "worst year" per calendar month: **6/12** | **Real.** The anomaly product is what users see, and its skill is moderate. Report these numbers, not only R². |
| S3 | Is that error the method's fault, or Terra's 10:30 overpass that VIIRS can't see? | Aqua-only target: anomaly R² 0.707, pctl err 10.4 pp (no better). **Reference: Terra vs Aqua monthly anomalies correlate at only 0.875**, our VIIRS-derived vs MODIS 0.855 | The remaining error is close to the sampling noise **between two MODIS instruments**. Our method is near that floor; a fancier model cannot remove sampling noise (clouds, swath, timing). |
| S4 | One pooled uncertainty band fits all AOIs | 1° cell-month log1p residual q10/q90 by predicted count: <2 [−0.63, +0.57]; 2–5 [**−1.27**, +0.52]; 5–20 [−0.89, +0.42]; 20–100 [−0.43, +0.32]; >100 [**−0.26, +0.25**]. Shipped pooled: [−0.72, +0.55]. Error by cell size: 0.25° MdAPE 23.8%, 0.5° 20.9%, 1° 17.1% | **Real.** Band too wide for big AOIs, too narrow on the low side for small ones. → **Count-dependent bands.** |
| S5 | NOAA-21 handled by a scalar `f_sat` | N21/N20 FRP quantile ratio is **~1.21 at every quantile, day and night** (a uniform multiplicative offset, about twice NOAA's "up to ~10%"). Rescaling NOAA-21 FRP by 1/1.20 before binning gives N21/N20 weight ratio 0.979 vs count ratio 0.972; "as is" 1.124 | **Improve.** An FRP rescale is the physical fix (the bin curve is non-linear, so a scalar is only right for the average fire-size mix). The magnitude (21% vs ≤10%) is unexplained, **not verified**. |
| S6 | Shrinkage k=200 untuned | k 25…1000: cell MdAPE 17.1–17.4, RMSLE 0.533–0.547 | Insensitive. Keep. |
| S7 | Burning-time shift in Pakistan (ISRO finding for India) | Oct–Nov share of Terra (10:30) in daytime MODIS: 0.15–0.21 (2012–16), 0.12–0.17 (2017–21), then drift. S-NPP night share: no trend | **Inconclusive** from our data. Cannot be fixed by harmonization; it is a caveat on what "detections" mean. |

### 7.3 Problems in the plan (not the method)

- **"Draw any AOI worldwide"**: P, f, L are fitted on Pakistan. Applying them to the Amazon or Argentina is not validated, and those AOIs have no harmonized history, so no anomaly is possible. Either label such AOIs "raw VIIRS, not harmonized, no baseline", or refit the pipeline for a second region (it is region-agnostic and runs in ~30 s once the data is downloaded).
- **Wording of P_aqua:** it is "probability that Aqua has a detection within 1.5 km on the same day", which mixes detection sensitivity with clouds between overpasses, swath geometry and pixel size. Don't call it the pure MODIS detection probability in the pitch.
- **"Worst year" and percentile claims** must respect S2: only 6/12 calendar months pick the same worst year. Show a rank or percentile only with its band, and say "among the highest" unless the margin exceeds the band.

### 7.4 Implemented (12:50–12:55 PKT)

- **S4 → count-dependent bands** in `calibration.json → validation.loyo_merged.band_by_count` (`fc_lib.residual_table`, `band_by_count`). Nested LOYO coverage of the 80% band per bucket: 0.83 / 0.80 / 0.80 / 0.80 / 0.79 / 0.76 (the last bucket, ≥1000, has n=50).
- **S5 → NOAA-21 FRP / 1.21** before binning (`fc_lib.fit_frp_scale`, `apply_frp_scale`). `f_sat` NOAA-21 0.869 → 1.005. Series change ≤0.2%. The Jul–Aug N21/N20 dip (0.89 / 0.84) did not change, so it has another cause (**not verified**; low monsoon counts are one candidate).
- **S2/S3 → anomaly skill** and the Terra-vs-Aqua noise floor are stored in `calibration.json` and asserted in `validate.py` (anomaly corr must stay within 0.05 of the floor).
- Unchanged by design: S1 (no-data rule), S6 (k), the core P×f×L model.
