/**
 * Colour-vision-deficiency-friendly ramps (matplotlib cividis / viridis / inferno, 10 samples)
 * and a blue-to-orange diverging scale for anomalies. Every chart also shows numbers on hover,
 * so colour is never the only channel.
 */
export const RAMPS = {
  cividis: ['#00204D', '#00336F', '#39486B', '#575C6D', '#707173', '#8A8779', '#A69D75', '#C4B56C', '#E4CF5B', '#FFEA46'],
  inferno: ['#000004', '#1B0C42', '#4B0C6B', '#781C6D', '#A52C60', '#CF4446', '#ED6925', '#FB9A06', '#F7D03C', '#FCFFA4'],
  viridis: ['#440154', '#482878', '#3E4A89', '#31688E', '#26828E', '#1F9E89', '#35B779', '#6DCD59', '#B4DE2C', '#FDE725'],
} as const
export type RampName = keyof typeof RAMPS

/** Below median: blue. At median: neutral warm grey. Above: orange. */
export const DIVERGING = ['#1D4E89', '#3F76B5', '#86A9D4', '#C3CCD6', '#57524C', '#E7B58C', '#E98B4B', '#D2611C', '#9E3F07']

const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const rgb2hex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

export function sample(stops: readonly string[], t: number) {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const a = hex2rgb(stops[i]!)
  const b = hex2rgb(stops[i + 1]!)
  const f = x - i
  return rgb2hex(a.map((v, k) => v + (b[k]! - v) * f))
}

/** Counts are heavy-tailed, so colour follows log1p(value) / log1p(max). */
export const countColor = (ramp: RampName, v: number, max: number) =>
  sample(RAMPS[ramp], max > 0 ? Math.log1p(Math.max(0, v)) / Math.log1p(max) : 0)

/** Percentile 0..100 to a diverging colour (neutral at 50). */
export const pctColor = (p: number) => sample(DIVERGING, p / 100)

export const rampGradient = (stops: readonly string[]) => `linear-gradient(90deg, ${stops.join(', ')})`
