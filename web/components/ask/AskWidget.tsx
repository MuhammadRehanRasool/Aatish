'use client'

import { usePathname } from 'next/navigation'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import { checkApi } from '@/lib/archive'
import { getAskView } from '@/lib/askView'
import { API_URL } from '@/lib/content'
import { cn } from '@/lib/utils'

type Msg = { role: 'user' | 'assistant'; text: string; steps?: string[]; error?: boolean }

const SUGGEST = [
  'Was this year worse than usual?',
  'What will happen in the next 3 months?',
  'Punjab mein sab se zyada aag kab lagti hai?',
  'What is going on around Lahore? Why do fires happen there?',
  'Which province had the most fires last November?',
  'What does "MODIS-equivalent" mean?',
]

/* ---- tiny, safe Markdown subset: paragraphs, - / * / 1. lists, **bold**, *italic* (no HTML injection) ---- */
function inline(t: string, key: string) {
  const out: React.ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(t))) {
    if (m.index > last) out.push(t.slice(last, m.index))
    out.push(m[1] ? <b key={`${key}-${i++}`}>{m[1]}</b> : <em key={`${key}-${i++}`}>{m[2]}</em>)
    last = re.lastIndex
  }
  if (last < t.length) out.push(t.slice(last))
  return out
}

function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split('\n').filter((l) => l.trim())
        const isList = lines.length > 0 && lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))
        if (isList)
          return (
            <ul key={bi} className="my-1.5 list-disc space-y-1 pl-4">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        return (
          <p key={bi} className="my-1.5">
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {/^\s*([-*•]|\d+\.)\s+/.test(l) ? <>• {inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), `${bi}-${li}`)}</> : inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}

