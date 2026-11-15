import { API_URL } from './content'
import type { Anomaly, PeakMonth, Trend, WorstYear } from './data'

export type ApiMonth = {
  ym: string
  year: number
  month: number
  value: number
  lo: number
  hi: number
  role: 'native' | 'terra_scaled' | 'derived' | 'mixed'
  provisional: boolean
  n_detections: number
  days_covered: number
  days_in_month: number
  gap_days: number
  notes: string[]
  baseline_n: number
  median: number | null
  pct: number | null
  ratio: number | null
  diff: number | null
}

export type CalendarResponse = {
  aoi: { key: string; label: string; coverage_pakistan: number; bounds: [number, number, number, number] }
  range: { from: string; to: string }
  data_extent: { from: string; to: string }
  unit: 'modis' | 'viirs'
  unit_label: string
  include_static: boolean
  months: ApiMonth[]
  stats: {
    total: number
    total_lo: number
    total_hi: number
    complete_years: number
    yearly: { year: number; value: number; lo: number; hi: number; provisional: boolean }[]
    worst_year?: WorstYear
    peak_month?: PeakMonth
    climatology?: { month: number; median: number }[]
    trend?: Trend | null
  }
  anomaly: (Anomaly & { series: { year: number; value: number }[] }) | null
}

/** [lon, lat, w_modis_eq, satellite, nrt, date, hhmm, frp_mw, night] */
export type ApiPoint = [number, number, number, string, boolean, string, number, number, boolean]
export type PointsResponse = { ym: string; n: number; truncated: boolean; points: ApiPoint[] }

export type GridResponse = { aoi: string; from: string; to: string; res: number; total: number; cells: [number, number, number, number][] }

export type RegionStat = {
  key: string
  label: string
  value: number
  share_pct?: number
  median?: number | null
  pct?: number | null
  ratio?: number | null
  rank?: number | null
  of?: number | null
}
export type RegionStatsResponse = {
  mode: 'month' | 'range'
  ym?: string
  window?: string
  partial?: boolean
  baseline_years?: [number, number] | null
  provisional?: boolean
  regions: RegionStat[]
}

export type DailyResponse = { ym: string; days: { date: string; day: number; night: number; no_data: boolean; future: boolean }[]; notes: string[] }

export type LiveResponse = {
  source: string
  from: string
  to: string
  count: number
  by_day: Record<string, number>
  points: [number, number, string, number, number, string, string][]
  truncated: boolean
  label: string
}

export type ForecastMonth = {
  ym: string
  h: number
  value: number
  lo: number
  hi: number
  typical_median_10y: number
  vs_typical_pct: number | null
  last_10_years: { year: number; value: number }[]
  observed_so_far?: { value: number; days: number; of: number; provisional: boolean }
}
type Skill = { skill_pct: number; ci90_pct: [number, number]; MAE_log: number; MdAPE_pct_y_ge_20: number; n: number }
export type ForecastResponse = {
  aoi: { key: string; label: string; coverage_pakistan: number }
  unit_label: string
  issued_from: string
  method: string
  months: ForecastMonth[]
  typical_year: { month: number; median: number; low_q10: number; high_q90: number; years: number }[]
  drivers: { last_month_vs_typical_pct: number; last_12_months_vs_typical_pct: number }
  skill: { country_h1: Skill; cell1_h1: Skill; country_h3: Skill; cell1_h3: Skill }
  coverage: Record<string, number>
  provisional: boolean
  notes: string[]
}

export type Query = { aoi: string; from: string; to: string; static: boolean; unit: 'modis' | 'viirs' }

const qs = (o: Record<string, string | boolean | number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

/** 'YYYY-MM' → first / last day of month. */
export const monthStart = (ym: string) => `${ym}-01`
export const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${ym}-${String(d).padStart(2, '0')}`
}

const params = (q: Query) => ({ aoi: q.aoi, from: monthStart(q.from), to: monthEnd(q.to), static: q.static, unit: q.unit })

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal })
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try {
      const j = await r.json()
      if (j?.detail) msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {}
    throw new Error(msg)
  }
  return r.json() as Promise<T>
}

export const api = {
  calendar: (q: Query, signal?: AbortSignal) => getJson<CalendarResponse>(`${API_URL}/api/calendar?${qs(params(q))}`, signal),
  points: (aoi: string, ym: string, stat: boolean, signal?: AbortSignal) =>
    getJson<PointsResponse>(`${API_URL}/api/points?${qs({ aoi, ym, static: stat })}`, signal),
  grid: (q: Query, res: string, signal?: AbortSignal) =>
    getJson<GridResponse>(`${API_URL}/api/grid?${qs({ aoi: q.aoi, from: monthStart(q.from), to: monthEnd(q.to), static: q.static, res })}`, signal),
  regionStats: (q: Query, ym: string | null, signal?: AbortSignal) =>
    getJson<RegionStatsResponse>(
      `${API_URL}/api/regions/stats?${qs(ym ? { ym, static: q.static } : { from: monthStart(q.from), to: monthEnd(q.to), static: q.static })}`,
      signal
    ),
  daily: (aoi: string, ym: string, stat: boolean, signal?: AbortSignal) =>
    getJson<DailyResponse>(`${API_URL}/api/daily?${qs({ aoi, ym, static: stat })}`, signal),
  live: (bbox: number[], days: number, source: string, signal?: AbortSignal) =>
    getJson<LiveResponse>(`${API_URL}/api/current?${qs({ bbox: bbox.map((x) => x.toFixed(3)).join(','), days, source })}`, signal),
  forecast: (aoi: string, stat: boolean, signal?: AbortSignal) =>
    getJson<ForecastResponse>(`${API_URL}/api/forecast?${qs({ aoi, static: stat })}`, signal),
  hotspotsCsv: (q: Query) => `${API_URL}/api/hotspots.csv?${qs({ aoi: q.aoi, from: monthStart(q.from), to: monthEnd(q.to), static: q.static })}`,
  monthlyCsv: (q: Query) => `${API_URL}/api/monthly.csv?${qs(params(q))}`,
}
