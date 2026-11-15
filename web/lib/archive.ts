'use client'

/**
 * Resilient data access for the explorer: the live FastAPI when it answers, otherwise the offline archive in
 * /public/offline (written by web/scripts/export_offline.py from the API's own code path).
 * The page never shows an error just because the API is down; it switches to "Archive Mode".
 */
import { useSyncExternalStore } from 'react'

import { api, type CalendarResponse, type DailyResponse, type ForecastResponse, type GridResponse, type PointsResponse, type Query, type RegionStatsResponse } from './api'
import { API_URL } from './content'

/** In a production build without NEXT_PUBLIC_API_URL there is no API to call: go straight to the archive. */
export const API_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_API_URL) || process.env.NODE_ENV !== 'production'

export type ApiStatus = { mode: 'checking' | 'live' | 'archive'; ms: number | null }
const SERVER: ApiStatus = { mode: 'checking', ms: null }
let status: ApiStatus = SERVER
const subs = new Set<() => void>()
const setStatus = (s: ApiStatus) => {
  status = s
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

let probe: Promise<boolean> | null = null
/** One health check per page load (a refused connection is logged by the browser, so we do not poll). */
export function checkApi(force = false): Promise<boolean> {
  if (!API_CONFIGURED) {
    if (status.mode !== 'archive') setStatus({ mode: 'archive', ms: null })
    return Promise.resolve(false)
  }
  if (probe && !force) return probe
  if (force) setStatus({ mode: 'checking', ms: null })
  probe = (async () => {
    const ctl = new AbortController()
    const to = window.setTimeout(() => ctl.abort(), 3500)
    const t0 = performance.now()
    try {
      const r = await fetch(`${API_URL}/api/health`, { signal: ctl.signal, cache: 'no-store' })
      if (!r.ok) throw new Error(String(r.status))
      await r.json()
      setStatus({ mode: 'live', ms: Math.round(performance.now() - t0) })
      return true
    } catch {
      setStatus({ mode: 'archive', ms: null })
      return false
    } finally {
      window.clearTimeout(to)
    }
  })()
  return probe
}

export const useApiStatus = () => useSyncExternalStore(subscribe, () => status, () => SERVER)

/** Thrown when a view needs the live API (custom shapes, VIIRS units, static sources, older hotspot months). */
export class NeedsLive extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'NeedsLive'
  }
}

