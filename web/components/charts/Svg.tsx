/**
 * Tiny server-rendered SVG charts for the static pages (no JS shipped).
 * Every chart has a <title>/<desc> and the method page repeats key numbers in text or tables.
 */
import { fmt } from '@/lib/data'

type Series = { name: string; color: string; values: (number | null)[]; dash?: string }

export function LineChart({
  labels,
  series,
  height = 280,
  title,
  desc,
  shade,
  yLabel,
  tickEvery = 12,
  tickFormat = (l: string) => l.slice(0, 4),
}: {
  labels: string[]
  series: Series[]
  height?: number
  title: string
  desc: string
  shade?: { from: number; to: number; label: string }[]
  yLabel?: string
  tickEvery?: number
  tickFormat?: (l: string) => string
}) {
  const W = 800
  const pad = { l: 52, r: 12, t: 16, b: 28 }
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const max = Math.max(1, ...all) * 1.05
  const x = (i: number) => pad.l + (i / Math.max(1, labels.length - 1)) * (W - pad.l - pad.r)
  const y = (v: number) => height - pad.b - (v / max) * (height - pad.t - pad.b)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
      <title>{title}</title>
      <desc>{desc}</desc>
      {shade?.map((s) => (
        <g key={s.label}>
          <rect x={x(s.from)} y={pad.t} width={x(s.to) - x(s.from)} height={height - pad.t - pad.b} fill="rgb(var(--ink) / 0.05)" />
          <text x={x(s.from) + 6} y={pad.t + 12} fontSize="11" className="fill-mute font-mono">
            {s.label}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(var(--ink) / 0.1)" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" className="fill-mute font-mono">
            {fmt(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % tickEvery === 0 ? (
          <text key={l} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" className="fill-mute font-mono">
            {tickFormat(l)}
          </text>
        ) : null
      )}
      {yLabel && (
        <text x={12} y={pad.t + 4} fontSize="10" className="fill-mute font-mono" transform={`rotate(-90 12 ${pad.t + 4})`} textAnchor="end">
          {yLabel}
        </text>
      )}
      {series.map((s) => {
        let d = ''
        s.values.forEach((v, i) => {
          if (v === null) return
          d += `${d && s.values[i - 1] !== null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
        })
        return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={1.6} strokeDasharray={s.dash} strokeLinejoin="round" />
      })}
    </svg>
  )
}

export function Legend({ items }: { items: { name: string; color: string; dash?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-0.5 w-6" style={{ background: i.dash ? `repeating-linear-gradient(90deg, ${i.color} 0 5px, transparent 5px 9px)` : i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  )
}

export function GroupedBars({
  groups,
  series,
  title,
  desc,
  height = 240,
  format = (v: number) => v.toFixed(2),
}: {
  groups: string[]
  series: { name: string; color: string; values: number[] }[]
  title: string
  desc: string
  height?: number
  format?: (v: number) => string
}) {
  const W = 800
  const pad = { l: 44, r: 8, t: 18, b: 30 }
  const max = Math.max(...series.flatMap((s) => s.values)) * 1.1
  const gw = (W - pad.l - pad.r) / groups.length
  const bw = (gw * 0.7) / series.length
  const y = (v: number) => height - pad.b - (v / max) * (height - pad.t - pad.b)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
      <title>{title}</title>
      <desc>{desc}</desc>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t * max)} y2={y(t * max)} stroke="rgb(var(--ink) / 0.1)" />
          <text x={pad.l - 6} y={y(t * max) + 4} textAnchor="end" fontSize="10" className="fill-mute font-mono">
            {format(t * max)}
          </text>
        </g>
      ))}
      {groups.map((g, gi) => (
        <g key={g}>
          {series.map((s, si) => {
            const v = s.values[gi] ?? 0
            const x0 = pad.l + gi * gw + gw * 0.15 + si * bw
            return (
              <g key={s.name}>
                <rect x={x0} y={y(v)} width={bw - 2} height={height - pad.b - y(v)} rx={2} fill={s.color}>
                  <title>{`${g}, ${s.name}: ${format(v)}`}</title>
                </rect>
                <text x={x0 + (bw - 2) / 2} y={y(v) - 4} textAnchor="middle" fontSize="9" className="fill-ink-2 font-mono">
                  {format(v)}
                </text>
              </g>
            )
          })}
          <text x={pad.l + gi * gw + gw / 2} y={height - 10} textAnchor="middle" fontSize="10" className="fill-mute font-mono">
            {g}
          </text>
        </g>
      ))}
    </svg>
  )
}
