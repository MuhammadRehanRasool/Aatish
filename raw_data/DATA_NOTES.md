# Raw data notes (checked 2026-11-14)

All data is NASA FIRMS, the only resource listed on the challenge Resources tab (re-checked 2026-11-14).

## What's here (Pakistan)

| Sensor | Files | Coverage | Quality |
|---|---|---|---|
| MODIS (Terra+Aqua) | `modis/modis_YYYY_Pakistan.csv` | 2000-11-01 → 2025-12-31 | SP (standard) yearly country files |
| | `modis/modis_2026_Pakistan_SP.csv` | 2026-01-01 → 2026-08-31 | SP, area API, clipped |
| | `modis/modis_2026_Pakistan_NRT.csv` | 2026-09-01 → 2026-11-13 | NRT (`6.1NRT`), area API, clipped |
| VIIRS S-NPP | `viirs-snpp/viirs-snpp_YYYY_Pakistan.csv` | 2012-01-20 → 2025-12-31 | SP yearly |
| | `..._2026_Pakistan_SP.csv` / `_NRT.csv` | 2026-01-01 → 07-31 SP; 08-01 → 11-02 NRT | S-NPP NRT ends 2026-11-02 per FIRMS |
| VIIRS NOAA-20 | `viirs-jpss1/viirs-jpss1_YYYY_Pakistan.csv` | 2018-04-01 → 2025-12-31 | SP yearly |
| | `..._2026_Pakistan_SP.csv` / `_NRT.csv` | 2026-01-01 → 07-31 SP; 08-01 → 11-13 NRT | |

| VIIRS NOAA-21 | `viirs-jpss2/viirs-jpss2_2023-2026_Pakistan_SP.csv` | 2023-03-01 → 2026-07-31 | SP, area API, clipped (216,279 rows) |
| | `viirs-jpss2/viirs-jpss2_2026_Pakistan_NRT.csv` | 2026-08-01 → 2026-11-13 | NRT (`2.0NRT`, 13,305 rows) |
`firms_fetch.py` also writes `*_outside_polygon.csv` (bbox rows outside Pakistan); these were deleted 2026-11-14 as unused.
`boundaries/pak_adm0_gb.geojson` = geoBoundaries gbOpen PAK ADM0 (simplified), used for the clip.

FIRMS `data_availability` on 2026-11-14:
MODIS_SP to 2026-08-31, MODIS_NRT from 2026-09-01; VIIRS SNPP/NOAA20/NOAA21 SP to 2026-07-31;
VIIRS_SNPP_NRT ends 2026-11-02; NOAA-21 SP from 2023-03-01 (downloaded 2026-11-14).

## How 2026 was fetched

- No 2026 yearly country files exist (HTTP 404), and the `/api/country/` endpoint returned "Invalid API call".
- So: `/api/area/` with the Pakistan bbox, **DAY_RANGE max = 5** (from the FIRMS API page), then a point-in-polygon clip. Script: `pipeline/firms_fetch.py`.
- **Clip validated:** Nov 1–10 2025 via the area API + clip vs the official 2025 country file:
  VIIRS S-NPP 5,291 vs 5,282 rows, MODIS 903 vs 897, about 99.5% point-level match. Daily counts are within ±4; the differences are border points (FIRMS uses a slightly different boundary).
- The 2026 numbers can therefore be compared with the yearly files, with roughly 0.5% boundary noise.

## Gotchas found (must handle in the pipeline)

1. **NRT has no `type` column.** You can't filter `type == 0` for Aug–Nov 2026. GFED5NRT (Chen et al. 2026, ESSD) states the same for VIIRS NRT.
   **Rule for VIIRS NRT:** mask 0.01° cells with **more than 5** non-vegetation (type ≠ 0) detections in SP history. This follows GFED5NRT §2.3.2.
   Tested on 2025 with a mask built from ≤2024 S-NPP + NOAA-20 history: it catches 97.7% of static sources and wrongly masks 1.00% of vegetation fires. The ">=1" variant catches 98.1% but wrongly masks 1.24%. The MCD14ML-style "≥16 days/yr" rule catches 97.3% and wrongly masks 1.38%.
   **Rule for MODIS NRT:** use MODIS's own history with **no buffer**. It catches only 27%, but wrongly masks just 0.38%. Static sources are only 1.5% of MODIS detections.
   Buffers make it worse: 1 km catches 59% but wrongly masks 3.0%; 2 km catches 75% but wrongly masks 7.6%. Using the VIIRS mask on MODIS catches only 1–4%, because MODIS type 2 also includes urban-area pixels.
   MODIS NRT only covers Sep–Nov 2026, and the harmonized series after 2012 is VIIRS-based, so its impact is small.
