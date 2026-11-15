'use client'

import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Lightweight 3D: the card leans toward the pointer anywhere on the page
 * (strongest when hovering it), with a moving glare. Children opt into depth
 * with `.portrait-layer` + `--z`. No WebGL, no library, ~1 kB.
 * Touch devices get a gentle tilt from scrolling instead.
 */
export function TiltStage({ children, className, max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = card.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let visible = true
    let raf = 0
    const io = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)))
    io.observe(el)

    const set = (rx: number, ry: number, gx: number, gy: number, glare: number) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--rx', `${rx.toFixed(2)}deg`)
        el.style.setProperty('--ry', `${ry.toFixed(2)}deg`)
        el.style.setProperty('--gx', `${gx}%`)
        el.style.setProperty('--gy', `${gy}%`)
        el.style.setProperty('--glare', String(glare))
      })
    }

    const fine = window.matchMedia('(hover: hover)').matches
    const onMove = (e: PointerEvent) => {
      if (!visible) return
      const r = el.getBoundingClientRect()
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      const inside = Math.abs(nx) <= 1 && Math.abs(ny) <= 1
      const k = inside ? 1 : 0.45
      const cx = Math.max(-1, Math.min(1, nx))
      const cy = Math.max(-1, Math.min(1, ny))
      el.toggleAttribute('data-active', inside)
      set(-cy * max * k, cx * max * k, 50 + cx * 40, 30 + cy * 40, inside ? 1 : 0.35)
    }
    const onLeave = () => {
      el.removeAttribute('data-active')
      set(0, 0, 50, 30, 0)
    }
    const onScroll = () => {
      if (!visible) return
      const r = el.getBoundingClientRect()
      const p = (r.top + r.height / 2) / window.innerHeight - 0.5
      set(p * max * 1.4, 0, 50, 30 + p * 60, 0.3)
    }

    if (fine) {
      window.addEventListener('pointermove', onMove, { passive: true })
      document.addEventListener('pointerleave', onLeave)
    } else {
      window.addEventListener('scroll', onScroll, { passive: true })
    }
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('scroll', onScroll)
    }
  }, [max])

  return (
    <div className={cn('portrait-stage', className)}>
      <div ref={card} className="portrait-card relative h-full w-full">
        {children}
      </div>
    </div>
  )
}
