import { Bricolage_Grotesque, Geist_Mono, Instrument_Serif, Inter_Tight } from 'next/font/google'

/**
 * Four roles: an expressive display grotesque, a readable body with tabular
 * figures, a serif italic for emphasis, and a mono for data labels.
 * Self-hosted by next/font (no request to Google at runtime).
 */
export const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz', 'wdth'],
})

export const body = Inter_Tight({ subsets: ['latin'], variable: '--font-body', display: 'swap' })

export const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['italic'],
  variable: '--font-serif',
  display: 'swap',
})

export const mono = Geist_Mono({ subsets: ['latin'], weight: ['500'], variable: '--font-mono', display: 'swap' })

export const fontVariables = [display.variable, body.variable, serif.variable, mono.variable].join(' ')
