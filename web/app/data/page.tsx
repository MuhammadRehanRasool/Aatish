import type { Metadata } from 'next'

import { Kicker, SectionHead, TextLink } from '@/components/primitives'
import { PageHeader } from '@/components/site/PageHeader'
import { API_URL } from '@/lib/content'
import { calibration, fmt, fmtDate, pakistan } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Data, downloads and API',
  description:
    'NASA FIRMS MODIS C6.1 and VIIRS 375 m (S-NPP, NOAA-20, NOAA-21) detections for Pakistan, 2000–2026: coverage, known outages, file formats, and the Aatish HTTP API for calendars, hotspots CSV and live NRT lookups.',
  alternates: { canonical: '/data' },
}

const streams = [
  ['MODIS Terra + Aqua', 'Collection 6.1, 1 km', '244,020', '1 Nov 2000 → 13 Nov 2026', 'Standard archive to 31 Aug 2026, then NRT'],
  ['VIIRS Suomi NPP', '375 m', '872,217', '20 Jan 2012 → 2 Nov 2026', 'End of S-NPP data in our files'],
  ['VIIRS NOAA-20', '375 m', '540,990', '1 Apr 2018 → 13 Nov 2026', 'Standard archive to 31 Jul 2026, then NRT'],
  ['VIIRS NOAA-21', '375 m', '229,584', '1 Mar 2023 → 13 Nov 2026', 'Standard archive to 31 Jul 2026, then NRT'],
]

const endpoints = [
  ['GET /api/calendar', 'aoi, from, to, static, unit', 'Monthly series with 80% bands, roles, provisional flags, per-month percentile, yearly totals, peak month, trend, and this month against the same days in other years.'],
  ['GET /api/hotspots.csv', 'aoi, from, to, static, series_only', 'Every detection in the area and range with its harmonized weight, sensor, confidence and FRP (limit 1,000,000 rows).'],
  ['GET /api/monthly.csv', 'aoi, from, to, static, unit', 'The monthly table as CSV.'],
  ['GET /api/points', 'aoi, ym, static', 'One month of series detections for mapping (heaviest 40,000).'],
  ['GET /api/overlap', 'aoi, static', 'MODIS observed vs VIIRS-derived per month since 2012, plus the Terra/Aqua drift check.'],
  ['GET /api/calibration', '—', 'All fitted parameters and validation metrics.'],
  ['GET /api/current', 'bbox, days (1–31), source', 'Raw NRT detections from the FIRMS area API for any bounding box worldwide (not harmonized).'],
  ['GET /api/forecast', 'aoi, static', 'Experimental forecast of the next 1–3 months with an 80% range (climatology + anomaly persistence, rolling-origin tested), plus the typical range for every calendar month.'],
  ['GET /api/place', 'lat, lon, radius_km (5–100)', 'Fire profile around a coordinate: province, typical season, peak month, highest year, trend, recent activity.'],
  ['POST /api/ask', '{question, history, view}', '"Ask anything" assistant (Google Gemini). It answers by calling the endpoints above; streams NDJSON events.'],
  ['GET /api/regions.geojson', '—', 'Pakistan and province outlines used for presets.'],
]

