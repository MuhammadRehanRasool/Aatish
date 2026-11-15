import { useId } from 'react'

import { MONTHS, fmt, type Month } from '@/lib/data'
import { countColor, type RampName } from '@/lib/ramps'

/**
 * Server-rendered SVG of the real calendar (years down, months across).
 * It is the hero's poster before the 3D scene loads, the fallback without WebGL
 * or with reduced motion, and the full-size figure further down the page.
 */
export function CalendarPoster({
  months,
  ramp = 'cividis',
  labels = true,
  titles = true,
  className,
  title = 'Monthly harmonized hotspot counts for Pakistan',
}: {
  months: Month[]
  ramp?: RampName
  labels?: boolean
  /** Per-cell hover titles. Off for the hero poster, which is replaced by the 3D scene. */
  titles?: boolean
  className?: string
  title?: string
}) {
  const id = useId()
  const years = Array.from(new Set(months.map((m) => m.year))).sort((a, b) => a - b)
  const max = Math.max(...months.map((m) => m.value))
  const cell = 18
  const gap = 3
  const left = labels ? 40 : 0
  const top = labels ? 18 : 0
  const w = left + 12 * (cell + gap)
  const h = top + years.length * (cell + gap)
  const peak = months.reduce((a, b) => (b.value > a.value ? b : a))
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} role="img" aria-labelledby={`${id}t ${id}d`}>
      <title id={`${id}t`}>{title}</title>
      <desc id={`${id}d`}>
        {`${years.length} years by 12 months, ${years[0]} to ${years[years.length - 1]}. Darker is fewer detections, brighter is more (log scale). The highest month is ${MONTHS[peak.month - 1]} ${peak.year} with about ${fmt(peak.value)} MODIS-equivalent detections.`}
      </desc>
      {labels &&
        MONTHS.map((m, i) => (
          <text key={m} x={left + i * (cell + gap) + cell / 2} y={11} textAnchor="middle" className="fill-mute font-mono" fontSize="8">
            {m[0]}
          </text>
        ))}
      {labels &&
        years.map((y, j) =>
          y % 5 === 0 || j === 0 || j === years.length - 1 ? (
            <text key={y} x={left - 6} y={top + j * (cell + gap) + cell * 0.68} textAnchor="end" className="fill-mute font-mono" fontSize="8">
              {y}
            </text>
          ) : null
        )}
      {months.map((m) => {
        const j = years.indexOf(m.year)
        const partial = m.days_covered < m.days_in_month || m.gap_days > 0
        return (
          <rect
            key={m.ym}
            x={left + (m.month - 1) * (cell + gap)}
            y={top + j * (cell + gap)}
            width={cell}
            height={cell}
            rx={3}
            fill={countColor(ramp, m.value, max)}
            stroke={m.provisional || partial ? 'rgb(var(--ink) / 0.7)' : 'none'}
            strokeDasharray={m.provisional ? '2 2' : undefined}
            strokeWidth={m.provisional || partial ? 1 : 0}
          >
            {titles && <title>{`${MONTHS[m.month - 1]} ${m.year}: ${fmt(m.value)}${m.role === 'native' ? ' (MODIS observed)' : ` (80% band ${fmt(m.lo)}–${fmt(m.hi)})`}${m.provisional ? ', provisional NRT' : ''}${partial ? ', partial month' : ''}`}</title>}
          </rect>
        )
      })}
    </svg>
  )
}
