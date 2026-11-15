import { CountUp } from '@/components/motion/CountUp'
import { Marquee } from '@/components/motion/Marquee'
import { Button, Kicker, Rich, SectionHead, TextLink, pad } from '@/components/primitives'
import { site } from '@/lib/content'
import { MONTHS, MONTHS_LONG, calibration, fmt, pakistan, regionSummary } from '@/lib/data'
import { RAMPS, rampGradient } from '@/lib/ramps'

import { CalendarPoster } from './CalendarPoster'

const v = calibration.validation

export function ProofNumbers() {
  const metrics = [
    { value: fmt(calibration.rows_total), label: 'Detections processed', detail: 'Every MODIS and VIIRS hotspot FIRMS recorded over Pakistan, Nov 2000 to Nov 2026.' },
    { value: '5', label: 'Satellites, one scale', detail: 'Terra, Aqua, Suomi NPP, NOAA-20 and NOAA-21, all in MODIS-equivalent units.' },
    { value: `${v.loyo_merged.country_month.MdAPE}%`, label: 'Median monthly error', detail: 'Country-month, on held-out years: each year in turn is left out of the fit and predicted.' },
    { value: `${Math.round(v.loyo_merged.anomaly_skill_country_month.above_below_median_agreement_pct)}%`, label: 'Anomaly sign agreement', detail: 'How often the harmonized series agrees with MODIS on whether a month was above or below normal.' },
  ]
  return (
    <section aria-label="Aatish in numbers" className="border-y border-line">
      <dl className="container-page grid sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m, i) => (
          <div
            key={m.label}
            data-spotlight
            className="flex min-w-0 flex-col border-line py-10 [container-type:inline-size] sm:px-6 sm:[&:nth-child(even)]:border-l lg:border-l lg:px-8 lg:first:border-l-0 lg:first:pl-0 [&:not(:first-child)]:border-t sm:[&:nth-child(2)]:border-t-0 lg:[&:not(:first-child)]:border-t-0"
            data-reveal suppressHydrationWarning
            style={{ '--delay': `${i * 90}ms` } as React.CSSProperties}
          >
            <dt className="order-2 mt-4 font-display text-xl font-bold tracking-tight">{m.label}</dt>
            <dd className="order-1 whitespace-nowrap font-display text-[clamp(2.25rem,17cqi,5.25rem)] font-bold leading-[0.85] tabular-nums tracking-[-0.045em] text-ink">
              <CountUp value={m.value} />
            </dd>
            <dd className="order-3 mt-3 text-[0.95rem] leading-relaxed text-mute">{m.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function MarqueeBand() {
  return (
    <div className="border-b border-line py-6" aria-hidden="true">
      <Marquee duration={55}>
        {site.marquee.map((t) => (
          <span key={t} className="flex items-center gap-8 pr-8 font-display text-d4 font-bold text-ink-2">
            {t}
            <span className="h-2 w-2 rounded-full bg-accent" />
          </span>
        ))}
      </Marquee>
    </div>
  )
}

export function Problem() {
  const p = site.problem
  return (
    <section className="section" aria-labelledby="problem-title">
      <div className="container-page">
        <SectionHead id="problem-title" index="01" kicker={p.kicker} title={p.title} aside={<p>{p.aside}</p>} />
        <ol className="mt-16 grid gap-px overflow-hidden rounded-frame border border-line bg-line md:grid-cols-3" data-reveal="stagger" suppressHydrationWarning>
          {p.points.map((pt, i) => (
            <li key={pt.title} data-spotlight className="bg-bg p-7 md:p-9">
              <p className="label text-accent">{pad(i + 1)}</p>
              <h3 className="mt-6 text-d4 font-bold">{pt.title}</h3>
              <p className="mt-4 text-ink-2">{pt.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function Method() {
  const m = site.method
  return (
    <section className="section surface-raised" aria-labelledby="method-title">
      <div className="container-page">
        <SectionHead
          id="method-title"
          index="02"
          kicker={m.kicker}
          title={m.title}
          aside={
            <>
              <p>{m.aside}</p>
              <p className="mt-4">
                <TextLink href="/method">Read the full method</TextLink>
              </p>
            </>
          }
        />
        <ol className="mt-16 divide-y divide-line border-y border-line">
          {m.steps.map((s, i) => (
            <li key={s.title} className="grid gap-4 py-8 md:grid-cols-12 md:gap-10 md:py-10" data-reveal suppressHydrationWarning>
              <p className="font-display text-d3 font-bold text-accent md:col-span-2">{pad(i + 1)}</p>
              <h3 className="text-d4 font-bold md:col-span-4">{s.title}</h3>
              <p className="text-ink-2 md:col-span-6">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function CalendarFigure() {
  const s = pakistan.stats
  const order = ['region:PK-PB', 'region:PK-SD', 'region:PK-KP', 'region:PK-BA']
  return (
    <section className="section" aria-labelledby="calendar-title">
      <div className="container-page">
        <SectionHead
          id="calendar-title"
          index="03"
          kicker="The calendar"
          title="Every month since 2000, *on one page*."
          aside={
            <p>
              Rows are years and columns are months. Dashed outlines mark provisional near-real-time months. Hover a cell for the number and its 80% band.
            </p>
          }
        />
        <div className="mt-16 grid gap-12 lg:grid-cols-12">
          <figure className="lg:col-span-7" data-reveal suppressHydrationWarning>
            <div className="rounded-frame border border-line bg-raised/40 p-5 md:p-8">
              <CalendarPoster months={pakistan.months} className="mx-auto w-full max-w-[38rem]" />
            </div>
            <figcaption className="mt-4 flex flex-wrap items-center gap-4 text-sm text-mute">
              <span className="label">Fewer</span>
              <span aria-hidden="true" className="h-2 w-40 rounded-full" style={{ background: rampGradient(RAMPS.cividis) }} />
              <span className="label">More (log scale)</span>
              <span>Colour scale: cividis, readable with common colour-vision deficiencies.</span>
            </figcaption>
          </figure>
          <div className="lg:col-span-5">
            <Kicker>What the series says, Pakistan</Kicker>
            <dl className="mt-6 divide-y divide-line border-y border-line">
              {s.peak_month && (
                <div className="py-5" data-reveal suppressHydrationWarning>
                  <dt className="label text-mute">Peak calendar month</dt>
                  <dd className="mt-2 text-ink-2">
                    <span className="font-display text-d4 font-bold text-ink">{MONTHS_LONG[s.peak_month.month - 1]}</span>, median {fmt(s.peak_month.median)} detections, about{' '}
                    {s.peak_month.share_pct}% of a typical year.
                  </dd>
                </div>
              )}
              {s.worst_year && (
                <div className="py-5" data-reveal suppressHydrationWarning>
                  <dt className="label text-mute">Highest complete year</dt>
                  <dd className="mt-2 text-ink-2">
                    <span className="font-display text-d4 font-bold text-ink">{s.worst_year.year}</span> is {s.worst_year.wording}
                    {s.worst_year.runner_up && !s.worst_year.clear ? `, alongside ${s.worst_year.runner_up}` : ''}.
                  </dd>
                </div>
              )}
              {s.trend && (
                <div className="py-5" data-reveal suppressHydrationWarning>
                  <dt className="label text-mute">
                    Trend {s.trend.years[0]}–{s.trend.years[1]}
                  </dt>
                  <dd className="mt-2 text-ink-2">
                    <span className="font-display text-d4 font-bold text-ink">
                      {s.trend.pct_per_year > 0 ? '+' : ''}
                      {s.trend.pct_per_year}% a year
                    </span>{' '}
                    {s.trend.claim
                      ? `(Theil–Sen; Mann–Kendall p < 0.05, and the ${s.trend.total_change_pct}% change exceeds the ±${s.trend.band_halfwidth_pct}% band).`
                      : '(not significant against the uncertainty band, so we do not call it a trend).'}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-reveal="stagger" suppressHydrationWarning aria-label="Provinces">
          {order.map((k) => {
            const r = regionSummary[k]
            if (!r) return null
            const a = r.anomaly
            return (
              <li key={k} data-spotlight className="flex flex-col rounded-frame border border-line p-6">
                <p className="label text-mute">Province</p>
                <h3 className="mt-3 text-d4 font-bold">{r.label}</h3>
                <dl className="mt-5 space-y-2 text-sm text-ink-2">
                  {r.peak_month && (
                    <div className="flex justify-between gap-3">
                      <dt>Peak month</dt>
                      <dd className="text-ink">{MONTHS[r.peak_month.month - 1]}</dd>
                    </div>
                  )}
                  {r.worst_year && (
                    <div className="flex justify-between gap-3">
                      <dt>Highest year</dt>
                      <dd className="text-ink">
                        {r.worst_year.year}
                        {!r.worst_year.clear && <span className="text-mute"> (close call)</span>}
                      </dd>
                    </div>
                  )}
                  {a?.pct !== undefined && (
                    <div className="flex justify-between gap-3">
                      <dt>
                        {a.month ? MONTHS[a.month - 1] : ''} 1–{a.window?.split('-').pop()} 2026
                      </dt>
                      <dd className="text-ink">{a.ratio ? `${a.ratio.toFixed(1)}× median` : `${Math.round(a.pct ?? 0)}th pct`}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-auto pt-6">
                  <TextLink href={`/explore?aoi=${encodeURIComponent(k)}`}>Open {r.label}</TextLink>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

export function Impact() {
  const im = site.impact
  return (
    <section className="section surface-paper" aria-labelledby="impact-title">
      <div className="container-page grid gap-12 md:grid-cols-12">
        <div className="md:col-span-6">
          <Kicker index="04">{im.kicker}</Kicker>
          <h2 id="impact-title" className="mt-6 text-d2 font-bold" data-reveal suppressHydrationWarning>
            <Rich text={im.title} />
          </h2>
        </div>
        <div className="space-y-6 text-lede md:col-span-6 md:pt-14">
          {im.body.map((p) => (
            <p key={p} className="text-ink-2" data-reveal suppressHydrationWarning>
              {p}
            </p>
          ))}
          <ul className="grid gap-px overflow-hidden rounded-frame border border-[rgb(var(--ink)/0.14)] bg-[rgb(var(--ink)/0.14)] text-base" data-reveal="stagger" suppressHydrationWarning>
            {site.audience.map((a) => (
              <li key={a.who} className="bg-paper p-5">
                <p className="font-display text-xl font-bold">{a.who}</p>
                <p className="mt-1 text-ink-2">{a.what}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export function FinalCta() {
  const c = site.cta
  return (
    <section className="surface-accent" aria-labelledby="cta-title">
      <div className="container-page grid gap-10 py-20 md:grid-cols-12 md:items-end md:py-28">
        <div className="md:col-span-8">
          <Kicker index="05">Explore</Kicker>
          <h2 id="cta-title" className="mt-6 text-d1 font-bold" data-reveal suppressHydrationWarning>
            <Rich text={c.title} emClassName="text-on-accent" />
          </h2>
        </div>
        <div className="md:col-span-4" data-reveal suppressHydrationWarning>
          <p className="text-lede text-ink-2">{c.body}</p>
          <div className="mt-8">
            <Button href={c.href} variant="ink">
              {c.label}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