export function AskWidget() {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && open && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // shrink the auto-growing textarea back to one line once the input is cleared (after sending)
  useEffect(() => {
    if (!input && inputRef.current) inputRef.current.style.height = 'auto'
  }, [input])

  const send = useCallback(
    async (q: string) => {
      const question = q.trim().slice(0, 600)
      if (!question || busy) return
      const history = msgs.filter((m) => !m.error).slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }))
      setMsgs((m) => [...m, { role: 'user', text: question }, { role: 'assistant', text: '', steps: [] }])
      setInput('')
      setBusy(true)
      const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), fn(all[all.length - 1]!)])
      const ctl = new AbortController()
      abortRef.current = ctl
      if (!(await checkApi())) {
        patch((m) => ({
          ...m,
          text: 'The AI assistant needs the live Aatish API, which is not reachable right now, so the site is in **Archive Mode**. Every map, chart and number on the site still works from the bundled archive. Try again when the API is online.',
        }))
        setBusy(false)
        abortRef.current = null
        return
      }
      try {
        const v = getAskView()
        const r = await fetch(`${API_URL}/api/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, history, view: { ...v, page: v.page ?? path } }),
          signal: ctl.signal,
        })
        if (!r.ok || !r.body) {
          let msg = `The assistant is unavailable (${r.status}).`
          try {
            const j = await r.json()
            if (typeof j?.detail === 'string') msg = j.detail
          } catch {}
          patch((m) => ({ ...m, text: msg, error: true }))
          return
        }
        const reader = r.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            const ev = JSON.parse(line) as { type: string; text?: string; label?: string }
            if (ev.type === 'tool') patch((m) => ({ ...m, steps: [...(m.steps ?? []), ev.label ?? 'Looking up data'] }))
            else if (ev.type === 'retry') patch((m) => ({ ...m, steps: [...(m.steps ?? []), 'Busy, trying a backup model'] }))
            else if (ev.type === 'text') patch((m) => ({ ...m, text: ev.text ?? '' }))
            else if (ev.type === 'error') patch((m) => ({ ...m, text: ev.text ?? 'Something went wrong.', error: true }))
          }
        }
      } catch (e) {
        if (!ctl.signal.aborted) patch((m) => ({ ...m, text: 'Could not reach the assistant. Is the API running?', error: true }))
        else patch((m) => ({ ...m, text: m.text || 'Stopped.', error: !m.text }))
        void e
      } finally {
        setBusy(false)
        abortRef.current = null
      }
    },
    [busy, msgs, path]
  )

  // other components can open the assistant with a question: window.dispatchEvent(new CustomEvent('fc-ask', { detail: 'question' }))
  useEffect(() => {
    const onAsk = (e: Event) => {
      setOpen(true)
      const q = (e as CustomEvent<string>).detail
      if (q) void send(q)
    }
    window.addEventListener('fc-ask', onAsk)
    return () => window.removeEventListener('fc-ask', onAsk)
  }, [send])

  const onExplore = path?.startsWith('/explore')

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'fixed right-4 z-[60] inline-flex min-h-12 items-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-on-accent shadow-2xl transition-transform hover:-translate-y-0.5 hover:bg-ink hover:text-bg',
            onExplore ? 'bottom-4 lg:bottom-[15.5rem] lg:right-14' : 'bottom-5'
          )}
          aria-haspopup="dialog"
        >
          <span aria-hidden="true">✦</span> Ask Aatish AI
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="Ask anything about fires in Pakistan"
          className="fixed inset-x-2 bottom-2 z-[60] flex max-h-[min(78dvh,680px)] flex-col overflow-hidden rounded-2xl border border-line bg-bg/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[420px]"
          data-lenis-prevent
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <p className="font-display text-base font-bold">Ask anything</p>
              <p className="text-[0.68rem] text-mute">Answers use this site&apos;s satellite data · English or Urdu</p>
            </div>
            <div className="flex items-center gap-1">
              {msgs.length > 0 && (
                <button type="button" onClick={() => !busy && setMsgs([])} className="rounded-full px-2.5 py-1 text-[0.7rem] font-semibold text-mute hover:text-ink">
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full border border-line text-mute hover:border-ink hover:text-ink" aria-label="Close the assistant">
                ✕
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[0.86rem] leading-relaxed" aria-live="polite">
            {msgs.length === 0 && (
              <div>
                <p className="text-ink-2">
                  Ask in plain words: how bad a year was, what to expect next, or what is happening at a place. I look the numbers up in the
                  data before answering.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {SUGGEST.map((q) => (
                    <button key={q} type="button" onClick={() => void send(q)} className="rounded-full border border-line px-3 py-1.5 text-left text-[0.74rem] text-ink-2 hover:border-accent hover:text-ink">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ml-8 rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2">
                  {m.text}
                </div>
              ) : (
                <div key={i} className={cn('mr-4', m.error && 'text-accent')}>
                  {m.steps && m.steps.length > 0 && (
                    <ul className="mb-1 space-y-0.5 text-[0.7rem] text-mute">
                      {m.steps.map((s, j) => (
                        <li key={j}>✓ {s}</li>
                      ))}
                    </ul>
                  )}
                  {m.text ? <Markdown text={m.text} /> : busy && i === msgs.length - 1 ? <p className="animate-pulse text-mute">Thinking…</p> : null}
                </div>
              )
            )}
          </div>

          <form
            className="border-t border-line bg-bg px-3 pb-2.5 pt-3"
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
          >
            {/* one composer box: the textarea grows with the text, the send/stop button sits inside it */}
            <div
              className={cn(
                'flex items-end gap-1.5 rounded-2xl border bg-raised p-1.5 pl-3.5 transition-[border-color,box-shadow]',
                'border-line focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/20'
              )}
            >
              <label className="flex min-w-0 flex-1 self-center">
                <span className="sr-only">Your question</span>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    const el = e.target
                    el.style.height = 'auto'
                    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      void send(input)
                    }
                  }}
                  rows={1}
                  maxLength={600}
                  placeholder="Ask about fires, e.g. is Nov 2026 worse than usual?"
                  className="block max-h-32 w-full resize-none bg-transparent py-1.5 text-sm leading-6 text-ink outline-none placeholder:text-mute"
                />
              </label>
              {busy ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-strong text-ink transition-colors hover:border-ink"
                  aria-label="Stop the answer"
                  title="Stop"
                >
                  <span aria-hidden="true" className="h-3 w-3 rounded-[3px] bg-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-on-accent transition-[background-color,color,opacity,transform] hover:bg-ink hover:text-bg active:scale-95 disabled:cursor-not-allowed disabled:bg-line disabled:text-mute disabled:hover:bg-line disabled:hover:text-mute"
                  aria-label="Ask"
                  title="Ask (Enter)"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 16V4M4.5 9.5 10 4l5.5 5.5" />
                  </svg>
                </button>
              )}
            </div>
            <div className="mt-2 flex items-start justify-between gap-3 px-1 text-[0.64rem] leading-snug text-mute">
              <p>
                Gemini can make mistakes.
                {/* Numbers are from site data; other details are general knowledge. */}
              </p>
              <p className="shrink-0 whitespace-nowrap tabular-nums" aria-live="polite">
                {input.length > 500 ? (
                  <span className={cn(input.length >= 600 && 'text-accent')}>{input.length}/600</span>
                ) : (
                  <span className="hidden sm:inline">
                    <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift+Enter</kbd> new line
                  </span>
                )}
              </p>
            </div>
          </form>
        </section>
      )}
    </>
  )
}
