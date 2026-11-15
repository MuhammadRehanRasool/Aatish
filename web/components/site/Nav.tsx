'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import type { Site } from '@/lib/schema'
import { cn } from '@/lib/utils'

import { Wordmark } from './Brand'

/**
 * Floating editorial nav. Hides while scrolling down, returns on scroll up,
 * picks up a blurred backing once the page has moved.
 * Mobile: a full-screen index of giant links.
 */
export function Nav({ name, nav }: { name: string; nav: Site['nav'] }) {
  const pathname = usePathname()
  const [hidden, setHidden] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let last = window.scrollY
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        setScrolled(y > 24)
        setHidden(y > 160 && y > last + 4 ? true : y < last - 4 ? false : (h) => h)
        last = y
        ticking = false
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // close the mobile menu on navigation (state adjusted during render, not in an effect)
  const [prevPath, setPrevPath] = useState(pathname)
  if (pathname !== prevPath) {
    setPrevPath(pathname)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    const first = menuRef.current?.querySelector<HTMLElement>('a')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
      if (e.key === 'Tab' && menuRef.current) {
        const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a, button'))
        const firstEl = items[0]
        const lastEl = items[items.length - 1]
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault()
          lastEl?.focus()
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault()
          firstEl?.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const isActive = (href: string) => (href === '/' ? pathname === '/' : !href.includes('#') && pathname.startsWith(href))

  return (
    <>
      <header
        className={cn(
          'no-print fixed inset-x-0 top-0 z-50 transition-[transform,background-color,border-color] duration-500 ease-out',
          hidden && !open ? '-translate-y-full' : 'translate-y-0',
          'bg-bg/85 backdrop-blur-md',
          scrolled && !open ? 'border-b border-line' : 'border-b border-transparent'
        )}
      >
        <nav aria-label="Primary" className="container-page flex h-16 items-center justify-between gap-6">
          <Link href="/" className="group relative z-10 flex items-center text-[1.75rem]" aria-label={`${name}, home`}>
            <Wordmark name={name} />
          </Link>

          <ul className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'rounded-full px-3.5 py-2 text-[0.9rem] font-medium transition-colors',
                    isActive(item.href) ? 'text-ink' : 'text-ink-2 hover:text-ink'
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="ml-3">
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-[0.9rem] font-semibold transition-colors hover:border-accent hover:bg-accent hover:text-on-accent"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                Open Aatish
              </Link>
            </li>
          </ul>

          <button
            ref={buttonRef}
            type="button"
            className="label relative z-10 -mr-2 inline-flex min-h-11 items-center gap-2 px-2 text-ink md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Close' : 'Menu'}
            <span aria-hidden="true" className="relative block h-2.5 w-5">
              <span className={cn('absolute left-0 top-0 h-px w-5 bg-current transition-transform duration-300', open && 'translate-y-[5px] rotate-45')} />
              <span className={cn('absolute bottom-0 left-0 h-px w-5 bg-current transition-transform duration-300', open && '-translate-y-[4px] -rotate-45')} />
            </span>
          </button>
        </nav>
      </header>

      <div
        id="mobile-menu"
        ref={menuRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        hidden={!open}
        className={cn('fixed inset-0 z-40 flex-col bg-bg pt-16 md:hidden', open ? 'flex' : 'hidden')}
      >
        <ol className="container-page flex flex-1 flex-col justify-center gap-1">
          {[{ label: 'Home', href: '/' }, ...nav].map((item, i) => (
            <li key={item.href} className="border-b border-line">
              <Link href={item.href} onClick={() => setOpen(false)} className="flex items-baseline justify-between gap-4 py-3">
                <span className="font-display text-[clamp(2.5rem,13vw,4rem)] font-bold leading-none tracking-[-0.034em]">{item.label}</span>
                <span className="label text-mute">0{i + 1}</span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="container-page flex flex-wrap gap-x-5 gap-y-2 pb-8 pt-6">
          <p className="label py-2 text-mute">NASA Space Apps 2026 · Aero Snipers</p>
        </div>
      </div>
    </>
  )
}
