import type { ReactNode } from 'react'

import { Kicker, Rich } from '@/components/primitives'

/** Inner-page header. `title` accepts *stars* for the italic accent. */
export function PageHeader({ kicker, title, children, emClassName }: { kicker: string; title: string; children?: ReactNode; emClassName?: string }) {
  return (
    <header className="container-page pb-14 pt-32 md:pb-20 md:pt-40">
      <Kicker>{kicker}</Kicker>
      <h1 className="rise mt-6 text-d1 font-bold">
        <span>
          <Rich text={title} emClassName={emClassName} />
        </span>
      </h1>
      {children && (
        <div className="mt-8 max-w-2xl text-lede text-ink-2" data-reveal suppressHydrationWarning>
          {children}
        </div>
      )}
    </header>
  )
}
