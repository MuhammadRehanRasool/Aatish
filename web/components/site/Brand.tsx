import { cn } from '@/lib/utils'

/** "Orbital ember": a glowing ember with a satellite on a tilted orbit around it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('h-[0.95em] w-[0.95em] shrink-0', className)}>
      <defs>
        <radialGradient id="aatish-ember" cx="40%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#FFF4C2" />
          <stop offset="45%" stopColor="#FDB022" />
          <stop offset="100%" stopColor="#FF6A2B" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="6.5" fill="#FF6A2B" opacity="0.18" />
      <ellipse cx="12" cy="12" rx="10.2" ry="4.1" transform="rotate(-28 12 12)" fill="none" stroke="#FF6A2B" strokeOpacity="0.55" strokeWidth="1.1" />
      <circle cx="12" cy="12" r="3.7" fill="url(#aatish-ember)" />
      <circle cx="21" cy="7.2" r="1.35" fill="#F3EEE6" />
    </svg>
  )
}

/** Serif wordmark "Aatish." with the ember-orange dot. */
export function Wordmark({ name = 'Aatish', className, mark = true }: { name?: string; className?: string; mark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {mark && <BrandMark className="transition-transform duration-500 group-hover:rotate-[24deg]" />}
      <span className="em leading-none tracking-[-0.01em]">
        {name}<span className="not-italic text-accent">.</span>
      </span>
    </span>
  )
}
