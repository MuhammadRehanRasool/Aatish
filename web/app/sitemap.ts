import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/content'
import { pakistan } from '@/lib/data'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(`${pakistan.data_extent.to}T00:00:00Z`)
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/explore`, lastModified, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/method`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/data`, lastModified, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/about`, lastModified, changeFrequency: 'yearly', priority: 0.5 },
  ]
}
