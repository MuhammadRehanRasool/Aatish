'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { MONTHS_LONG, fmt, type Month } from '@/lib/data'
import { cn } from '@/lib/utils'

const Calendar3D = dynamic(() => import('./Calendar3D'), { ssr: false })

function webglOk() {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Shows the server-rendered SVG poster first. If WebGL works and the user has not
 * asked for reduced motion, the 3D calendar is fetched (separate chunk) and fades in.
 */
export function HeroStage({ months, poster }: { months: Month[]; poster: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [visible, setVisible] = useState(true)
  const [shown, setShown] = useState(false)
  const [hover, setHover] = useState<Month | null>(null)
  const onHover = useCallback((m: Month | null) => setHover(m), [])
  const latest = months[months.length - 1]
  const m = hover ?? latest

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !webglOk()) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { rootMargin: '120px' })
    io.observe(el)
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300))
    idle(() => setEnabled(true))
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!enabled) return
    const t = window.setTimeout(() => setShown(true), 250)
    return () => window.clearTimeout(t)
  }, [enabled])

  return (
    <div ref={ref} className="relative aspect-square w-full">
      <div className={cn('absolute inset-0 flex items-center justify-center p-6 transition-opacity duration-700 ease-out', shown && 'opacity-0')}>
        {poster}
      </div>
      {enabled && (
        <div className={cn('absolute inset-0 opacity-0 transition-opacity duration-1000 ease-out', shown && 'opacity-100')} data-cursor="">
          <Calendar3D months={months} active={visible} onHover={onHover} />
        </div>
      )}
      {enabled && m && (
        <div
          aria-live="polite"
          className={cn(
            'pointer-events-none absolute left-3 top-3 min-w-[11.5rem] rounded-xl border bg-[#0B0D10]/85 px-3.5 py-2.5 shadow-[0_12px_30px_-10px_rgb(0_0_0/0.7)] backdrop-blur-md transition-[opacity,border-color] duration-500',
            shown ? 'opacity-100' : 'opacity-0',
            hover ? 'border-white/20' : 'border-accent/45',
          )}
        >
          <p className={cn('font-mono text-[0.625rem] font-semibold uppercase tracking-[0.14em]', hover ? 'text-mute' : 'text-accent')}>
            {hover ? 'Selected month' : `Latest month · ${m.days_covered < m.days_in_month ? `${m.days_covered} of ${m.days_in_month} days` : 'complete'}`}
          </p>
          <p className="mt-1 font-display text-lg font-bold leading-tight">
            {MONTHS_LONG[m.month - 1]} {m.year}
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            <b className="tabular-nums text-ink">{fmt(m.value)}</b> MODIS-eq hotspots
          </p>
          {m.pct != null && <p className="mt-0.5 text-xs text-mute">Above {Math.round(m.pct)}% of other {MONTHS_LONG[m.month - 1]}s</p>}
          {m.provisional && <p className="mt-0.5 text-xs text-mute">Provisional (near-real-time data)</p>}
          {!hover && <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[0.6875rem] text-mute">Hover a bar to read any month</p>}
        </div>
      )}
    </div>
  )
}
