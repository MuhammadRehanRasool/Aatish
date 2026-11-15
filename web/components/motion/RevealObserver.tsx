'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * One observer for the whole page. Any element with [data-reveal] gets
 * [data-in] when it scrolls into view. Styles live in globals.css.
 * Content is visible without JS: the hidden state is only armed by the
 * inline script in the root layout (html.js-motion).
 *
 * This effect can run before a streamed page segment has hydrated, so every
 * [data-reveal] element must also carry `suppressHydrationWarning`, or React
 * reports the added [data-in] as a hydration mismatch.
 */
export function RevealObserver() {
  const pathname = usePathname()

  useEffect(() => {
    const root = document.documentElement
    root.dataset.motionReady = '1'

    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-in])'))
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.setAttribute('data-in', ''))
      return
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-in', '')
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [pathname])

  return null
}

/** Runs before first paint. Arms reveal animations, with a failsafe if hydration never happens. */
export const motionBootScript = `(function(){var d=document.documentElement;d.classList.add('js-motion');setTimeout(function(){if(!d.dataset.motionReady){d.classList.remove('js-motion')}},4000)})();`
