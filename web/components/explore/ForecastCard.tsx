'use client'

import type { ForecastResponse } from '@/lib/api'
import { MONTHS_LONG, fmt } from '@/lib/data'

const ymLong = (ym: string) => `${MONTHS_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`
const n0 = (v: number) => fmt(v, v < 10 ? 1 : 0)

export const askAssistant = (question: string) => window.dispatchEvent(new CustomEvent('fc-ask', { detail: question }))

/** Next 1-3 months (PERS model) next to the usual level for that month. */
export function ForecastCard({ f }: { f: ForecastResponse }) {
  const max = Math.max(1, ...f.months.flatMap((m) => [m.hi, m.typical_median_10y, m.observed_so_far?.value ?? 0]))
  const first = f.months[0]!
  const vs = first.vs_typical_pct
  const word = vs == null ? null : Math.abs(vs) < 10 ? 'close to usual' : vs > 0 ? `about ${Math.round(vs)}% above usual` : `about ${Math.round(-vs)}% below usual`
  const sk = f.aoi.key === 'pakistan' ? f.skill.country_h1 : f.skill.cell1_h1
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-mute">Next 3 months · experimental forecast</p>
        <span className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[0.6875rem] font-semibold text-mute">PERS model</span>
      </div>
      <p className="mt-2 text-sm leading-snug">
        Expect about <b className="text-accent">{n0(first.value)}</b> hotspots in {ymLong(first.ym)}
        {word ? <>, <b>{word}</b></> : null} (likely range {n0(first.lo)}–{n0(first.hi)}).
      </p>
      <ul className="mt-3 space-y-2.5" aria-label="Forecast by month">
        {f.months.map((m) => (
          <li key={m.ym}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">{ymLong(m.ym)}</span>
              <span className="tabular-nums text-ink-2">
                <b className="text-ink">{n0(m.value)}</b> · usual {n0(m.typical_median_10y)}
              </span>
            </div>
            <div className="relative mt-1 h-3 rounded-full bg-ink/10" role="img" aria-label={`${ymLong(m.ym)}: forecast ${n0(m.value)}, 80% range ${n0(m.lo)} to ${n0(m.hi)}, usual ${n0(m.typical_median_10y)}${m.observed_so_far ? `, ${n0(m.observed_so_far.value)} seen in the first ${m.observed_so_far.days} days` : ''}`}>
              <span className="absolute inset-y-0 rounded-full bg-accent/30" style={{ left: `${(m.lo / max) * 100}%`, width: `${Math.max(1, ((m.hi - m.lo) / max) * 100)}%` }} />
              {m.observed_so_far && <span className="absolute inset-y-[3px] left-0 rounded-full bg-signal/70" style={{ width: `${(m.observed_so_far.value / max) * 100}%` }} />}
              <span className="absolute -inset-y-0.5 w-0.5 bg-ink-2" style={{ left: `${(m.typical_median_10y / max) * 100}%` }} title="Usual (median of the last 10 years)" />
              <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent" style={{ left: `${(m.value / max) * 100}%` }} />
            </div>
            {m.observed_so_far && (
              <p className="mt-1 text-sm text-mute">
                {n0(m.observed_so_far.value)} already seen in the first {m.observed_so_far.days} of {m.observed_so_far.of} days (provisional)
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-mute">
        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-accent" /> forecast</span>
        <span className="flex items-center gap-1"><i className="h-2 w-4 rounded-full bg-accent/30" /> 80% range</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-0.5 bg-ink-2" /> usual (10-yr median)</span>
        <span className="flex items-center gap-1"><i className="h-2 w-3 rounded-full bg-signal/70" /> seen so far</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-mute">
        The usual level for each month, nudged by how unusual the last month ({f.drivers.last_month_vs_typical_pct > 0 ? '+' : ''}
        {f.drivers.last_month_vs_typical_pct}%) and the last 12 months ({f.drivers.last_12_months_vs_typical_pct > 0 ? '+' : ''}
        {f.drivers.last_12_months_vs_typical_pct}%) were. Tested on 2016–2026: {sk.skill_pct}% smaller error than &quot;the usual&quot; one month ahead
        (90% CI {sk.ci90_pct[0]} to {sk.ci90_pct[1]}); by month 3 it is about as good as the usual. Not a prediction of individual fires.
      </p>
      <button
        type="button"
        onClick={() => askAssistant(`Explain the forecast for ${f.aoi.label} in simple words. Is it going to be a bad fire season?`)}
        className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-strong px-3 text-sm font-bold hover:border-accent hover:text-accent"
      >
        ✦ Ask AI to explain
      </button>
    </div>
  )
}
