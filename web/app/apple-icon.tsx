import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** "Orbital ember" brand mark (same drawing as app/icon.svg). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B0D10' }}>
        <svg width="150" height="150" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="15" fill="#FF6A2B" opacity="0.18" />
          <ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(-28 32 32)" fill="none" stroke="#FF6A2B" strokeOpacity="0.6" strokeWidth="2.6" />
          <circle cx="32" cy="32" r="9" fill="#FDB022" />
          <circle cx="32" cy="32" r="5" fill="#FFF4C2" />
          <circle cx="54" cy="20.3" r="3.2" fill="#F3EEE6" />
        </svg>
      </div>
    ),
    size
  )
}
