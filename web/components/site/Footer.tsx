import Link from 'next/link'

import { site } from '@/lib/content'
import { fmtDate, pakistan } from '@/lib/data'

import { Wordmark } from './Brand'

export function Footer() {
  const sources = [
    { label: 'NASA FIRMS', href: 'https://firms.modaps.eosdis.nasa.gov/' },
    { label: 'The challenge', href: site.challenge.url },
    { label: 'Team page', href: site.teamUrl },
    ...(site.repoUrl ? [{ label: 'Source code', href: site.repoUrl }] : []),
  ]
  return (
    <footer className="no-print border-t border-line">
      <div className="container-page grid gap-10 py-12 md:grid-cols-12 md:py-16">
        <div className="md:col-span-5">
          <p className="text-d4">
            <Wordmark name={site.name} />
          </p>
          <p className="label mt-3 text-accent">{site.tagline}</p>
          <p className="mt-3 max-w-sm text-sm text-mute">{site.footer.line}</p>
          <p className="em mt-6 max-w-sm text-xl text-ink-2">
            &ldquo;Detections are not fires, and fires are not burned area. We count detections, carefully.&rdquo;
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 text-sm md:col-span-7 md:grid-cols-3">
          <div>
            <p className="label mb-4 text-mute">Site</p>
            <ul className="space-y-2.5">
              {[{ label: 'Home', href: '/' }, ...site.nav].map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="text-ink-2 transition-colors hover:text-accent">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label mb-4 text-mute">Sources</p>
            <ul className="space-y-2.5">
              {sources.map((s) => (
                <li key={s.label}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-ink-2 transition-colors hover:text-accent">
                    {s.label} <span aria-hidden="true">↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-span-2 md:col-span-1">
            <p className="label mb-4 text-mute">Machine-readable</p>
            <ul className="space-y-2.5">
              <li>
                <a href="/llms.txt" className="text-ink-2 hover:text-accent">
                  llms.txt
                </a>
              </li>
              <li>
                <a href="/sitemap.xml" className="text-ink-2 hover:text-accent">
                  sitemap.xml
                </a>
              </li>
              <li>
                <Link href="/data#api" className="text-ink-2 hover:text-accent">
                  API reference
                </Link>
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <div className="container-page flex flex-col gap-2 border-t border-line py-6 text-mute sm:flex-row sm:justify-between">
        <p className="label">
          {site.event} · Team {site.team} · Developed by{' '}
          <a href={site.developer.url} target="_blank" rel="noopener noreferrer" className="text-ink-2 transition-colors hover:text-accent">
            {site.developer.name}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
        <p className="label">
          Data to {fmtDate(pakistan.data_extent.to)} · {site.footer.note}
        </p>
      </div>
    </footer>
  )
}
