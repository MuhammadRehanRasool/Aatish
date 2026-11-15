'use client'

import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  /** The exact string to show at rest, e.g. "100+", "$70" or "27.45%". */
  value: string
  /** Set false for things that only look like numbers (years). */
  animate?: boolean
  durationMs?: number
  className?: string
}

const NUMBER = /^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/

/**
 * Server-renders the final value (crawlers, no-JS and reduced-motion users
 * never see a zero). If the number starts below the fold, it counts up from 0
 * when it scrolls into view. The target is read from the value itself.
 */
export function CountUp({ value, animate = true, durationMs = 1400, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    const el = ref.current
    const match = value.match(NUMBER)
    if (!el || !animate || !match) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top < window.innerHeight) return // already visible: never flash back to 0

    const [, prefix = '', num = '0', suffix = ''] = match
    const to = Number(num.replace(/,/g, ''))
    const decimals = num.includes('.') ? num.split('.')[1]!.length : 0
    const grouped = num.includes(',')
    const format = (n: number) =>
      `${prefix}${grouped ? n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }) : n.toFixed(decimals)}${suffix}`
    setDisplay(format(0))

    let raf = 0
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        io.disconnect()
        const start = performance.now()
        const tick = (t: number) => {
          const p = Math.min(1, (t - start) / durationMs)
          const eased = 1 - Math.pow(1 - p, 4)
          setDisplay(p < 1 ? format(to * eased) : value)
          if (p < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [value, animate, durationMs])

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{value}</span>
    </span>
  )
}
