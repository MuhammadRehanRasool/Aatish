import { Button, LiveDot, Rich } from '@/components/primitives'
import { site } from '@/lib/content'
import { MONTHS, fmt, fmtDate, pakistan } from '@/lib/data'
import { RAMPS, rampGradient } from '@/lib/ramps'

import { CalendarPoster } from './CalendarPoster'
import { HeroStage } from './HeroStage'

export function Hero() {
  const a = pakistan.anomaly
  const s = pakistan.stats
  const chips = [
    `${fmt(pakistan.months.length)} months on one scale`,
    s.peak_month ? `Peak month: ${MONTHS[s.peak_month.month - 1]}` : null,
    a && a.ratio ? `${MONTHS[a.month - 1]} 2026: ${a.ratio.toFixed(1)}× median` : null,
  ].filter(Boolean) as string[]

  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden pt-24 md:pt-28">
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 top-10 h-[38rem] w-[38rem] rounded-full bg-accent/10 blur-[120px]" />
      <div className="container-page relative">
        <div className="label flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line pb-4 text-mute">
          <span>{site.hero.kicker}</span>
          <span className="hidden md:inline">Pakistan · Nov 2000 → {fmtDate(pakistan.data_extent.to)}</span>
          <span className="inline-flex items-center gap-2 text-ink">
            <LiveDot />
            Data to {fmtDate(pakistan.data_extent.to)}
          </span>
        </div>

        <div className="grid gap-12 pb-16 pt-10 md:pt-14 lg:grid-cols-12 lg:gap-10 lg:pb-24">
          <div className="flex flex-col lg:col-span-7">
            <h1
              id="hero-title"
              className="font-display text-[13.5vw] font-bold leading-[0.88] tracking-[-0.042em] sm:text-[clamp(3.2rem,8.4vw,8.5rem)]"
              style={{ fontStretch: '92%' }}
            >
              <span className="sr-only">{site.name}: </span>
              {site.hero.lines.map((line, i) => (
                <span key={i} className="rise">
                  <span style={{ '--delay': `${80 + i * 100}ms` } as React.CSSProperties}>
                    <Rich text={line} />
                  </span>
                </span>
              ))}
            </h1>
            <p className="mt-10 max-w-[36rem] text-lede text-ink-2 md:mt-12" data-reveal suppressHydrationWarning style={{ '--delay': '420ms' } as React.CSSProperties}>
              {site.hero.lede}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3" data-reveal suppressHydrationWarning style={{ '--delay': '520ms' } as React.CSSProperties}>
              <Button href={site.hero.primary.href}>{site.hero.primary.label}</Button>
              <Button href={site.hero.secondary.href} variant="ghost">
                {site.hero.secondary.label}
              </Button>
            </div>

            {a && (
              <aside
                aria-label="This month so far"
                data-spotlight
                className="mt-12 max-w-xl rounded-frame border border-line p-5 md:p-6"
                data-reveal suppressHydrationWarning
                style={{ '--delay': '640ms' } as React.CSSProperties}
              >
                <p className="label flex items-center gap-2 text-accent">
                  <LiveDot />
                  {MONTHS[a.month - 1]} 1–{a.window.split('-').pop()}, {a.year} · Pakistan · provisional
                </p>
                {a.ratio && (
                  <p className="mt-3 font-display text-d3 font-bold leading-none">
                    {a.ratio.toFixed(2)}× <span className="em font-normal text-accent">usual</span>
                  </p>
                )}
                <p className="mt-3 text-[1.05rem] leading-relaxed text-ink-2">
                  <span className="font-display text-d4 font-bold text-ink">{fmt(a.value)}</span> MODIS-equivalent detections. That is{' '}
                  {a.ratio ? <strong className="text-ink">{a.ratio.toFixed(1)}× the median</strong> : 'compared with the median'} of the same days in{' '}
                  {a.baseline_years[0]}–{a.baseline_years[1]}, and ranks {a.rank} of {a.of} years. 80% band {fmt(a.lo)}–{fmt(a.hi)}.
                </p>
              </aside>
            )}
          </div>

          <div className="relative lg:col-span-5">
            <div className="relative mx-auto w-full max-w-[34rem] rounded-frame border border-line bg-raised/40">
              <HeroStage months={pakistan.months} poster={<CalendarPoster months={pakistan.months} titles={false} className="h-full w-auto max-w-full" />} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[0.6875rem] text-mute">
              <span className="label">Pakistan · every month since Nov 2000</span>
              <span className="inline-flex items-center gap-2" aria-label="Colour and height show the monthly count on a log scale, low to high">
                <span className="label">Fewer</span>
                <span className="h-1.5 w-20 rounded-full" style={{ background: rampGradient(RAMPS.cividis) }} aria-hidden="true" />
                <span className="label">More</span>
                <span className="label">(log)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-accent" aria-hidden="true" />
                <span className="label">Latest month</span>
              </span>
            </div>
            <ul className="mt-3 flex flex-wrap justify-center gap-2" aria-label="Key facts">
              {chips.map((chip) => (
                <li key={chip} className="label rounded-full border border-line-strong bg-bg/85 px-3 py-1.5 text-[0.6875rem] text-ink">
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" aria-hidden="true" />
                  {chip}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-center">
              <a href="#illusion" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0E1116]/80 px-4 py-2 text-sm font-bold shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl hover:border-accent/60">
                <span className="rounded-full bg-signal/15 px-2 py-0.5 text-[0.68rem] text-signal">Raw counts</span>
                <span className="text-mute">vs</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[0.68rem] text-accent">Harmonized</span>
                <span className="text-ink-2">See the 2012 sensor illusion ↓</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