/* ------------------------------------------------------------------ archive files */
type Manifest = { data_extent: { from: string; to: string }; daily_months: string[]; point_months: Record<string, string[]> }
const cache = new Map<string, Promise<unknown>>()
function file<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined
  if (!p) {
    p = fetch(`/offline/${path}`).then((r) => {
      if (!r.ok) throw new NeedsLive('This view is not in the offline archive.')
      return r.json() as Promise<T>
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p
}
const manifest = () => file<Manifest>('manifest.json')

export const archiveSlug = (aoi: string) => (aoi === 'pakistan' ? 'pakistan' : /^region:PK-[A-Z]{2}$/.test(aoi) ? aoi.slice(7) : null)
/** Can this query be answered from the archive at all? */
export const archiveCovers = (q: Pick<Query, 'aoi' | 'static' | 'unit'>) => archiveSlug(q.aoi) !== null && !q.static && q.unit === 'modis'

function need(q: Pick<Query, 'aoi' | 'static' | 'unit'>) {
  if (archiveSlug(q.aoi) === null) throw new NeedsLive('Custom shapes need the Live API. In Archive Mode, pick Pakistan or a province.')
  if (q.static) throw new NeedsLive('Including static heat sources needs the Live API.')
  if (q.unit !== 'modis') throw new NeedsLive('VIIRS-equivalent units need the Live API.')
  return archiveSlug(q.aoi)!
}

const archive = {
  async calendar(q: Query): Promise<CalendarResponse> {
    const full = await file<CalendarResponse>(`calendar_${need(q)}.json`)
    const months = full.months.filter((m) => m.ym >= q.from && m.ym <= q.to)
    if (!months.length) throw new NeedsLive('No data in this date range.')
    if (months.length === full.months.length) return full
    const years = new Set(months.filter((m) => m.days_covered === m.days_in_month).map((m) => m.year))
    const sum = (k: 'value' | 'lo' | 'hi') => months.reduce((a, m) => a + m[k], 0)
    const yearly = full.stats.yearly.filter((y) => years.has(y.year) && months.filter((m) => m.year === y.year).length === 12)
    return {
      ...full,
      range: { from: `${months[0]!.ym}-01`, to: months[months.length - 1]!.ym === full.months[full.months.length - 1]!.ym ? full.range.to : `${months[months.length - 1]!.ym}-${String(months[months.length - 1]!.days_in_month).padStart(2, '0')}` },
      months,
      // Total and yearly follow the range; peak month, highest year and trend stay those of the full record.
      stats: { ...full.stats, total: sum('value'), total_lo: sum('lo'), total_hi: sum('hi'), yearly, complete_years: yearly.length },
    }
  },
  async grid(q: Query): Promise<GridResponse> {
    return file<GridResponse>(`grid_${need(q)}.json`)
  },
  async points(aoi: string, ym: string): Promise<PointsResponse> {
    const s = need({ aoi, static: false, unit: 'modis' })
    const m = await manifest()
    if (!m.point_months[aoi]?.includes(ym)) throw new NeedsLive('Hotspot dots for this month need the Live API.')
    return file<PointsResponse>(`points/${s}_${ym}.json`)
  },
  async daily(aoi: string, ym: string): Promise<DailyResponse> {
    const s = need({ aoi, static: false, unit: 'modis' })
    const m = await manifest()
    if (!m.daily_months.includes(ym)) throw new NeedsLive('Day-by-day values for this month need the Live API.')
    return file<DailyResponse>(`daily/${s}_${ym}.json`)
  },
  async regionStats(q: Query, ym: string | null): Promise<RegionStatsResponse> {
    if (q.static) throw new NeedsLive('Including static heat sources needs the Live API.')
    if (!ym) return file<RegionStatsResponse>('regions_range.json')
    const y = await file<Record<string, RegionStatsResponse>>(`regions_${ym.slice(0, 4)}.json`)
    const r = y[ym]
    if (!r) throw new NeedsLive('No province data for this month.')
    return r
  },
  async forecast(aoi: string, stat: boolean): Promise<ForecastResponse> {
    return file<ForecastResponse>(`forecast_${need({ aoi, static: stat, unit: 'modis' })}.json`)
  },
}

/** Live first; a network failure flips the page into Archive Mode and answers from the archive. */
async function either<T>(live: () => Promise<T>, offline: () => Promise<T>): Promise<T> {
  if (await checkApi()) {
    try {
      return await live()
    } catch (e) {
      if (e instanceof TypeError) {
        setStatus({ mode: 'archive', ms: null })
        return offline()
      }
      throw e
    }
  }
  return offline()
}

export const data = {
  calendar: (q: Query, signal?: AbortSignal) => either(() => api.calendar(q, signal), () => archive.calendar(q)),
  grid: (q: Query, signal?: AbortSignal) => either(() => api.grid(q, '0.1', signal), () => archive.grid(q)),
  points: (aoi: string, ym: string, stat: boolean, signal?: AbortSignal) =>
    either(() => api.points(aoi, ym, stat, signal), () => (stat ? Promise.reject(new NeedsLive('Static sources need the Live API.')) : archive.points(aoi, ym))),
  daily: (aoi: string, ym: string, stat: boolean, signal?: AbortSignal) =>
    either(() => api.daily(aoi, ym, stat, signal), () => (stat ? Promise.reject(new NeedsLive('Static sources need the Live API.')) : archive.daily(aoi, ym))),
  regionStats: (q: Query, ym: string | null, signal?: AbortSignal) => either(() => api.regionStats(q, ym, signal), () => archive.regionStats(q, ym)),
  forecast: (aoi: string, stat: boolean, signal?: AbortSignal) => either(() => api.forecast(aoi, stat, signal), () => archive.forecast(aoi, stat)),
}

/* ------------------------------------------------------------------ client-side CSV (works offline) */
export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function monthlyCsv(c: CalendarResponse) {
  const head = [
    `# Aatish monthly series · ${c.aoi.label} · ${c.unit_label}`,
    '# Source: NASA FIRMS (MODIS C6.1, VIIRS 375 m), harmonized by Aatish. Rows with provisional=true use NRT data.',
    'ym,value,lo,hi,role,provisional,days_covered,days_in_month,gap_days,pct',
  ]
  return [...head, ...c.months.map((m) => [m.ym, m.value, m.lo, m.hi, m.role, m.provisional, m.days_covered, m.days_in_month, m.gap_days, m.pct ?? ''].join(','))].join('\n')
}

export function pointsCsv(label: string, ym: string, pts: PointsResponse['points']) {
  const head = [
    `# Aatish hotspots · ${label} · ${ym} · series detections (static sources excluded)`,
    '# Source: NASA FIRMS. w_modis_eq = harmonized weight. nrt=true rows are provisional.',
    'lon,lat,w_modis_eq,satellite,nrt,date,hhmm_utc,frp_mw,night',
  ]
  return [...head, ...pts.map((p) => p.join(','))].join('\n')
}