2. **S-NPP outages:** stretches of zero detections while NOAA-20 still sees fires.
   2022-07-27 (15 d), 2024-05-30 (5), 2024-07-10 (6), 2024-07-24 (5), 2024-11-03 (3),
   2026-03-10 (3), 2026-04-28 (3, wheat season, NOAA-20 saw 197–300/day), 2026-07-11 (6), 2026-08-03.
   - **2022 is officially confirmed:** the VIIRS C2 BA User Guide v1.1 §6 says "extended S-NPP VIIRS outage from 27 July through 10 August 2022". Our data shows 0 from Jul 27 to Aug 10 and resumes on Aug 11, an exact match.
   - Apr 28–30 2026: zero in our data, and May 1 has normal passes. Exact official timestamps are not verified, because the MODAPS/LDOPE outage pages time out from here.
   - **End of S-NPP:** the last pass is 2026-11-02 at about 08:33 UTC (568 detections), with no night pass after it. FIRMS availability also ends on 11-02. The exact end time and the deorbit date are not verified.
   → Treat these as **no-data**, not zero. Exclude them from calibration pairs. Fill with NOAA-20 converted to S-NPP-equivalent. Detection rule: S-NPP is 0 while NOAA-20 is high on the same day (this reproduced the official 2022 window to the day).
3. **MODIS gaps:**
   - **2001:** Terra-only, zero detections from 2001-06-14 to 07-04. A 2001-06-15 → 07-03 Terra power-supply outage was claimed by a third party but is **not yet verified** officially. Mark Jun 14 – Jul 4 2001 as no-data.
   - **Aqua FMU outage, 16 Aug – 2 Sep 2020:** official, from C6.1 guide §7.2.4 (and Rev C). Only partial Direct Broadcast coverage. Pakistan still got Aqua detections (86 vs 121 in 2019), so treat it as partial, not missing.
   - Other MODIS zero days (13–43 per year, mostly in the Jul–Sep monsoon) can't be told apart from outages using this data alone.
4. **The `acq_time` format differs**: the yearly CSVs zero-pad it ("0746"), but the area-API CSVs don't ("746"). Parse it as an int everywhere.
5. **MODIS `version`:** `6.2` (2000–2017), `6.03` (2018–2022), `61.03` (2023+), `6.1NRT` (NRT).
   The official C6/C6.1 guide v1.0 §5.5 names MCD14ML files as `...CCC.VV` (CCC = collection, VV = product version, "currently 03"). Version 2 added lat/lon precision and the `dn` column. Version 3 = "significantly improved typing of hot spots".
   So 6.03 = C6 v03 and 61.03 = C6.1 v03, consistent with that naming. The FIRMS string format itself isn't documented there.
   **C6 vs C6.1 can be mixed** (§2.1): "sufficiently consistent to the extent that they may be freely intermixed". The global fire pixel difference was 0.001% (Jan 2020).
   **Caveat:** type-2 typing improved in v3 (2018+), so pre-2018 rows may contain more unflagged static sources (§7.2.3).
6. **NRT is provisional.** It will be replaced by SP, and the Rev C guide lists NRT as "not for time-series". Label it in the app.
7. **Official method constraints** (C6.1 guide §6/§7 caveats, GFED5NRT):
   - MCD14ML has no cloud or missing-observation info. Binning intervals shorter than ~8 days cause severe sampling bias, so **calibrate at monthly scale, not daily**. GFED5NRT likewise says scan-angle effects "largely average out over monthly timescales".
   - **MODIS orbital drift:** GFED5 ends in 2022 because Terra/Aqua drift exceeded "thresholds defined for high-quality science products". So prefer **2012–2022** as the calibration overlap and treat 2023+ MODIS as drift-affected.
   - VIIRS has no 10:30 overpass (Terra has one), so it can under-detect fires that peak in the late morning.
   - Merging S-NPP + NOAA-20 reduces viewing-geometry noise (GFED5NRT, citing Giglio et al. 2025).

## Sources used
- MODIS C6/C6.1 Active Fire User's Guide v1.0 (May 2021), https://modis-fire.umd.edu/files/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf (copy in docs/reference/)
- MODIS C6 Active Fire User's Guide Rev C (Dec 2020) and VIIRS C2 Burned Area User's Guide v1.1, provided by the user
- Chen et al. (2026), GFED5NRT, ESSD 18:7535–7555, doi:10.5194/essd-18-7535-2026

## From the VIIRS 375 m Active Fire User's Guide (VNP14/VNP14IMG v1.4, Jun 2018, Collection 1)
Note: our FIRMS VIIRS data is `version 2` (Collection 2), but this guide describes C1.
- The effective start of the VIIRS record is **20 Jan 2012**. This matches our first S-NPP row.
- Poorly calibrated input granules occurred Jan 2012 – Oct 2017. They are excluded from the VNP14IMGML archive files, but whether FIRMS SP excludes them too is not verified.
- NRT may have coverage gaps; "Scientific studies should use standard archives."
- 375 m vs 750 m: VIIRS 375 m finds more than 3× more fire pixels by day and more than 20× more at night.
  **Our data (Pakistan 2012–2022, type 0, MODIS conf ≥ 30 vs S-NPP n/h):** day 436,607 vs 108,951 points (**4.0×**), night 73,093 vs 4,998 (**14.6×**).
  → **Calibrate day and night separately.**
