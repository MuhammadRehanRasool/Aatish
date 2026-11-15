import type { Metadata } from 'next'

import { GroupedBars, Legend, LineChart } from '@/components/charts/Svg'
import { Kicker, SectionHead, TextLink } from '@/components/primitives'
import { PageHeader } from '@/components/site/PageHeader'
import { MONTHS, calibration as c, overlapPk } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Method: how MODIS and VIIRS are harmonized',
  description:
    'Each VIIRS detection is weighted by the measured probability that Aqua MODIS saw the same fire (by fire radiative power and day/night), times a month factor and a local correction, fitted on 2012–2022 and validated by leave-one-year-out cross-validation.',
  alternates: { canonical: '/method' },
}

const v = c.validation
const ACC = '#FF6A2B'
const SIG = '#8FB4FF'

const refs = [
  { cite: 'Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. (2014). The New VIIRS 375 m active fire detection data product. Remote Sensing of Environment 143, 85–96.', doi: '10.1016/j.rse.2013.12.008' },
  { cite: 'Giglio, L., Schroeder, W., Justice, C. O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. Remote Sensing of Environment 178, 31–41.', doi: '10.1016/j.rse.2016.02.054' },
  { cite: 'Vadrevu, K., Lasko, K. (2018). Intercomparison of MODIS AQUA and VIIRS I-Band Fires and Emissions in an Agricultural Landscape. Remote Sensing 10(7), 978.', doi: '10.3390/rs10070978' },
  { cite: 'Chen, Y. et al. (2026). GFED5NRT. Earth System Science Data 18, 7535–7555.', doi: '10.5194/essd-18-7535-2026' },
  { cite: 'Giglio, L. et al. (2025). Remote Sensing of Environment 331, 115006 (cited via GFED5NRT; not read in full by us).', doi: '10.1016/j.rse.2025.115006' },
]

