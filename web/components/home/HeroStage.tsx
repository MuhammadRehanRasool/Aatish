'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import type { Month } from '@/lib/data'
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
  const [label, setLabel] = useState<string | null>(null)
  const onHover = useCallback((l: string | null) => setLabel(l), [])

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
      <p aria-live="polite" className="label pointer-events-none absolute inset-x-0 bottom-3 text-center text-ink-2">
        {label ?? (enabled ? 'Hover a bar · rows are years, columns are months' : '')}
      </p>
    </div>
  )
}
