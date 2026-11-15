import { API_URL, SITE_URL, site } from './content'
import { MONTHS_LONG, calibration, fmt, pakistan, regionSummary } from './data'

/**
 * Plain-text summaries for language models and answer engines (llms.txt convention).
 * Generated from the same JSON as the site, so the numbers never drift from the pages.
 */
export function llmsSummary() {
  const s = pakistan.stats
  const a = pakistan.anomaly
  const v = calibration.validation.loyo_merged
  return `# ${site.name}

> ${site.seo.description}

${site.name} is a web app and dataset built by team ${site.team} for the NASA Space Apps Challenge 2026 ("${site.challenge.title}"). It puts MODIS (Terra/Aqua, 1 km, since 2000) and VIIRS (Suomi NPP, NOAA-20, NOAA-21, 375 m, since 2012) satellite fire detections for Pakistan on one scale: MODIS-equivalent detections per month.

## Key facts (data to ${pakistan.data_extent.to})
- Coverage: Pakistan, ${pakistan.data_extent.from} to ${pakistan.data_extent.to}, monthly. Outside Pakistan the app only shows raw near-real-time FIRMS detections.
- Input: NASA FIRMS, ${fmt(calibration.rows_total)} detections; ${fmt(calibration.series_rows)} form the harmonized series.
- Method: each VIIRS detection gets weight w = P_aqua[FRP bin, day/night] x f[day/night, month] x L[1-degree cell, day/night, season], fitted on ${calibration.fit_window[0]} to ${calibration.fit_window[1]}. MODIS observed is used 2002-07-06 to 2022-09-30; Terra-only months before Aqua are scaled; from 2022-10 the series is VIIRS-derived.
- Validation (leave-one-year-out): country-month median absolute percentage error ${v.country_month.MdAPE}%, R2 ${v.country_month.R2}; 1-degree cell-month ${v.cell1_month.MdAPE}%, R2 ${v.cell1_month.R2}.
${s.peak_month ? `- Pakistan's peak burning month is ${MONTHS_LONG[s.peak_month.month - 1]} (median ${fmt(s.peak_month.median)} MODIS-equivalent detections, ${s.peak_month.share_pct}% of a typical year).` : ''}
${s.trend ? `- Trend ${s.trend.years[0]}-${s.trend.years[1]}: ${s.trend.pct_per_year}% per year (Theil-Sen on yearly totals); ${s.trend.claim ? 'significant and larger than the uncertainty band' : 'not distinguishable from the uncertainty band'}.` : ''}
${a ? `- ${MONTHS_LONG[a.month - 1]} 1-${a.window.split('-').pop()}, ${a.year} (provisional NRT): ${fmt(a.value)} MODIS-equivalent detections, ${a.ratio ? `${a.ratio.toFixed(2)} times` : 'compared with'} the median of the same days in ${a.baseline_years[0]}-${a.baseline_years[1]}; rank ${a.rank} of ${a.of}.` : ''}
- Provinces (peak month): ${Object.values(regionSummary)
    .filter((r) => r.label !== 'Pakistan' && r.peak_month)
    .map((r) => `${r.label} ${MONTHS_LONG[r.peak_month!.month - 1]}`)
    .join('; ')}.

## Pages
- [Explore](${SITE_URL}/explore): pick a province, draw an area or enter a point and radius; calendar heatmap, anomaly, yearly totals, CSV/PNG downloads.
- [Method](${SITE_URL}/method): the harmonization model, validation tables, uncertainty bands, limitations, references.
- [Data](${SITE_URL}/data): input streams, outages, HTTP API reference.
- [About](${SITE_URL}/about): challenge requirements, how AI tools were used, team.

## API
- ${API_URL}/api/calendar?aoi=region:PK-PB&from=2015-01-01&to=${pakistan.data_extent.to}
- ${API_URL}/api/hotspots.csv?aoi=pakistan&from=2025-10-01&to=2025-11-30
- aoi: pakistan | region:<ISO 3166-2, e.g. PK-PB> | bbox:w,s,e,n | circle:lon,lat,km | poly:lon,lat;lon,lat;...

## Caveats
- Detections are not fires, and fires are not burned area.
- Near-real-time months are provisional.
- Calibration is specific to Pakistan.
`
}
