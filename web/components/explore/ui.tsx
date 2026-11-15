'use client'

import { useEffect } from 'react'

import { API_CONFIGURED, checkApi, useApiStatus } from '@/lib/archive'
import { cn } from '@/lib/utils'

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T
  options: { v: T; l: string; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-full border border-white/10 bg-black/25 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.v)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35',
            size === 'sm' ? 'min-h-7 px-2.5 text-[0.7rem]' : 'min-h-8 px-3 text-xs',
            value === o.v ? 'bg-ink text-bg shadow' : 'text-ink-2 hover:text-ink'
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

export function Glass({ title, children, className, aside, active }: { title?: React.ReactNode; children: React.ReactNode; className?: string; aside?: React.ReactNode; active?: boolean }) {
  return (
    <section className={cn('rounded-3xl border border-white/5 bg-[#0B0D10]/80 px-6 py-6 backdrop-blur-2xl sm:px-8', active && 'glass-active', className)}>
      {(title || aside) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-mute">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/** Collapsed-by-default section for secondary detail, so the story is what reads first. */
export function Fold({ title, children, defaultOpen = false }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-3xl border border-white/5 bg-[#0B0D10]/80 backdrop-blur-2xl" open={defaultOpen || undefined}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-sm font-semibold text-ink-2 transition-colors hover:text-ink sm:px-8 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span aria-hidden="true" className="text-accent transition-transform duration-300 group-open:rotate-180">▾</span>
      </summary>
      <div className="px-6 pb-6 sm:px-8">{children}</div>
    </details>
  )
}

export function Toggle({ on, onChange, label, hint, swatch, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; swatch: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center">{swatch}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">{label}</span>
        {hint && <span className="block truncate text-xs text-mute">{hint}</span>}
      </span>
      <span className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-accent' : 'bg-ink/20')}>
        <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-bg transition-transform', on ? 'translate-x-3.5' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}

export const Icon = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" />,
  prev: <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  next: <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  poly: <path d="M5 18L4 7l8-4 8 6-3 10z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />,
  box: <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeDasharray="3 2" />,
  pin: (
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeDasharray="2.5 2" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />,
  download: <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  link: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
      <path d="M3.5 16l5-5 4 4 3-3 5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
    </>
  ),
  tools: <path d="M4 20l3.5-1 10-10a2.1 2.1 0 00-3-3l-10 10zM13 7l3 3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />,
  story: <path d="M5 4.5h10l4 4v11H5zM8.5 11h7M8.5 14.5h7M8.5 7.5h3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />,
}
export const Svg = ({ d, className }: { d: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-4 w-4', className)}>
    {d}
  </svg>
)

/** Calm data-source indicator: "Live API · 48ms" or "Archive Mode · 2000–2026". Never an error banner. */
export function StatusPill({ span, className }: { span: string; className?: string }) {
  const st = useApiStatus()
  useEffect(() => {
    void checkApi()
  }, [])
  const live = st.mode === 'live'
  const archive = st.mode === 'archive'
  return (
    <button
      type="button"
      onClick={() => archive && API_CONFIGURED && void checkApi(true)}
      title={
        live
          ? 'Connected to the Aatish API: any area, any date range, live FIRMS and the AI assistant.'
          : archive
            ? `The live API is not reachable, so this page uses the bundled archive (same numbers, built by the same code; default filters). ${API_CONFIGURED ? 'Click to try the API again.' : ''}`
            : 'Checking the API…'
      }
      className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 font-mono text-[0.66rem] font-semibold uppercase tracking-[0.1em] transition-colors', live ? 'border-signal/40 bg-signal/10 text-signal' : 'border-white/15 bg-white/[0.04] text-ink-2 hover:text-ink', className)}
      aria-live="polite"
    >
      <span className={cn('relative h-1.5 w-1.5 rounded-full', live ? 'bg-signal' : archive ? 'bg-[#E9B44C]' : 'animate-pulse bg-mute')}>
        {live && <span className="absolute inset-0 animate-ping rounded-full bg-signal/70" />}
      </span>
      {live ? `Live API · ${st.ms ?? '–'}ms` : archive ? `Archive Mode · ${span}` : 'Connecting…'}
    </button>
  )
}
