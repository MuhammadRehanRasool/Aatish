import type { NextConfig } from 'next'

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const isDev = process.env.NODE_ENV !== 'production'

// Third parties this site really talks to: the Aatish API, OpenFreeMap (basemap style, tiles, glyphs, sprites)
// and NASA GIBS (daily true-colour satellite imagery tiles on the explorer map).
const GIBS = 'https://gibs.earthdata.nasa.gov'
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://tiles.openfreemap.org ${GIBS}`,
  "font-src 'self' data:",
  `connect-src 'self' ${API} https://tiles.openfreemap.org ${GIBS}${isDev ? ' ws: http://localhost:*' : ''}`,
  "worker-src 'self' blob:",
  "child-src blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ')

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactStrictMode: true,
  poweredByHeader: false,
  compiler: { removeConsole: process.env.NODE_ENV === 'production' },
  experimental: { optimizePackageImports: ['echarts', 'three'] },
  images: { formats: ['image/avif', 'image/webp'] },
  // Browsers ask for /favicon.ico on pages without a <link rel="icon"> (e.g. /llms.txt); serve the app icon.
  async rewrites() {
    return [{ source: '/favicon.ico', destination: '/icon.svg' }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
    ]
  },
}

export default nextConfig
