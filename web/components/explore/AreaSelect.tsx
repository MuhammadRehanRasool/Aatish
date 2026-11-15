'use client'

import { useEffect, useId, useRef, useState } from 'react'

import { fmt, regionSummary } from '@/lib/data'
import { cn } from '@/lib/utils'

type Option = { key: string; label: string }

/**
 * Styled listbox replacing the native <select> (whose OS dropdown ignored the dark theme).
 * Shows each area's 2000-2026 MODIS-equivalent total and its share of Pakistan's total.
 * Keyboard: Enter/Space/ArrowDown opens, arrows/Home/End move, Enter selects, Escape/Tab closes.
 */
export function AreaSelect({ options, value, customLabel, onChange }: { options: Option[]; value: string; customLabel?: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const selected = options.find((o) => o.key === value)
  const pkTotal = regionSummary.pakistan?.total ?? 0

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openAt = (i: number) => {
    setActive(i)
    setOpen(true)
  }
  const pick = (i: number) => {
    const o = options[i]
    setOpen(false)
    if (o && o.key !== value) onChange(o.key)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const cur = Math.max(0, options.findIndex((o) => o.key === value))
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        openAt(cur)
      }
      return
    }
    const last = options.length - 1
    const moves: Record<string, number> = { ArrowDown: Math.min(last, active + 1), ArrowUp: Math.max(0, active - 1), Home: 0, End: last }
    if (e.key in moves) {
      e.preventDefault()
      setActive(moves[e.key]!)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1" onKeyDown={onKey}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        aria-label="Area"
        onClick={() => (open ? setOpen(false) : openAt(Math.max(0, options.findIndex((o) => o.key === value))))}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-xl border bg-black/30 px-3 text-left outline-none transition-colors',
          open ? 'border-accent' : 'border-white/15 hover:border-white/30 focus-visible:border-accent',
        )}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-display text-base font-bold">{selected?.label ?? customLabel ?? 'Custom area'}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-4 w-4 shrink-0 text-mute transition-transform', open && 'rotate-180')}>
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label="Area"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 max-h-[22rem] overflow-y-auto rounded-xl border border-white/12 bg-[#11141A]/95 p-1.5 shadow-[0_24px_60px_-12px_rgb(0_0_0/0.75)] backdrop-blur-xl"
        >
          {options.map((o, i) => {
            const total = regionSummary[o.key]?.total
            const share = total != null && pkTotal ? total / pkTotal : null
            const isSel = o.key === value
            return (
              <li key={o.key} role="presentation">
                {i === 1 && <p className="px-2.5 pb-1 pt-2 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-mute">Provinces &amp; territories</p>}
                <div
                  id={`${id}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={isSel}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                  className={cn('cursor-pointer rounded-lg px-2.5 py-2 transition-colors', i === active ? 'bg-white/[0.07]' : '', isSel && 'bg-accent/[0.12]')}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', isSel ? 'text-accent' : 'text-ink')}>{o.label}</span>
                    {total != null && <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-mute">{fmt(total)}</span>}
                    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0 text-accent', !isSel && 'invisible')}>
                      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {share != null && i > 0 && (
                    <div className="mr-[1.375rem] mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                      <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.max(1.5, share * 100)}%` }} />
                    </div>
                  )}
                </div>
              </li>
            )
          })}
          <li role="presentation" className="border-t border-white/10 px-2.5 pb-1 pt-2 text-[0.6875rem] text-mute">
            Numbers: MODIS-equivalent hotspots, Nov 2000 to today.
          </li>
        </ul>
      )}
    </div>
  )
}
