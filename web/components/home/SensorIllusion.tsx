'use client'

import { useState } from 'react'

import raw from '@/content/data/raw_counts_pakistan.json'
import { fmt, pakistan } from '@/lib/data'
import { cn } from '@/lib/utils'

type Row = { year: number; raw_modis: number; raw_viirs: number; raw_total: number; harmonized: number }
// 2002 is left out: Aqua only started in July, so its raw count is not a full MODIS year.
const rows = (raw.years as Row[]).filter((r) => r.year >= 2003)
const by = (y: number) => rows.find((r) => r.year === y)
const r11 = by(2011)
const r12 = by(2012)
const last = rows[rows.length - 1]!
const rawJump = r11 && r12 ? r12.raw_total / r11.raw_total : null
const harmJump = r11 && r12 ? r12.harmonized / r11.harmonized : null
const trend = pakistan.stats.trend

/** One-click "Raw counts vs Harmonized series": why adding MODIS + VIIRS fakes a 2012 explosion. */
export function SensorIllusion() {
  const [mode, setMode] = useState<'raw' | 'harm'>('raw')
  const isRaw = mode === 'raw'
  const max = isRaw ? Math.max(...rows.map((r) => r.raw_total)) : Math.max(...rows.map((r) => r.harmonized))
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => Math.round((max * f) / 1000) * 1000)

  return (
    <section id="illusion" aria-labelledby="illusion-title" className="scroll-mt-24 border-t border-line py-16 md:py-20">
      <div className="container-page">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <p className="label flex items-center gap-3 text-mute">
              <span className="text-accent">00</span>
              <span aria-hidden="true" className="h-px w-8 bg-current opacity-40" />
              <span>The sensor illusion</span>
            </p>
            <h2 id="illusion-title" className="mt-5 text-d3 font-bold">
              In 2012 the fires did not explode. <span className="em text-accent">The cameras changed.</span>
            </h2>
          </div>
          <div className="lg:col-span-5 lg:justify-self-end">
            <div role="group" aria-label="Choose the series" className="inline-flex rounded-full border border-white/10 bg-[#0E1116]/80 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
              {(
                [
                  { v: 'raw', l: 'Raw counts', s: 'misleading 2012 jump' },
                  { v: 'harm', l: 'Harmonized series', s: 'true trend' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  aria-pressed={mode === o.v}
                  onClick={() => setMode(o.v)}
                  className={cn('rounded-full px-4 py-2 text-left transition-colors sm:px-5', mode === o.v ? (o.v === 'raw' ? 'bg-signal text-bg' : 'bg-accent text-on-accent') : 'text-ink-2 hover:text-ink')}
                >
                  <span className="block text-sm font-bold leading-tight">{o.l}</span>
                  <span className="block text-[0.68rem] leading-tight opacity-80">{o.s}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-12">
          <figure className="rounded-frame border border-white/10 bg-[#0E1116]/80 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)] sm:p-6 lg:col-span-8">
            <div className="relative h-64 sm:h-72">
              {ticks.map((t) => (
                <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-white/[0.06]" style={{ bottom: `${(t / max) * 100}%` }}>
                  <span className="absolute -top-2.5 left-0 bg-[#0E1116] pr-1 font-mono text-[0.6rem] text-mute">{t >= 1000 ? `${t / 1000}k` : t}</span>
                </div>
              ))}
              <div className="absolute inset-0 left-8 flex items-end gap-[3px]" role="img" aria-label={isRaw ? `Raw yearly detections for Pakistan, 2003 to ${last.year}: about ${fmt(r11?.raw_total ?? 0)} in 2011 and ${fmt(r12?.raw_total ?? 0)} in 2012, when VIIRS was added.` : `Harmonized yearly MODIS-equivalent hotspots, 2003 to ${last.year}: smooth through 2012.`}>
                {rows.map((r) => {
                  const modisH = ((isRaw ? r.raw_modis : r.harmonized) / max) * 100
                  const viirsH = isRaw ? (r.raw_viirs / max) * 100 : 0
                  return (
                    <div key={r.year} className="group relative flex h-full flex-1 flex-col justify-end" title={isRaw ? `${r.year}: ${fmt(r.raw_total)} raw detections (MODIS ${fmt(r.raw_modis)} + VIIRS ${fmt(r.raw_viirs)})` : `${r.year}: ${fmt(r.harmonized)} MODIS-equivalent hotspots`}>
                      <div className="w-full rounded-t-[3px] bg-signal/85 transition-[height] duration-700 ease-out" style={{ height: `${viirsH}%` }} />
                      <div className={cn('w-full transition-[height] duration-700 ease-out', isRaw ? 'bg-accent/90' : 'rounded-t-[3px] bg-gradient-to-t from-accent/70 to-accent')} style={{ height: `${modisH}%` }} />
                      {r.year === 2012 && (
                        <span className="pointer-events-none absolute -top-1 left-1/2 h-full w-px -translate-x-1/2 border-l border-dashed border-ink/40" aria-hidden="true" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="ml-8 mt-2 flex justify-between font-mono text-[0.62rem] text-mute">
              <span>{rows[0]!.year}</span>
              <span>2012 · VIIRS joins</span>
              <span>{last.year}</span>
            </div>
            <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[0.72rem] text-mute">
              {isRaw ? (
                <>
                  <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-accent/90" /> MODIS detections</span>
                  <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-signal/85" /> VIIRS detections (S-NPP, NOAA-20, NOAA-21)</span>
                </>
              ) : (
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-accent" /> Aatish series, MODIS-equivalent hotspots</span>
              )}
              <span>Pakistan, complete years, static heat sources excluded. Hover a bar for its number.</span>
            </figcaption>
          </figure>

          <div className="flex flex-col justify-center gap-4 lg:col-span-4" aria-live="polite">
            {isRaw ? (
              <>
                <p className="font-display text-[clamp(3rem,6vw,4.5rem)] font-bold leading-none tracking-tight text-signal">×{rawJump?.toFixed(1)}</p>
                <p className="text-lede text-ink-2">
                  Raw detections from 2011 to 2012 ({fmt(r11?.raw_total ?? 0)} → {fmt(r12?.raw_total ?? 0)}). Simply adding the sharper VIIRS satellites to MODIS fakes an overnight fire explosion. By {last.year}, raw counts are{' '}
                  <b className="text-ink">{(last.raw_total / last.harmonized).toFixed(0)}×</b> the harmonized series.
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-[clamp(3rem,6vw,4.5rem)] font-bold leading-none tracking-tight text-accent">
                  {trend ? `${trend.pct_per_year > 0 ? '+' : ''}${trend.pct_per_year}%` : `×${harmJump?.toFixed(2)}`}
                  {trend && <span className="em ml-2 text-[0.5em] font-normal text-ink-2">a year</span>}
                </p>
                <p className="text-lede text-ink-2">
                  The real long-term trend{trend ? ` (${trend.years[0]}–${trend.years[1]}, statistically significant)` : ''}. With every VIIRS detection weighted into MODIS units, 2011 → 2012 is ×{harmJump?.toFixed(2)}, a genuine MODIS-observed rise, not a sensor artefact. One
                  scale, 26 years.
                </p>
              </>
            )}
            <button type="button" onClick={() => setMode(isRaw ? 'harm' : 'raw')} className="self-start rounded-full border border-white/15 px-4 py-2 text-sm font-bold hover:border-accent hover:text-accent">
              {isRaw ? 'Now fix it: show the harmonized series →' : '← Show the raw counts again'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