export default function DataPage() {
  return (
    <>
      <PageHeader kicker="Data" title="Where every *number* comes from.">
        <p>
          All detections are from NASA FIRMS, the data source listed for this challenge. {fmt(calibration.rows_total)} rows for Pakistan, of which {fmt(calibration.series_rows)} make up the harmonized series after confidence filtering and era selection. Data to {fmtDate(pakistan.data_extent.to)}.
        </p>
      </PageHeader>

      <section className="section pt-0" aria-labelledby="streams">
        <div className="container-page">
          <h2 id="streams" className="sr-only">Input streams</h2>
          <div className="overflow-x-auto rounded-frame border border-line">
            <table className="w-full min-w-[44rem] text-left tabular-nums">
              <caption className="sr-only">Input streams for Pakistan</caption>
              <thead className="label bg-raised text-mute">
                <tr>
                  {['Stream', 'Product', 'Rows', 'Coverage', 'Notes'].map((h) => (
                    <th key={h} scope="col" className="p-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {streams.map((r) => (
                  <tr key={r[0]} className="border-t border-line">
                    <th scope="row" className="p-4 font-semibold">{r[0]}</th>
                    <td className="p-4 text-ink-2">{r[1]}</td>
                    <td className="p-4">{r[2]}</td>
                    <td className="p-4 text-ink-2">{r[3]}</td>
                    <td className="p-4 text-ink-2">{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            <div>
              <Kicker>Standard vs NRT</Kicker>
              <p className="mt-4 text-ink-2">Standard-processing (SP) files are the final archive. Near-real-time (NRT) files cover the last weeks to months, will be replaced later, and have no type field. The app marks NRT months as provisional.</p>
            </div>
            <div>
              <Kicker>Outages are not zeros</Kicker>
              <p className="mt-4 text-ink-2">
                Satellite outages (S-NPP 27 Jul–10 Aug 2022, Aqua 16 Aug–2 Sep 2020, the Terra gap of June–July 2001, and single-satellite zero days) are listed as no-data. They are never counted as &ldquo;no fires&rdquo; and are left out of calibration and anomaly baselines.
              </p>
            </div>
            <div>
              <Kicker>Boundaries</Kicker>
              <p className="mt-4 text-ink-2">
                Country and province outlines from geoBoundaries (gbOpen PAK ADM0 and simplified ADM1). Detections are clipped to the Pakistan ADM0 polygon.{' '}
                <TextLink href="https://www.geoboundaries.org/">geoboundaries.org</TextLink>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="api" className="section surface-raised scroll-mt-20" aria-labelledby="api-title">
        <div className="container-page">
          <SectionHead
            id="api-title"
            index="API"
            kicker="HTTP API"
            title="Use it from your own *code*."
            aside={
              <p>
                FastAPI + DuckDB over the harmonized Parquet. Responses are JSON or CSV. Interactive docs live at <code className="text-ink">/docs</code> on the API host.
              </p>
            }
          />
          <div className="mt-10 rounded-frame border border-line bg-bg p-5 font-mono text-sm">
            <p className="label text-mute">aoi accepts</p>
            <ul className="mt-3 space-y-1.5 text-ink">
              <li>pakistan</li>
              <li>region:PK-PB · region:PK-SD · region:PK-KP · region:PK-BA · region:PK-GB · region:PK-JK · region:PK-IS</li>
              <li>bbox:west,south,east,north</li>
              <li>circle:lon,lat,radius_km</li>
              <li>poly:lon,lat;lon,lat;lon,lat;…</li>
            </ul>
            <p className="label mt-6 text-mute">example</p>
            <p className="mt-3 break-all text-accent">{API_URL}/api/calendar?aoi=region:PK-PB&amp;from=2015-01-01&amp;to=2026-11-13&amp;unit=modis</p>
          </div>
          <div className="mt-8 overflow-x-auto rounded-frame border border-line">
            <table className="w-full min-w-[44rem] text-left">
              <caption className="sr-only">API endpoints</caption>
              <thead className="label bg-bg text-mute">
                <tr>
                  {['Endpoint', 'Parameters', 'Returns'].map((h) => (
                    <th key={h} scope="col" className="p-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e[0]} className="border-t border-line align-top">
                    <th scope="row" className="whitespace-nowrap p-4 font-mono text-sm font-medium text-ink">{e[0]}</th>
                    <td className="p-4 font-mono text-sm text-ink-2">{e[1]}</td>
                    <td className="p-4 text-ink-2">{e[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="cite">
        <div className="container-page grid gap-10 md:grid-cols-12">
          <div className="md:col-span-4">
            <Kicker>Credit</Kicker>
            <h2 id="cite" className="mt-6 text-d3 font-bold">Acknowledge the data</h2>
          </div>
          <div className="space-y-4 text-ink-2 md:col-span-8">
            <p>
              Input data: NASA Fire Information for Resource Management System (FIRMS), MODIS Collection 6.1 and VIIRS 375 m active fire products. Follow FIRMS&apos; own citation guidance when you reuse them:{' '}
              <TextLink href="https://www.earthdata.nasa.gov/data/tools/firms">earthdata.nasa.gov/data/tools/firms</TextLink>
            </p>
            <p>
              Harmonized series: Aatish, team Aero Snipers, NASA Space Apps Challenge 2026. Unit: {calibration.unit}.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
