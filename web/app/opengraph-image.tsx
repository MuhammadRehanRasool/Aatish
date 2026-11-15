import { ImageResponse } from 'next/og'

import { MONTHS, fmt, pakistan } from '@/lib/data'
import { countColor } from '@/lib/ramps'

export const alt = 'Aatish, a cross-sensor MODIS and VIIRS fire harmonization engine: 26 years of satellite fire detections over Pakistan on one harmonized calendar'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  const months = pakistan.months
  const years = Array.from(new Set(months.map((m) => m.year))).sort((a, b) => a - b)
  const max = Math.max(...months.map((m) => m.value))
  const cell = 15
  const a = pakistan.anomaly
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0B0D10', color: '#f3eee6', padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1 }}>
          <div style={{ display: 'flex', fontSize: 22, color: '#8a8378', letterSpacing: 2 }}>NASA SPACE APPS 2026 · MODIS + VIIRS</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 92, fontWeight: 800, lineHeight: 0.95, letterSpacing: -3 }}>Aatish<span style={{ color: '#FF6A2B' }}>.</span></div>
            <div style={{ display: 'flex', fontSize: 34, marginTop: 24, color: '#c4bcb0', maxWidth: 560 }}>
              Cross-Sensor MODIS &amp; VIIRS Fire Harmonization Engine. Pakistan, 2000 to today.
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 24, color: '#FF6A2B' }}>
            {a && a.ratio ? `${MONTHS[a.month - 1]} 1–${a.window.split('-').pop()}, ${a.year}: ${a.ratio.toFixed(1)}× the median (provisional)` : `${fmt(months.length)} months`}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, justifyContent: 'center' }}>
          {years.map((y) => (
            <div key={y} style={{ display: 'flex', gap: 3 }}>
              {Array.from({ length: 12 }, (_, i) => {
                const m = months.find((x) => x.year === y && x.month === i + 1)
                return <div key={i} style={{ width: cell, height: cell * 0.98, borderRadius: 3, background: m ? countColor('cividis', m.value, max) : 'transparent' }} />
              })}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  )
}
