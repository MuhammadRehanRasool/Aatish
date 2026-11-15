import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface MarqueeProps {
  children: ReactNode
  /** Seconds per loop. Longer = calmer. */
  duration?: number
  reverse?: boolean
  className?: string
  label?: string
}

/**
 * Pure-CSS marquee: two identical tracks, the second hidden from assistive
 * tech. Pauses on hover; under reduced motion it becomes a static wrapped row.
 */
export function Marquee({ children, duration = 60, reverse, className, label }: MarqueeProps) {
  const style = { '--duration': `${duration}s`, '--direction': reverse ? 'reverse' : 'normal' } as React.CSSProperties
  return (
    <div className={cn('marquee', className)} style={style} role={label ? 'region' : undefined} aria-label={label}>
      <div className="marquee__track">{children}</div>
      <div className="marquee__track" aria-hidden="true">
        {children}
      </div>
    </div>
  )
}