export default function MethodPage() {
  const ov = overlapPk.months
  const driftIdx = ov.findIndex((m) => !m.fit_window)
  const bins = ['<1', '1-2', '2-4', '4-8', '8-16', '16-32', '>=32']
  const pa = (dn: 'D' | 'N') => bins.map((b) => c.P_aqua.find((p) => p.frp_bin === b && p.daynight === dn)?.value ?? 0)
  const f = (dn: 'D' | 'N') => MONTHS.map((_, i) => c.f.find((x) => x.daynight === dn && x.moy === i + 1)?.value ?? null)
  const lm = v.loyo_merged
  const sk = lm.anomaly_skill_country_month
  const bandRows = Object.entries(v.band_by_count)

  return (
    <>
      <PageHeader kicker="Method" title="Make VIIRS speak *MODIS*.">
        <p>
          The series is in MODIS-equivalent detections (Terra + Aqua, as in FIRMS MODIS C6.1). Converting VIIRS down to MODIS is well posed: we ask how many of the fires VIIRS saw MODIS would also have seen. A VIIRS-equivalent view is the exact inverse and is available in the app.
        </p>
      </PageHeader>

      <section className="section pt-0" aria-labelledby="steps">
        <div className="container-page grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Kicker index="01">The model</Kicker>
            <h2 id="steps" className="mt-6 text-d3 font-bold">
              One weight per detection
            </h2>
          </div>
          <div className="space-y-6 text-ink-2 lg:col-span-8">
            <pre className="overflow-x-auto rounded-frame border border-line bg-raised p-5 font-mono text-sm text-ink">
              {`w = P_aqua[FRP bin, day/night] × f[day/night, month] × L[1° cell, day/night, season]
    × f_sat / n_active_VIIRS_satellites

AOI-month total = Σ w      (additive, so any drawn area is consistent)`}
            </pre>
            <ul className="space-y-4">
              <li>
                <strong className="text-ink">P_aqua</strong> is the measured probability that Aqua MODIS detected a fire within {c.match_radius_km} km on the same day as a Suomi NPP detection, by fire radiative power (FRP) bin and day/night. Small fires are where the instruments differ most (Giglio et al. 2016).
              </li>
              <li>
                <strong className="text-ink">f</strong> is a ratio of totals per day/night and calendar month on top of P_aqua. It absorbs Terra and unmatched pixels. By day it ranges from {Math.min(...(f('D').filter(Boolean) as number[])).toFixed(1)} to {Math.max(...(f('D').filter(Boolean) as number[])).toFixed(1)}.
              </li>
              <li>
                <strong className="text-ink">L</strong> is a local adjustment per 1° cell, day/night and season, shrunk toward 1 (k = {c.shrinkage_k}) so thin cells stay close to the national model.
              </li>
              <li>
                <strong className="text-ink">Satellites:</strong> the input is the mean of the VIIRS satellites active that day and overpass. Factors relative to Suomi NPP: NOAA-20 {c.f_sat.N20?.toFixed(3)}, NOAA-21 {c.f_sat.N21?.toFixed(3)} (NOAA-21 FRP divided by {(c.frp_scale?.N21 ?? 1).toFixed(2)} before binning, from the NOAA-21/NOAA-20 FRP quantile ratio; NOAA documents up to ~10%, so the cause of the rest is not verified). If one satellite is out, the others carry the series, as in GFED5NRT.
              </li>
              <li>
                <strong className="text-ink">Fit window:</strong> {c.fit_window[0]} to {c.fit_window[1]}. Our own data shows MODIS orbital drift from late 2022 (Terra&apos;s morning overpass misses afternoon rice burning; Aqua&apos;s later one catches more), so MODIS after September 2022 is a drift check, not truth.
              </li>
              <li>
                <strong className="text-ink">Cleaning:</strong> MODIS confidence ≥ {c.filters.modis_conf_min}; VIIRS {c.filters.viirs_conf.join('/')}. One static-source mask of {c.filters.static_info.union_cells.toLocaleString()} cells at 0.01° ({c.filters.static_info.viirs_cells} from VIIRS typing, {c.filters.static_info.modis_cells.toLocaleString()} from MODIS 2018+ typing) applies to every sensor and year, including NRT, which has no type field. No grid snapping: we tested 1 km cells and they were never better.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section surface-raised" aria-labelledby="fig-p">
        <div className="container-page">
          <SectionHead id="fig-p" index="02" kicker="Detection probability" title="Bigger fires, *better odds*." aside={<p>Share of S-NPP detections that Aqua also saw, by FRP bin (MW). Night fires are detected more consistently by both.</p>} />
          <div className="mt-10 rounded-frame border border-line bg-bg p-4 md:p-6" data-reveal suppressHydrationWarning>
            <GroupedBars
              groups={bins.map((b) => `${b} MW`)}
              series={[
                { name: 'Day', color: ACC, values: pa('D') },
                { name: 'Night', color: SIG, values: pa('N') },
              ]}
              title="P_aqua by FRP bin, day and night"
              desc={`Probability that Aqua detected the same fire as S-NPP. Day rises from ${pa('D')[0]!.toFixed(3)} below 1 MW to ${pa('D')[6]!.toFixed(3)} above 32 MW; night from ${pa('N')[0]!.toFixed(3)} to ${pa('N')[6]!.toFixed(3)}.`}
            />
            <div className="mt-3">
              <Legend items={[{ name: 'Day', color: ACC }, { name: 'Night', color: SIG }]} />
            </div>
          </div>
          <div className="mt-8 rounded-frame border border-line bg-bg p-4 md:p-6" data-reveal suppressHydrationWarning>
            <LineChart
              labels={MONTHS}
              tickEvery={1}
              tickFormat={(l) => l}
              series={[
                { name: 'Day', color: ACC, values: f('D') },
                { name: 'Night', color: SIG, values: f('N') },
              ]}
              height={220}
              title="Month factor f by calendar month"
              desc="Ratio-of-totals factor applied on top of P_aqua, by calendar month, for day and night detections."
            />
            <div className="mt-3">
              <Legend items={[{ name: 'f, day', color: ACC }, { name: 'f, night', color: SIG }]} />
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="fig-o">
        <div className="container-page">
          <SectionHead
            id="fig-o"
            index="03"
            kicker="Overlap and drift"
            title="Where both instruments *agree*."
            aside={<p>Pakistan, monthly. Left of the shaded area: the 2012–2022 overlap used for fitting. Shaded: after September 2022, where MODIS drifts and the series switches to VIIRS.</p>}
          />
          <div className="mt-10 rounded-frame border border-line bg-raised/40 p-4 md:p-6" data-reveal suppressHydrationWarning>
            <LineChart
              labels={ov.map((m) => m.ym)}
              series={[
                { name: 'MODIS observed', color: '#f3eee6', values: ov.map((m) => m.modis_observed) },
                { name: 'VIIRS-derived MODIS-equivalent', color: ACC, values: ov.map((m) => m.viirs_derived), dash: '0' },
              ]}
              shade={driftIdx > 0 ? [{ from: driftIdx, to: ov.length - 1, label: 'MODIS drift period' }] : []}
              title="MODIS observed versus VIIRS-derived MODIS-equivalent, Pakistan, monthly since 2012"
              desc="The two lines track each other through 2012–2022 (in-sample). After 2022-09 the series uses the VIIRS-derived line."
              yLabel="detections / month"
            />
            <div className="mt-3">
              <Legend items={[{ name: 'MODIS observed (Terra + Aqua)', color: '#f3eee6' }, { name: 'VIIRS-derived, MODIS-equivalent', color: ACC }]} />
            </div>
          </div>
        </div>
      </section>

      <section className="section surface-paper" aria-labelledby="val">
        <div className="container-page">
          <Kicker index="04">Validation</Kicker>
          <h2 id="val" className="mt-6 text-d2 font-bold" data-reveal suppressHydrationWarning>
            Tested on years it never saw.
          </h2>
          <p className="mt-6 max-w-3xl text-lede text-ink-2">
            Leave-one-year-out: each year 2012–2022 is removed, the model is refitted without it, and the removed year is predicted from VIIRS and compared with MODIS.
          </p>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left tabular-nums">
              <caption className="sr-only">Validation metrics</caption>
              <thead className="label text-mute">
                <tr className="border-b border-[rgb(var(--ink)/0.2)]">
                  <th scope="col" className="py-3 pr-4">Test</th>
                  <th scope="col" className="py-3 pr-4">Scale</th>
                  <th scope="col" className="py-3 pr-4">Median abs. error</th>
                  <th scope="col" className="py-3 pr-4">R²</th>
                  <th scope="col" className="py-3">Bias</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Leave-one-year-out', 'Pakistan, monthly', lm.country_month],
                  ['Leave-one-year-out', '1° cell, monthly', lm.cell1_month],
                  ['Forward (fit 2012–17, test 2018–22)', 'Pakistan, monthly', v.forward.country_month],
                  ['Forward (fit 2012–17, test 2018–22)', '1° cell, monthly', v.forward.cell1_month],
                  ['NOAA-20 transfer, with satellite factor', 'Pakistan, monthly', v.n20_transfer_with_f_sat.country_month],
                ].map(([t, sc, m]) => {
                  const mm = m as { MdAPE: number; R2: number; bias_pct: number }
                  return (
                    <tr key={`${t}${sc}`} className="border-b border-[rgb(var(--ink)/0.12)]">
                      <td className="py-3 pr-4">{t as string}</td>
                      <td className="py-3 pr-4 text-ink-2">{sc as string}</td>
                      <td className="py-3 pr-4 font-semibold">{mm.MdAPE}%</td>
                      <td className="py-3 pr-4">{mm.R2.toFixed(3)}</td>
                      <td className="py-3">{mm.bias_pct > 0 ? '+' : ''}{mm.bias_pct}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-12 grid gap-10 md:grid-cols-2">
            <div>
              <h3 className="text-d4 font-bold">Anomaly skill, stated plainly</h3>
              <p className="mt-4 text-ink-2">
                A high R² on raw counts mostly reflects the seasonal cycle. On anomalies (each month against its own climatology) the harmonized series has R² {sk.anomaly_R2.toFixed(2)} and correlation {sk.anomaly_corr.toFixed(3)}. For reference, Terra and Aqua, two copies of the same instrument, agree at {v.noise_floor.toFixed(3)}. The series and MODIS agree on above or below median {sk.above_below_median_agreement_pct}% of the time; the mean percentile error is {sk.pctl_err_mean_pp} points; the same worst year is picked in {sk.same_worst_year_months} calendar months.
              </p>
              <p className="mt-4 text-ink-2">That is why the app says &ldquo;among the highest&rdquo; unless a year clears the band of the next one.</p>
            </div>
            <div>
              <h3 className="text-d4 font-bold">Uncertainty band by size</h3>
              <p className="mt-4 text-ink-2">80% band on log(1 + count), from held-out residuals pooled over country, 1°, 0.5° and 0.25° cells, chosen by the predicted monthly count.</p>
              <table className="mt-4 w-full text-left text-sm tabular-nums">
                <thead className="label text-mute">
                  <tr className="border-b border-[rgb(var(--ink)/0.2)]">
                    <th scope="col" className="py-2">Predicted count</th>
                    <th scope="col" className="py-2">Low</th>
                    <th scope="col" className="py-2">High</th>
                    <th scope="col" className="py-2">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {bandRows.map(([k, b]) => (
                    <tr key={k} className="border-b border-[rgb(var(--ink)/0.12)]">
                      <td className="py-2">{k}</td>
                      <td className="py-2">{b.q10.toFixed(2)}</td>
                      <td className="py-2">+{b.q90.toFixed(2)}</td>
                      <td className="py-2">{Math.round(b.nested_80pct_coverage * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="eras">
        <div className="container-page grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Kicker index="05">The series</Kicker>
            <h2 id="eras" className="mt-6 text-d3 font-bold">
              Three eras, one unit
            </h2>
          </div>
          <ol className="divide-y divide-line border-y border-line lg:col-span-8">
            {[
              ['Nov 2000 – 5 Jul 2002', 'Terra only, scaled', `Terra × (Terra + Aqua)/Terra by calendar month, fitted ${c.terra_scaling.fit_years[0]}–${c.terra_scaling.fit_years[1]}. The factor ranges from ${Math.min(...Object.values(c.terra_scaling.factor_by_moy)).toFixed(1)} to ${Math.max(...Object.values(c.terra_scaling.factor_by_moy)).toFixed(1)} (November), so these months carry a wider band.`],
              ['6 Jul 2002 – Sep 2022', 'MODIS observed', 'Terra + Aqua as published by FIRMS (Collection 6.1). No model band.'],
              ['Oct 2022 – today', 'VIIRS-derived', 'Mean of the active VIIRS satellites, weighted to MODIS-equivalent. The latest months come from near-real-time files and are marked provisional.'],
            ].map(([when, what, body]) => (
              <li key={when} className="grid gap-2 py-6 md:grid-cols-12 md:gap-6">
                <p className="label text-accent md:col-span-3">{when}</p>
                <h3 className="text-xl font-bold md:col-span-3">{what}</h3>
                <p className="text-ink-2 md:col-span-6">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section surface-raised" aria-labelledby="limits">
        <div className="container-page grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Kicker index="06">Limits</Kicker>
            <h2 id="limits" className="mt-6 text-d3 font-bold">
              What this cannot tell you
            </h2>
          </div>
          <ul className="space-y-5 text-ink-2 lg:col-span-8">
            <li>Detections are not fires, and fires are not burned area. A cloudy day hides fires from every sensor.</li>
            <li>Polar orbiters see each place a few times a day. Reports from Indian Punjab suggest burning has shifted later in the afternoon, away from overpass times; this is not verified for Pakistan, and it would affect MODIS and VIIRS alike.</li>
            <li>Calibration is fitted for Pakistan. Outside Pakistan the app only shows raw NRT counts from FIRMS.</li>
            <li>2012 has a −13% bias in held-out tests, consistent with the early VIIRS calibration period noted in the VIIRS user guide.</li>
            <li>Months with missing satellite days (for example the Terra gap in June–July 2001) are flagged in the calendar and left out of anomaly baselines.</li>
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="refs">
        <div className="container-page grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Kicker index="07">References</Kicker>
            <h2 id="refs" className="mt-6 text-d3 font-bold">
              Sources
            </h2>
          </div>
          <div className="lg:col-span-8">
            <ol className="space-y-4 text-ink-2">
              {refs.map((r) => (
                <li key={r.doi}>
                  {r.cite}{' '}
                  <TextLink href={`https://doi.org/${r.doi}`}>doi:{r.doi}</TextLink>
                </li>
              ))}
              <li>
                NASA FIRMS active fire data (MODIS C6.1, VIIRS 375 m).{' '}
                <TextLink href="https://firms.modaps.eosdis.nasa.gov/">firms.modaps.eosdis.nasa.gov</TextLink>
              </li>
              <li>MODIS C6/C6.1 Active Fire User&apos;s Guide v1.0; VIIRS VNP14 User Guide v1; VIIRS Collection 2 Burned Area User Guide v1.1 (outage dates).</li>
            </ol>
          </div>
        </div>
      </section>
    </>
  )
}
