import type { Metadata } from 'next'

import { Button, Kicker, SectionHead, TextLink } from '@/components/primitives'
import { PageHeader } from '@/components/site/PageHeader'
import { site } from '@/lib/content'

export const metadata: Metadata = {
  title: 'About the project',
  description:
    'Aatish was built by team Aero Snipers at the NASA Space Apps Challenge 2026 Karachi event for the challenge "Harmonization of MODIS and VIIRS Hot Spots". How it was made, including how AI tools were used.',
  alternates: { canonical: '/about' },
}

const requirements = [
  ['Documented MODIS ↔ VIIRS harmonization method', '/method'],
  ['Harmonized time series from the early 2000s to the present', '/explore'],
  ['Area selection: draw a polygon or box, or enter latitude, longitude and radius', '/explore'],
  ['Date range filter', '/explore'],
  ['Calendar heatmap of years × months', '/explore'],
  ['Current month against the historical median', '/explore'],
  ['Colour-blind-safe colour scales', '/explore'],
  ['Key figures: totals, highest year, peak month, trend', '/explore'],
  ['CSV of hotspots, monthly CSV, PNG of the calendar', '/explore'],
]

const ai = [
  ['Data audit', 'Checked coverage, duplicates and satellite hand-over dates across the raw FIRMS files.'],
  ['Method research', 'Searched the literature on MODIS/VIIRS comparison and ran a leave-one-year-out bake-off of candidate methods on our data.'],
  ['Pipeline and validation code', 'Wrote the harmonization build and the validation script that refits from the output and fails on any regression.'],
  ['Self-audit', 'Looked for weak spots in our own method (uncertainty bands, NOAA-21 FRP offset, anomaly skill) and fixed them.'],
  ['API and website', 'Wrote the FastAPI service and this site from our design brief and data.'],
]

export default function AboutPage() {
  return (
    <>
      <PageHeader kicker="About" title="Built in *48 hours* in Karachi.">
        <p>
          {site.name} is our answer to the NASA Space Apps Challenge 2026 problem &ldquo;{site.challenge.title}&rdquo;, set with CONAE, Argentina&apos;s space agency. We are team {site.team}.
        </p>
        <p>
          Developed by{' '}
          <a href={site.developer.url} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
            {site.developer.name}
          </a>
          .
        </p>
      </PageHeader>

      <section className="section pt-0" aria-labelledby="req">
        <div className="container-page">
          <SectionHead id="req" index="01" kicker="The brief" title="What the challenge *asked for*." aside={<TextLink href={site.challenge.url}>Read the challenge</TextLink>} />
          <ul className="mt-12 divide-y divide-line border-y border-line">
            {requirements.map(([r, href]) => (
              <li key={r} className="flex items-center justify-between gap-6 py-4">
                <span className="flex items-center gap-4">
                  <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs font-bold text-on-accent">
                    ✓
                  </span>
                  {r}
                </span>
                <TextLink href={href!} className="shrink-0 text-sm text-ink-2">
                  See it
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section surface-raised" aria-labelledby="ai-title">
        <div className="container-page grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Kicker index="02">How we used AI</Kicker>
            <h2 id="ai-title" className="mt-6 text-d3 font-bold">
              Tools, and what we checked
            </h2>
            <p className="mt-6 text-ink-2">
              Space Apps asks every team to describe how SI (AI) tools were used. We used Claude Code (Anthropic) as a pair programmer and research assistant, and logged every contribution as we went.
            </p>
          </div>
          <ol className="divide-y divide-line border-y border-line lg:col-span-8">
            {ai.map(([t, d], i) => (
              <li key={t} className="grid gap-2 py-6 md:grid-cols-12 md:gap-6">
                <p className="label text-accent md:col-span-1">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="text-xl font-bold md:col-span-4">{t}</h3>
                <p className="text-ink-2 md:col-span-7">{d}</p>
              </li>
            ))}
            <li className="py-6 text-ink-2">
              Every reported number is reproduced by a script: the pipeline build is deterministic (two runs give identical files) and the validation script recomputes the metrics from the output. Claims we could not check against an official source are marked &ldquo;not verified&rdquo;.
            </li>
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="team">
        <div className="container-page grid gap-10 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <Kicker index="03">Team</Kicker>
            <h2 id="team" className="mt-6 text-d2 font-bold">
              {site.team}
            </h2>
            <p className="mt-6 max-w-2xl text-lede text-ink-2">{site.event}. Our team page lists the members and the final submission.</p>
          </div>
          <div className="md:col-span-4 md:justify-self-end">
            <Button href={site.teamUrl} variant="ghost">
              Team page on Space Apps
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
