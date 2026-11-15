import type { Metadata } from 'next'

import { Explorer } from '@/components/explore/Explorer'
import { pakistan } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Fire map explorer',
  description:
    'Full-screen fire map of Pakistan since 2000: harmonized MODIS + VIIRS hotspots, a month-by-month timeline you can play, province anomaly maps, daily NASA satellite imagery, and CSV downloads for any area you draw.',
  alternates: { canonical: '/explore' },
}

export default function ExplorePage() {
  const end = pakistan.data_extent.to
  return <Explorer dataEnd={end.slice(0, 7)} dataEndDate={end} />
}
