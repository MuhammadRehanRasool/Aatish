'use client'

import { useState } from 'react'

import { askAssistant } from '@/components/explore/ForecastCard'

const CHIPS = ['Why did Nov 2026 spike in Punjab?', 'Compare Punjab vs Sindh', 'Next 3 months outlook', 'Explain MODIS-equivalent simply']

/** Central "Ask Aatish AI" command bar. The assistant (AskWidget) is only called when a question is asked. */
export function AskBar() {
  const [q, setQ] = useState('')
  return (
    <div className="text-center">
      <p className="font-display text-xl font-bold">
        Ask <span className="em font-normal text-accent">Aatish AI</span>
      </p>
      <p className="mt-1 text-sm text-ink-2">Answers are looked up in the same harmonized data, in English or Urdu.</p>
      <form
        className="mx-auto mt-4 flex max-w-2xl items-center gap-2 rounded-full border border-white/15 bg-black/30 p-1.5 pl-5 focus-within:border-accent"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) {
            askAssistant(q.trim())
            setQ('')
          }
        }}
      >
        <span aria-hidden="true" className="text-accent">
          ✦
        </span>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Ask a question about fires in Pakistan</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} placeholder="e.g. Is this November worse than usual in Lahore?" className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-mute" />
        </label>
        <button type="submit" disabled={!q.trim()} className="h-10 rounded-full bg-accent px-5 text-sm font-bold text-on-accent hover:bg-ink hover:text-bg disabled:opacity-40">
          Ask
        </button>
      </form>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {CHIPS.map((c) => (
          <button key={c} type="button" onClick={() => askAssistant(c)} className="rounded-full border border-white/15 px-3.5 py-1.5 text-[0.78rem] text-ink-2 transition-colors hover:border-accent hover:text-ink">
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
