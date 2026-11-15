# FireCalendar: NASA Space Apps 2026, MODIS + VIIRS hotspot harmonization

Team **Aero Snipers**, Karachi local event. This repo holds the whole project from start to finish: data, pipeline, API, web app, docs and submission material.

**Deadline: Sun 2026-11-15, 23:59 PKT.** Aim to submit by 22:00–23:00 (see the timeline in `docs/plan.md` §6).

## Rules (from the user, not negotiable)

1. **Do not infer or assume anything.** If you don't know something, check it against an official source (FIRMS/Earthdata pages, the user guides in `docs/reference/`, spaceappschallenge.org, nasa/spaceapps GitHub discussions) or ask the user. Mark anything unverified as "not verified" in the docs.
2. Everything for this project lives in this folder. Don't read or write files outside it unless the user asks you to.
3. **Log every meaningful AI contribution in `SI-LOG.md`**: the tool, what it did, and what was checked by hand. The submission must describe how SI (AI) tools were used.
4. Event rule: no work from before 2026-11-14 09:00 PKT may be used. That includes downloading or processing data (GO Team ruling, discussion #2011). All of `raw_data/` was created after that time.

## Read first

| File | What it is |
|---|---|
| `docs/plan.md` | **The plan**: pitch, scope, harmonization method (§3), architecture (§4), roles, timeline, **current status and open items (§7)**, submission checklist (§8) |
| `raw_data/DATA_NOTES.md` | **Data facts and gotchas**: coverage per sensor, NRT vs SP, outages, static-source masks, version strings, sources. Read it before touching any data code |
| `docs/challenge.md` | Challenge statement, requirements checklist, Resources tab, Space Apps Connect rulings |
| `docs/event.md` | Event logistics, dates, awards, links, status log |
| `docs/reference/` | Official user guides: MODIS C6/C6.1 Active Fire v1.0 (PDF), MODIS C6 Rev C, VIIRS VNP14 v1, VIIRS C2 Burned Area v1.1 (Markdown) |

Keep `docs/plan.md` §7 (status) and `raw_data/DATA_NOTES.md` up to date as work progresses.

## Layout

```
raw_data/            FIRMS CSVs for Pakistan, read-only (never edit or overwrite)
  modis/             MODIS Terra+Aqua, 2000-11 → 2026-11-13
  viirs-snpp/        VIIRS S-NPP, 2012-01-20 → 2026-11-02 (end of the satellite's data)
  viirs-jpss1/       VIIRS NOAA-20, 2018-04 → 2026-11-13
  viirs-jpss2/       VIIRS NOAA-21, 2023-03 → 2026-11-13
  boundaries/        geoBoundaries PAK ADM0, used for clipping
  AttributesReadme.txt, DATA_NOTES.md
pipeline/            Python data scripts
  firms_fetch.py     FIRMS area API → clipped CSV (5-day chunks, quota-aware)
  audit_raw.py       per-file coverage/version/type audit of the yearly files
  fc_lib.py          shared loader, static mask, no-data rule, Aqua matching, fit/weights, metrics
  build_harmonized.py  raw_data/ → data/harmonized_points.parquet, calibration.json, no_data_days.csv (~30 s, deterministic)
  validate.py        parquet-only refit + LOYO/transfer asserts, radius sensitivity, seam/overlap checks (exit 1 on failure)
  explore/           research scripts (don't edit; evidence for docs/harmonization-research.md)
data/                derived outputs (regenerable). Main series = SUM(w_modis_eq) WHERE series_role<>'excluded' AND NOT static_flag
docs/                plan, challenge, event, reference guides
SI-LOG.md            AI usage log (required for the submission)
```

Planned (`docs/plan.md` §4): `pipeline/` produces `harmonized.parquet`; `api/` (FastAPI + DuckDB over Parquet); `web/` (Vite + React, MapLibre + draw, ECharts heatmap). Put derived data in a separate folder such as `data/`, never in `raw_data/`.

## Data rules (details in DATA_NOTES.md)

- File naming: yearly SP files are `<sensor>_<YYYY>_Pakistan.csv`. 2026 is split into `_SP.csv` + `_NRT.csv`. NOAA-21 SP is one file, `viirs-jpss2_2023-2026_Pakistan_SP.csv`.
- **NRT files have no `type` column.** Use the static-source masks from DATA_NOTES gotcha 1.
- `acq_time` is zero-padded in yearly files and not in area-API files. Parse it as an int.
- Confidence: MODIS is numeric 0–100, VIIRS is `l`/`n`/`h`.
- Zero-detection stretches during known outages (S-NPP, MODIS 2001) are **no-data, not zero fires**. Exclude them from calibration.
- Calibrate at **monthly** scale, **day and night separately**, fit on 2012–2022 (MODIS drift after that).
- NRT is provisional: label it as such in the app.

## Environment

- **Run the app:** `.\dev.cmd` (or `.\dev.ps1`) from the repo root starts the API (:8000) and web (:3000) together and loads `.env`. Ctrl+C stops both. Options: `-Open`, `-Reload`, `-ApiPort`, `-WebPort`. A port that is already serving gets reused rather than started twice.
- Windows 11. `python` is **not** on PATH in Git Bash. Use `py -3.14` (pandas is installed there). Running with `-I` breaks pandas imports because its dependencies live in user site-packages, so use `-E -P` instead.
- FIRMS key: `.env` holds `FIRMS_MAP_KEY` (gitignored, never print or commit it). `firms_fetch.py` reads it from the environment:
  `set -a; source .env; set +a; py -3.14 pipeline/firms_fetch.py VIIRS_NOAA20_NRT 2026-11-10 2026-11-13 out.csv raw_data/boundaries/pak_adm0_gb.geojson`
- FIRMS area API limits: DAY_RANGE ≤ 5 per call, and about 5000 transactions per 10 minutes (the script pauses on its own).
- Not a git repo yet. `.gitignore` is ready. The submission needs a **public** repo, so check file sizes before pushing (largest raw file is ~17 MB).
