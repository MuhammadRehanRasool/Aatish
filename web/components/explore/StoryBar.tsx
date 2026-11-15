'use client'

import { cn } from '@/lib/utils'

import { Icon, Svg } from './ui'

export type Chapter = {
  short: string
  title: string
  /** One large, cinematic caption line shown above the detail. */
  lead?: string
  body: React.ReactNode
  stats: { k: string; v: string }[]
  footnote?: React.ReactNode
  actions?: React.ReactNode
}

/** Top-centre "Guided story" pills + the insight card of the active chapter. */
export function StoryBar({
  chapters,
  active,
  open,
  onOpen,
  onChapter,
}: {
  chapters: Chapter[]
  active: number | null
  open: boolean
  onOpen: (v: boolean) => void
  onChapter: (i: number | null) => void
}) {
  if (!open)
    return (
      <button type="button" onClick={() => onOpen(true)} className="glass pointer-events-auto inline-flex min-h-9 items-center gap-2 rounded-full px-4 text-xs font-bold text-ink hover:border-accent/60">
        <Svg d={Icon.story} className="text-accent" /> Guided tour · 3 chapters
      </button>
    )
  const ch = active !== null ? chapters[active] : null
  return (
    <div className="pointer-events-none flex w-full max-w-[40rem] flex-col items-center gap-2">
      <nav aria-label="Guided story" className="glass no-scrollbar pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1">
        <span className="hidden shrink-0 items-center gap-1.5 pl-2.5 pr-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-mute xl:flex">
          <Svg d={Icon.story} className="h-3.5 w-3.5 text-accent" /> Story
        </span>
        {chapters.map((c, i) => (
          <button
            key={c.short}
            type="button"
            aria-current={active === i ? 'step' : undefined}
            onClick={() => onChapter(i)}
            className={cn(
              'flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[0.72rem] font-semibold transition-colors',
              active === i ? 'bg-accent text-on-accent shadow-[0_0_24px_rgba(255,106,43,0.45)]' : 'text-ink-2 hover:bg-white/5 hover:text-ink'
            )}
          >
            <span className={cn('font-mono text-[0.62rem]', active === i ? 'opacity-80' : 'text-accent')}>{String(i + 1).padStart(2, '0')}</span>
            {c.short}
          </button>
        ))}
        <button type="button" onClick={() => onOpen(false)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-mute hover:bg-white/5 hover:text-ink" aria-label="Hide the guided story">
          <Svg d={Icon.close} className="h-3.5 w-3.5" />
        </button>
      </nav>

      {ch && active !== null && (
        <article className="glass glass-active pointer-events-auto max-h-[50dvh] lg:max-h-[calc(100dvh-23rem)] w-full max-w-[36rem] overflow-y-auto rounded-3xl px-6 py-6 sm:px-8" data-lenis-prevent aria-live="polite" key={active}>
          <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Chapter {String(active + 1).padStart(2, '0')} of {String(chapters.length).padStart(2, '0')}
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold leading-[1.1] tracking-tight sm:text-[1.75rem]">{ch.title}</h2>
          {ch.lead && <p className="em mt-3 text-xl leading-snug text-accent sm:text-2xl">{ch.lead}</p>}
          <div className="mt-4 text-[0.9375rem] leading-relaxed text-ink-2">{ch.body}</div>
          {ch.stats.length > 0 && (
            <dl className="mt-5 grid grid-cols-3 gap-2">
              {ch.stats.map((s) => (
                <div key={s.k} className="rounded-2xl border border-white/5 bg-black/20 px-3 py-3">
                  <dd className="font-display text-xl font-bold tabular-nums leading-none">{s.v}</dd>
                  <dt className="mt-1.5 font-mono text-[0.6875rem] uppercase leading-tight tracking-[0.06em] text-mute">{s.k}</dt>
                </div>
              ))}
            </dl>
          )}
          {ch.actions && <div className="mt-5 flex flex-wrap gap-2">{ch.actions}</div>}
          {ch.footnote && <p className="mt-4 text-sm leading-snug text-mute">{ch.footnote}</p>}
          <div className="mt-5 flex items-center gap-2 border-t border-white/5 pt-4">
            <button type="button" disabled={active === 0} onClick={() => onChapter(active - 1)} className="inline-flex min-h-10 items-center gap-1 rounded-full border border-white/15 px-4 text-sm font-semibold hover:border-ink disabled:opacity-30">
              <Svg d={Icon.prev} className="h-3.5 w-3.5" /> Prev
            </button>
            {active < chapters.length - 1 ? (
              <button type="button" onClick={() => onChapter(active + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-accent px-5 text-sm font-bold text-on-accent hover:bg-ink hover:text-bg">
                Next <Svg d={Icon.next} className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button type="button" onClick={() => onChapter(null)} className="inline-flex min-h-10 items-center gap-1 rounded-full bg-accent px-5 text-sm font-bold text-on-accent hover:bg-ink hover:text-bg">
                Finish tour
              </button>
            )}
            <button type="button" onClick={() => onChapter(null)} className="ml-auto text-sm font-semibold text-mute hover:text-ink">
              Free explore →
            </button>
          </div>
        </article>
      )}
    </div>
  )
}
