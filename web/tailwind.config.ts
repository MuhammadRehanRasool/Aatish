import type { Config } from 'tailwindcss'

/**
 * Design tokens live as CSS variables in app/globals.css (and content/theme.json
 * for the accent). Tailwind only maps names onto them, so a colour changes in one place.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1440px',
    },
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--ink-2) / <alpha-value>)',
        mute: 'rgb(var(--mute) / <alpha-value>)',
        line: 'rgb(var(--ink) / 0.12)',
        'line-strong': 'rgb(var(--ink) / 0.24)',
        /** The accent colour. Set it in content/theme.json. */
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fixed': 'rgb(var(--accent-fixed) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        signal: 'rgb(var(--signal) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        'paper-ink': 'rgb(var(--paper-ink) / <alpha-value>)',
        'paper-mute': 'rgb(var(--paper-mute) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Display scale: fluid, tight, for headlines and giant numbers.
        mega: ['clamp(3.4rem, 12.5vw, 12.5rem)', { lineHeight: '0.84', letterSpacing: '-0.042em' }],
        d1: ['clamp(2.9rem, 8vw, 8rem)', { lineHeight: '0.9', letterSpacing: '-0.038em' }],
        d2: ['clamp(2.25rem, 5.4vw, 5.25rem)', { lineHeight: '0.95', letterSpacing: '-0.032em' }],
        d3: ['clamp(1.75rem, 3.2vw, 3rem)', { lineHeight: '0.98', letterSpacing: '-0.026em' }],
        d4: ['clamp(1.35rem, 2vw, 1.875rem)', { lineHeight: '1.08', letterSpacing: '-0.025em' }],
        num: ['clamp(3.75rem, 9vw, 8.5rem)', { lineHeight: '0.85', letterSpacing: '-0.045em' }],
        lede: ['clamp(1.125rem, 1.5vw, 1.375rem)', { lineHeight: '1.5', letterSpacing: '-0.01em' }],
        label: ['0.75rem', { lineHeight: '1.2', letterSpacing: '0.08em' }],
      },
      maxWidth: {
        page: '90rem',
        prose: '38rem',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        pop: 'cubic-bezier(0.2, 1.3, 0.3, 1)',
      },
      borderRadius: {
        frame: '1.25rem',
      },
    },
  },
  plugins: [],
}
export default config
