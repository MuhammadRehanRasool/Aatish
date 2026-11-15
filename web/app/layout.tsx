import type { Metadata, Viewport } from 'next'

import { AskWidget } from '@/components/ask/AskWidget'
import { MotionLayer } from '@/components/motion/MotionLayer'
import { motionBootScript, RevealObserver } from '@/components/motion/RevealObserver'
import { Footer } from '@/components/site/Footer'
import { JsonLd } from '@/components/site/JsonLd'
import { Nav } from '@/components/site/Nav'
import { SITE_URL, site, themeCss } from '@/lib/content'
import { fontVariables } from '@/lib/fonts'

import './globals.css'

const { title, description, keywords } = site.seo

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: `%s · ${site.name}` },
  description,
  keywords,
  applicationName: site.name,
  authors: [{ name: `Team ${site.team}`, url: site.teamUrl }],
  creator: `Team ${site.team}`,
  alternates: { canonical: '/' },
  openGraph: { type: 'website', locale: 'en_US', url: SITE_URL, siteName: site.name, title, description },
  twitter: { card: 'summary_large_image', title, description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  category: 'science',
}

export const viewport: Viewport = { themeColor: '#0B0D10', colorScheme: 'dark' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
        <script dangerouslySetInnerHTML={{ __html: motionBootScript }} />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="Plain-text summary for language models" />
        <JsonLd />
      </head>
      <body className="grain min-h-screen">
        <a
          href="#main"
          className="label fixed left-4 top-4 z-[70] -translate-y-24 bg-accent px-4 py-3 text-on-accent transition-transform focus:translate-y-0"
        >
          Skip to content
        </a>
        <Nav name={site.name} nav={site.nav} />
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <Footer />
        <AskWidget />
        <RevealObserver />
        <MotionLayer />
      </body>
    </html>
  )
}
