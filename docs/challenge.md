# Our challenge: Harmonization of MODIS and VIIRS Hot Spots

The full statement was released on Oct 28 and saved here on 2026-10-30. Page: https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/
**Level:** Advanced, Intermediate · **Subjects:** Earth Science, Software · Partner: CONAE (Argentina's space agency).

## Resources tab (copied 2026-11-14)

> NASA does not endorse any non-U.S. Government entity and is not responsible for information contained on non-U.S. Government websites. For non-U.S. Government websites, participants must comply with any data use parameters of that specific website.

**NASA Data & Resources**
- **FIRMS** (NASA Earthdata: Fire Information for Resource Management System): https://www.earthdata.nasa.gov/data/tools/firms (the data portal itself is https://firms.modaps.eosdis.nasa.gov/) — global near real-time satellite imagery, active fire/hotspots and related products showing the location, extent and intensity of wildfire activity. Tools and applications provide geospatial data, products and services for the fire management community and the public.

**Nov 13 checklist outcome:**
- No pre-harmonized or reference dataset is given, so we build the harmonization ourselves and validate it on the overlap years (2012+), as planned.
- No sample area of interest is given, so the plan keeps Punjab/Sindh as the main region.
- No recommended method or paper is given, so we cite the papers from our own research.
- No new tools are listed. FIRMS (archive download + area API) is the only data source, and that matches the plan.
- Confirmed from a screenshot on 2026-11-14: the tab has **only** this one entry and no CONAE/partner section. The page says "more resources may be added", so check it again on Sunday morning.
- The Details text matches the statement saved on Oct 30. The only nuance is that it counts agricultural, land-clearing, waste and industrial burning as "burning activity". We still default to `type = 0`, but we add a toggle to include static/industrial sources and say so in the method.

## The problem in one paragraph

Satellites have tracked active fire hotspots for 20+ years, but the record is split across sensors that can't be compared directly. **MODIS** (Terra/Aqua, 2000+) has the long history but is nearing end of life. **VIIRS** (2012+) is replacing it, with finer resolution, different sensitivity and different overpass times. Fire managers therefore lack a consistent picture of when and where burning happened. Without harmonization, about 10 years of consistent fire tracking could be lost when MODIS shuts down, which the CONAE video stresses.

## What they want

**Part 1: Harmonization.** Combine the long MODIS series with VIIRS's continuity and detail into **one consistent hotspot time series**. "By the end of that phase the sensor of origin no longer matters." The focus becomes patterns, trends and anomalies.

**Part 2: Web app** on the harmonized data:
- The user selects a **region** (draw on a map, or enter lat/lon) and a **date range**.
- A **burning activity calendar** shows hotspot counts from the early 2000s to today: which months of the year burn most, which years were worst, and how a current fire compares with past ones.
- A **color ramp** makes the month-by-month differences readable. It should be accessible, so colorblind-safe.
- A **current month vs historical median** comparison, with anomalies against multi-year averages.
- **Downloads:** analytics and visualizations, plus a **CSV of the hotspots** found in the search.

**Audience:** early warning and emergency responders, scientists, land managers and firefighters.

## Requirements checklist (from the statement)

- [ ] Documented MODIS↔VIIRS harmonization method (the science part)
- [ ] Harmonized time series from the early 2000s to the present
- [ ] Interactive AOI selection (draw polygon / lat-lon input)
- [ ] Date range filter
- [ ] Calendar heatmap (years × months) of hotspot counts
- [ ] Anomaly view: current month vs historical median or average
- [ ] Accessible color ramp
- [ ] Key indices and figures (fires detected, historical comparison)
- [ ] CSV export of hotspots, plus downloadable charts and analytics
- [ ] Submission text describing how SI (AI) tools were used (global rule)

## Data and method

Data collection is done (2026-11-14). Coverage, quirks and sources are in [raw_data/DATA_NOTES.md](../raw_data/DATA_NOTES.md). The method is in [plan.md](plan.md) §3.

## Video notes

[Challenge intro (YouTube)](https://www.youtube.com/watch?v=tEPHsiZtuvk): CONAE presenter.
- 2:43–2:51: the sensors differ in resolution, sensitivity and observation schedule.
- 2:51–3:15: without a bridge to VIIRS, ~10 years of consistent fire tracking could be lost as MODIS retires.
- 3:20–4:03: harmonize MODIS history with VIIRS detail into a consistent time series.
- 4:16–4:34: the web app uses the harmonized data for a burning activity calendar with trends, anomalies, regions and dates.

## Space Apps Connect discussions (read 2026-11-14)

GitHub accounts marked "Collaborator" on nasa/spaceapps are volunteers or staff. They are not necessarily the challenge authors, so only GO Team accounts count as rulings.

- **#2011, GO Team ruling (CarolynW-GO-Team):** downloading FIRMS data (regional or global) before the 9:00 local start counts as working ahead, as does processing or converting it. Doing so can lead to disqualification.
  **We're clear:** every file in `raw_data/` was created on 2026-11-14 at 09:01:52 PKT or later.
- **#1879, accepted answer** (Collaborator account; not confirmed as the challenge author):
  - A MODIS-equivalent or VIIRS-equivalent series is fine "if properly justified".
  - The FIRMS standard archive is acceptable, since it's "the suggested NASA resource".
  - Continuity with **NOAA-20 and NOAA-21** is wanted.
  - **Monthly** time step is "a solid approach", weekly if it stays readable. Daily is too noisy for patterns.
- **#2016, accepted answer (Collaborator, not GO Team):** a single country or region is fine. A well-done regional harmonization beats weak global coverage. Design the app so other AOIs can be added.
- **#1786 (participants only):** someone else plans spatio-temporal matching of MODIS and VIIRS detections into "fire events", keeping unmatched ones labelled MODIS-only or VIIRS-only. They mention ~45 GB for the global CSV, which is unverified. Possible v2 idea for us: a match-rate panel on the overlap years.
- #1903 (SAR data) and #1805 (WebGL game) are other challenges and not relevant.
