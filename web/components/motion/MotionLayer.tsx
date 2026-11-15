'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * The site-wide interaction layer, in one pointer listener:
 *
 *   - Lenis smooth scrolling (native scroll on touch devices)
 *   - a custom cursor (fine pointers only) that grows over links and buttons
 *   - [data-magnetic] elements drift toward the pointer
 *   - [data-spotlight] elements get a soft accent glow under the pointer
 *
 * Everything is skipped under prefers-reduced-motion.
 */
export function MotionLayer() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const lenisRef = useRef<{ scrollTo: (t: number, o?: { immediate?: boolean }) => void } | null>(null)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    let destroyed = false
    let lenis: { destroy: () => void } | null = null
    import('lenis').then(({ default: Lenis }) => {
      if (destroyed) return
      const l = new Lenis({ autoRaf: true, anchors: { offset: -80 }, lerp: 0.11 })
      lenis = l
      lenisRef.current = l
    })

    const fine = window.matchMedia('(pointer: fine) and (hover: hover)').matches
    const root = document.documentElement
    let x = -100
    let y = -100
    let rx = -100
    let ry = -100
    let raf = 0
    let magnet: HTMLElement | null = null

    const loop = () => {
      rx += (x - rx) * 0.18
      ry += (y - ry) * 0.18
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
      if (ring.current) ring.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`
      raf = requestAnimationFrame(loop)
    }

    const release = () => {
      if (!magnet) return
      magnet.style.removeProperty('--tx')
      magnet.style.removeProperty('--ty')
      magnet = null
    }

    const onMove = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      const target = e.target as Element | null
      if (!target?.closest) return

      if (fine) {
        root.dataset.cursor = 'on'
        if (target.closest('a, button, [role="button"], label, [data-cursor]')) root.setAttribute('data-cursor-hover', '')
        else root.removeAttribute('data-cursor-hover')
      }

      const spot = target.closest<HTMLElement>('[data-spotlight]')
      if (spot) {
        const r = spot.getBoundingClientRect()
        spot.style.setProperty('--mx', `${e.clientX - r.left}px`)
        spot.style.setProperty('--my', `${e.clientY - r.top}px`)
      }

      const m = fine ? target.closest<HTMLElement>('[data-magnetic]') : null
      if (m !== magnet) release()
      if (m) {
        magnet = m
        const r = m.getBoundingClientRect()
        m.style.setProperty('--tx', `${(e.clientX - (r.left + r.width / 2)) * 0.22}px`)
        m.style.setProperty('--ty', `${(e.clientY - (r.top + r.height / 2)) * 0.3}px`)
      }
    }
    const onLeave = () => {
      root.dataset.cursor = 'off'
      release()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    if (fine) raf = requestAnimationFrame(loop)

    return () => {
      destroyed = true
      lenis?.destroy()
      lenisRef.current = null
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      root.removeAttribute('data-cursor')
      root.removeAttribute('data-cursor-hover')
    }
  }, [])

  // New page: jump to the top (or the hash) without a smooth glide.
  useEffect(() => {
    if (!window.location.hash) lenisRef.current?.scrollTo(0, { immediate: true })
  }, [pathname])

  return (
    <>
      <div className="scroll-progress" aria-hidden="true" />
      <div ref={ring} className="cursor-ring no-print" aria-hidden="true" />
      <div ref={dot} className="cursor-dot no-print" aria-hidden="true" />
    </>
  )
}
