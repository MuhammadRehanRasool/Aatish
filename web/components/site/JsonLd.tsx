import { SITE_URL, site } from '@/lib/content'
import { calibration, pakistan } from '@/lib/data'

/** Site-wide structured data: the team, the website, the web app and the dataset it publishes. */
export function JsonLd() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#team`,
        name: `${site.team} (NASA Space Apps 2026, Karachi)`,
        url: site.teamUrl,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: site.name,
        description: site.seo.description,
        inLanguage: 'en',
        publisher: { '@id': `${SITE_URL}/#team` },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: site.name,
        url: `${SITE_URL}/explore`,
        applicationCategory: 'ScienceApplication',
        operatingSystem: 'Any (web browser)',
        browserRequirements: 'Requires JavaScript; the map needs WebGL',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
        description: site.seo.description,
        creator: { '@id': `${SITE_URL}/#team` },
      },
      {
        '@type': 'Dataset',
        '@id': `${SITE_URL}/#dataset`,
        name: 'Aatish harmonized MODIS + VIIRS monthly hotspot series, Pakistan',
        description: `Monthly satellite active-fire detection counts for Pakistan in ${calibration.unit}. MODIS Terra/Aqua (C6.1) and VIIRS 375 m (Suomi NPP, NOAA-20, NOAA-21) detections from NASA FIRMS, harmonized with a detection-probability weighting fitted on ${calibration.fit_window[0]} to ${calibration.fit_window[1]}. Includes 80% prediction bands and anomaly percentiles.`,
        url: `${SITE_URL}/data`,
        keywords: site.seo.keywords,
        isAccessibleForFree: true,
        creator: { '@id': `${SITE_URL}/#team` },
        temporalCoverage: `${pakistan.data_extent.from}/${pakistan.data_extent.to}`,
        spatialCoverage: {
          '@type': 'Place',
          name: 'Pakistan',
          geo: { '@type': 'GeoShape', box: '23.80 60.87 37.08 77.12' },
        },
        variableMeasured: [
          { '@type': 'PropertyValue', name: 'MODIS-equivalent hotspot detections per month', unitText: 'detections' },
          { '@type': 'PropertyValue', name: '80% prediction band (lower, upper)', unitText: 'detections' },
          { '@type': 'PropertyValue', name: 'Percentile versus the same month in other years', unitText: 'percent' },
        ],
        isBasedOn: [
          { '@type': 'Dataset', name: 'NASA FIRMS MODIS Collection 6.1 active fire detections', url: 'https://firms.modaps.eosdis.nasa.gov/' },
          { '@type': 'Dataset', name: 'NASA FIRMS VIIRS 375 m active fire detections (S-NPP, NOAA-20, NOAA-21)', url: 'https://firms.modaps.eosdis.nasa.gov/' },
        ],
        measurementTechnique:
          'Satellite thermal-anomaly detection; VIIRS-to-MODIS detection-probability weighting validated by leave-one-year-out cross-validation',
      },
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, '\\u003c') }} />
}
