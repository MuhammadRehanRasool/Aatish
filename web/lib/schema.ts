import { z } from 'zod'

const link = z.object({ label: z.string(), href: z.string() })
const item = z.object({ title: z.string(), body: z.string() })

export const siteSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  team: z.string(),
  event: z.string(),
  challenge: z.object({ title: z.string(), url: z.string().url() }),
  teamUrl: z.string().url(),
  repoUrl: z.string(),
  seo: z.object({ title: z.string(), description: z.string(), keywords: z.array(z.string()) }),
  nav: z.array(link),
  hero: z.object({ kicker: z.string(), lines: z.array(z.string()), lede: z.string(), primary: link, secondary: link }),
  marquee: z.array(z.string()),
  problem: z.object({ kicker: z.string(), title: z.string(), aside: z.string(), points: z.array(item) }),
  method: z.object({ kicker: z.string(), title: z.string(), aside: z.string(), steps: z.array(item) }),
  impact: z.object({ kicker: z.string(), title: z.string(), body: z.array(z.string()) }),
  audience: z.array(z.object({ who: z.string(), what: z.string() })),
  cta: z.object({ title: z.string(), body: z.string(), label: z.string(), href: z.string() }),
  footer: z.object({ line: z.string(), note: z.string() }),
})

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const themeSchema = z.object({ accent: hex, accentOnPaper: hex, onAccent: hex, signal: hex })

export type Site = z.infer<typeof siteSchema>