- The `type` field is defined in VNP14IMGML (0 = vegetation, 1 = volcano, 2 = static land, 3 = offshore). This matches what we see in the SP files.

## NOAA-21 check (2026-11-14)
- Monthly NOAA-21 / NOAA-20 detection ratio for Pakistan, Mar 2023 – Nov 2026 (45 months): median **0.96**, range 0.80–1.10, sd 0.06. The two sensors agree closely, so NOAA-21 works as a second VIIRS stream once S-NPP ends.
- Zero-detection days in NOAA-21 SP: 2024-02-27, 2024-02-28, 2024-04-14, 2025-08-18. Treat as no-data if NOAA-20 shows fires on those days.

## Findings from the harmonization research (2026-11-14, see docs/harmonization-research.md)
- **Orbital drift is visible in our data.** Median local solar time of daytime detections: Aqua 13:15 through 2022 Q3, then 13:31 (2023), 13:52 (2024), 14:23 (2025), 15:09 (2026). Terra 10:48 through 2021, then 10:41 (2022) down to 09:20 (2026). Measurable from 2022 Q4.
  Official (NSIDC / MODIS Land news): Aqua drifting since Jul 2021, projected 15:50 by Aug 2026. Terra projected 9:00 by Dec 2025.
- **Terra-only before 2002-07-06** (first Aqua row). (Terra+Aqua)/Terra per month-of-year is 1.6 (Apr) to 6.7 (Nov).
- **MODIS typing step in 2018:** the type≠0 share is ~0.1% in 2012–2017 and 1.6–2.2% from 2018 (version 6.03, v3 typing). Pre-2018 type-0 rows contain static sources.
- **Terra still in our data until 2026-11-10**, although MODIS Land news (updated 2025-11-13) gives Terra end of mission as Dec 2025. Current official status not verified.
- NOAA-20 → S-NPP count factor 0.975 (2018-04 → 2022-09, filtered, country-month).

## Findings from the pipeline build (2026-11-14 12:25, `pipeline/build_harmonized.py`, `pipeline/validate.py`)
- **NOAA-21 FRP runs higher than NOAA-20** (SP, non-static, 2023-03 → 2026-07): day median 5.30 vs 4.35 MW, night 1.79 vs 1.47. Share of day detections under 4 MW: 32% vs 45%. Counts are close (N21/N20 = 0.97 on days both are active). Partly explained: NOAA JPSS NOAA-21 AF readme (2023-06-01) documents an "up to ~10%" positive FRP bias from the M13 spectral response shift (NOAA operational product). Our FIRMS offset is a uniform ~21% at every quantile; the size difference is **not verified**. The pipeline now divides NOAA-21 FRP by 1.21 before binning (`f_sat` NOAA-21 then 1.005).
- **No-data rule outcome** (0 detections while another VIIRS satellite has ≥1, per date + day/night). Runs of ≥3 days:
  S-NPP 2018-07-24 (3), **2022-07-25 (17; flagged by the rule two days before the official 07-27 start)**, 2024-05-30 (5), 2024-07-10 (7), 2024-07-24 (6), 2024-11-03 (4), 2025-07-04 (4), 2025-09-07 (3), 2026-03-09 (5), 2026-04-28 (3), 2026-07-10 (7).
  NOAA-20 2023-07-19 (4), 2023-09-29 (3). NOAA-21 2024-02-26 (4). None of these is officially verified except the 2022 S-NPP window.
  A ≥10-detection threshold was tried and rejected because it misses most of the official 2022 window (monsoon, low counts). Even with both satellites working, NOAA-20 sees ≥10 on 23% of the days S-NPP sees only 1–2, so single-day flags can be genuine quiet days. The effect of such a false flag is small (the other satellite carries the day).
- **MODIS whole-sensor zero runs ≥7 d:** 2001-06-14 (21 d, the known Terra gap), 2001-08-19 (8 d), 2002-03-20 (10 d), 2025-09-07 (7 d, while VIIRS had 248 detections). Causes **not verified**. They're flagged in `data/no_data_days.csv`, not filled.
- **Static mask (one for all rows):** 1,443 cells at 0.01° (190 from VIIRS with >5 type≠0 SP detections; 1,262 from MODIS type≠0 2018+, threshold ≥1 detection). 142,398 rows flagged. 834 rows with type≠0 lie outside the mask and are counted as fires.
