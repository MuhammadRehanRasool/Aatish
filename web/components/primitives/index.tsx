import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

const isExternal = (href: string) => /^https?:\/\//.test(href)

/* ------------------------------------------------------------------- Rich */
/**
 * Renders JSON copy. Words wrapped in *stars* become the serif-italic accent,
 * e.g. "Receipts, *not adjectives.*". Everything else is plain text.
 */
export function Rich({ text, emClassName = 'text-accent' }: { text: string; emClassName?: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('*') && p.endsWith('*') ? (
          <span key={i} className={cn('em pr-[0.04em]', emClassName)}>
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

/* ----------------------------------------------------------------- Kicker */
/** "05 — Now": the numbered mono label that opens every section. */
export function Kicker({ index, children, className }: { index?: string; children: ReactNode; className?: string }) {
  return (
    <p className={cn('label flex items-center gap-3 text-mute', className)}>
      {index && <span className="text-accent">{index}</span>}
      {index && <span aria-hidden="true" className="h-px w-8 bg-current opacity-40" />}
      <span>{children}</span>
    </p>
  )
}

/* ------------------------------------------------------------ SectionHead */
export function SectionHead({
  index,
  kicker,
  title,
  aside,
  className,
  id,
}: {
  index?: string
  kicker: string
  title: ReactNode
  aside?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <header className={cn('grid gap-8 md:grid-cols-12 md:items-end', className)}>
      <div className="md:col-span-8">
        <Kicker index={index}>{kicker}</Kicker>
        <h2 id={id} className="mt-6 text-d2 font-bold" data-reveal suppressHydrationWarning>
          {typeof title === 'string' ? <Rich text={title} /> : title}
        </h2>
      </div>
      {aside && (
        <div className="max-w-sm text-ink-2 md:col-span-4 md:justify-self-end md:text-right" data-reveal suppressHydrationWarning style={{ '--delay': '120ms' } as React.CSSProperties}>
          {aside}
        </div>
      )}
    </header>
  )
}

/* ------------------------------------------------------------- SmartLink */
export function SmartLink({
  href,
  children,
  className,
  ...rest
}: { href: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  if (isExternal(href) || href.startsWith('mailto:')) {
    return (
      <a href={href} className={className} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  )
}

/* ---------------------------------------------------------------- Arrow */
export function Arrow({ external, className }: { external?: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn('h-[0.8em] w-[0.8em] shrink-0 transition-transform duration-300 ease-out', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      {external ? <path d="M4.5 11.5l7-7M5.5 4.5h6v6" /> : <path d="M2 8h11M9 4l4 4-4 4" />}
    </svg>
  )
}

/* -------------------------------------------------------------- Button */
type ButtonVariant = 'solid' | 'ghost' | 'ink'

export function Button({
  href,
  children,
  variant = 'solid',
  className,
  download,
}: {
  href: string
  children: ReactNode
  variant?: ButtonVariant
  className?: string
  download?: string
}) {
  const external = isExternal(href)
  return (
    <SmartLink
      href={href}
      download={download}
      data-magnetic=""
      className={cn(
        'group inline-flex min-h-12 items-center gap-3 rounded-full px-6 py-3 text-[0.95rem] font-semibold tracking-tight transition-[background-color,color,border-color,transform] duration-300 ease-out active:scale-[0.98]',
        variant === 'solid' && 'bg-accent text-on-accent hover:bg-ink hover:text-bg',
        variant === 'ink' && 'bg-paper-ink text-paper hover:bg-accent hover:text-on-accent',
        variant === 'ghost' && 'border border-line-strong text-ink hover:border-ink',
        className
      )}
    >
      {children}
      <Arrow external={external} className={external ? 'group-hover:-translate-y-0.5 group-hover:translate-x-0.5' : 'group-hover:translate-x-1'} />
    </SmartLink>
  )
}

/* ----------------------------------------------------------- TextLink */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const external = isExternal(href)
  return (
    <SmartLink href={href} className={cn('group inline-flex items-center gap-1.5 font-medium', className)}>
      <span className="link">{children}</span>
      <Arrow external={external} className={external ? 'group-hover:-translate-y-0.5 group-hover:translate-x-0.5' : 'group-hover:translate-x-1'} />
      {external && <span className="sr-only">(opens in a new tab)</span>}
    </SmartLink>
  )
}

/* ---------------------------------------------------------------- Tag */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('label inline-flex items-center border border-line px-2.5 py-1.5 text-[0.6875rem] text-ink-2', className)}>
      {children}
    </span>
  )
}

/* ----------------------------------------------------------- LiveDot */
export function LiveDot({ className, tone = 'accent' }: { className?: string; tone?: 'accent' | 'signal' | 'green' }) {
  const color = tone === 'accent' ? 'bg-accent' : tone === 'signal' ? 'bg-signal' : 'bg-[#4ade80]'
  return (
    <span aria-hidden="true" className={cn('relative inline-flex h-2 w-2', className)}>
      <span className={cn('ping absolute inline-flex h-full w-full rounded-full opacity-60', color)} />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', color)} />
    </span>
  )
}

/* ------------------------------------------------------------- Stars */
export function Stars({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <span className={cn('flex gap-0.5', className)} aria-label={`${count} out of 5 stars`} role="img">
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 20 20" aria-hidden="true" className={cn('h-4 w-4 fill-current', i >= count && 'opacity-25')}>
          <path d="M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6L10 15l-5.4 3 1.2-6L1.3 7.8l6.1-.7z" />
        </svg>
      ))}
    </span>
  )
}

export const pad = (n: number) => String(n).padStart(2, '0')
