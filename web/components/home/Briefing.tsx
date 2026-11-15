import { StatusPill } from '@/components/explore/ui'
import { MONTHS, MONTHS_LONG, fmt, fmtDate, pakistan, regionSummary } from '@/lib/data'

import { AskBar } from './AskBar'

/**
 * Pre-written briefing, rendered at build time from the bundled data (no API call, no AI tokens on page load).
 * Every number below is read from web/content/data/*.json.
 */
export function Briefing() {
  const s = pakistan.stats
  const a = pakistan.anomaly
  const pb = regionSummary['region:PK-PB']
  const pbA = pb?.anomaly
  const clim = s.climatology ?? []
  const ranked = [...clim].sort((x, y) => y.median - x.median)
  const second = ranked.find((c) => c.month !== s.peak_month?.month)
  const novIdx = ranked.findIndex((c) => c.month === 11)
  const fromYear = pakistan.data_extent.from.slice(0, 4)
  const toLabel = fmtDate(pakistan.data_extent.to)

  const items = [
    s.trend && {
      k: 'Long-term',
      v: `${s.trend.pct_per_year > 0 ? '+' : ''}${s.trend.pct_per_year}%/yr`,
      body: (
        <>
          Fire activity has risen about {s.trend.pct_per_year}% a year ({s.trend.years[0]}–{s.trend.years[1]}), {s.trend.total_change_pct > 0 ? '+' : ''}
          {Math.round(s.trend.total_change_pct)}% overall. {s.trend.claim ? 'That is bigger than our uncertainty band, so we call it a real trend.' : 'That is within our uncertainty band, so we do not claim a trend.'}
        </>
      ),
    },
    s.peak_month && {
      k: 'Two seasons',
      v: `${MONTHS[s.peak_month.month - 1]} peak`,
      body: (
        <>
          {MONTHS_LONG[s.peak_month.month - 1]} is the busiest month ({s.peak_month.share_pct}% of a typical year, usually ~{fmt(s.peak_month.median)} hotspots)
          {second ? `, then ${MONTHS_LONG[second.month - 1]} (~${fmt(second.median)})` : ''}
          {novIdx > 1 ? ` and ${MONTHS_LONG[10]} (~${fmt(clim.find((c) => c.month === 11)?.median ?? 0)})` : ''}. In Punjab the two peaks are{' '}
          {pb?.peak_month ? MONTHS_LONG[pb.peak_month.month - 1] : 'May'} and November, after the wheat and rice harvests.
        </>
      ),
    },
    a && {
      k: 'Right now',
      v: a.ratio ? `${a.ratio.toFixed(2)}× usual` : `${Math.round(a.pct)}th pct`,
      body: (
        <>
          {MONTHS_LONG[a.month - 1]} 1–{a.window.split('-').pop()}, {a.year}: {fmt(a.value)} hotspots vs a usual {fmt(a.median)} for the same days (rank {a.rank} of {a.of} years).
          {pbA?.value != null && pbA.median != null ? ` Punjab drives it: ${fmt(pbA.value)} vs a usual ${fmt(pbA.median)}.` : ''} Provisional (near-real-time data).
        </>
      ),
    },
    s.worst_year && {
      k: 'Record year',
      v: String(s.worst_year.year),
      body: (
        <>
          {s.worst_year.year} has the highest yearly total, {fmt(s.worst_year.value)} MODIS-equivalent hotspots{s.worst_year.clear ? ', clearly above any other year.' : `, though ${s.worst_year.runner_up} is within its uncertainty band, so we say "among the highest".`}
        </>
      ),
    },
  ].filter(Boolean) as { k: string; v: string; body: React.ReactNode }[]

  return (
    <section aria-labelledby="briefing-title" className="border-t border-line py-16 md:py-20">
      <div className="container-page">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[1.5rem] border border-white/10 bg-[#0E1116]/85 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:p-8" style={{ backgroundImage: 'radial-gradient(90% 120% at 0% 0%, rgba(255,106,43,0.12), transparent 55%)' }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-accent">Executive briefing · pre-computed from our data</p>
              <StatusPill span={`${fromYear}–${pakistan.data_extent.to.slice(0, 4)}`} />
            </div>
            <h2 id="briefing-title" className="mt-3 font-display text-d4 font-bold">
              Pakistan fire briefing <span className="em font-normal text-ink-2">(Nov {fromYear} – {toLabel})</span>
            </h2>
            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              {items.map((it) => (
                <div key={it.k} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <dt className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-mute">{it.k}</span>
                    <span className="font-display text-xl font-bold tabular-nums">{it.v}</span>
                  </dt>
                  <dd className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">{it.body}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[0.7rem] text-mute">
              Numbers: harmonized NASA FIRMS detections (MODIS-equivalent). Harvest timing is general background, not from our satellite data.
            </p>

            <div className="mt-8 border-t border-white/10 pt-6">
              <AskBar />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
