import siteJson from '@/content/site.json'
import themeJson from '@/content/theme.json'

import { siteSchema, themeSchema } from './schema'

export const site = siteSchema.parse(siteJson)
const theme = themeSchema.parse(themeJson)

/** Public URL of the deployed site. Set NEXT_PUBLIC_SITE_URL in the deploy environment. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
/** Aatish API base URL (FastAPI in /api of the repo). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '')

const triplet = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ')

/** theme.json → CSS variables, injected in <head> by the root layout. */
export const themeCss = `:root{--accent:${triplet(theme.accent)};--accent-fixed:${triplet(theme.accent)};--accent-paper:${triplet(theme.accentOnPaper)};--on-accent:${triplet(theme.onAccent)};--signal:${triplet(theme.signal)}}`
export const accentHex = theme.accent
