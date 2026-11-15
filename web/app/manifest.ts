import type { MetadataRoute } from 'next'

import { site } from '@/lib/content'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${site.name}: ${site.tagline}`,
    short_name: site.name,
    description: site.seo.description,
    start_url: '/explore',
    display: 'standalone',
    background_color: '#0B0D10',
    theme_color: '#0B0D10',
    categories: ['science', 'education', 'utilities'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  }
}
