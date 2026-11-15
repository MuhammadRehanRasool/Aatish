'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api, type ApiPoint, type CalendarResponse, type DailyResponse, type ForecastResponse, type GridResponse, type LiveResponse, type Query, type RegionStatsResponse } from '@/lib/api'
import { NeedsLive, archiveCovers, data as source, downloadText, monthlyCsv, pointsCsv, useApiStatus } from '@/lib/archive'
import { setAskView } from '@/lib/askView'
import raw from '@/content/data/raw_counts_pakistan.json'
import { MONTHS, MONTHS_LONG, calibration, fmt, fmtDate, overlapPk, regionSummary } from '@/lib/data'
import { DIVERGING, RAMPS, pctColor, rampGradient, type RampName } from '@/lib/ramps'
import { cn } from '@/lib/utils'

import { AreaSelect } from './AreaSelect'
import { ForecastCard, askAssistant } from './ForecastCard'
import { StoryBar, type Chapter } from './StoryBar'
import { CalendarChart, DailyChart, SeasonClock, TimelineChart, YearChart, type ChartHandle } from './charts'
import { MapView, gibsLayer, type Camera, type DrawMode, type RegionPaint } from './MapView'
import { Fold, Glass, Icon, Seg, StatusPill, Svg, Toggle } from './ui'

const PRESETS = [
  { key: 'pakistan', label: 'Pakistan' },
  { key: 'region:PK-PB', label: 'Punjab' },
  { key: 'region:PK-SD', label: 'Sindh' },
  { key: 'region:PK-KP', label: 'Khyber Pakhtunkhwa' },
  { key: 'region:PK-BA', label: 'Balochistan' },
  { key: 'region:PK-GB', label: 'Gilgit-Baltistan' },
  { key: 'region:PK-JK', label: 'Azad Kashmir' },
  { key: 'region:PK-IS', label: 'Islamabad' },
]
const FIRST = '2000-11'
const ROLE_LABEL: Record<string, string> = { native: 'MODIS observed', terra_scaled: 'Terra scaled', derived: 'VIIRS-derived', mixed: 'Mixed sources' }
const PK_VIEW: Camera['center'] = [69.5, 30.2]
const PUNJAB_VIEW: Camera['center'] = [73.5, 31.2]

type Layers = { heat: boolean; provinces: boolean; imagery: boolean; live: boolean }
type Tab = 'insight' | 'outlook' | 'controls'
type Dock = 'timeline' | 'years' | 'calendar'
type State = Query & { label: string; ramp: RampName; view: 'count' | 'anomaly'; month: string | null; day: string | null; layers: Layers }

const labelFor = (aoi: string) =>
  PRESETS.find((x) => x.key === aoi)?.label ?? (aoi.startsWith('poly:') ? 'Drawn area' : aoi.startsWith('bbox:') ? 'Drawn box' : aoi.startsWith('circle:') ? 'Point and radius' : aoi)

function readUrl(dataEnd: string): State {
  const p = new URLSearchParams(window.location.search)
  const aoi = p.get('aoi') || 'pakistan'
  const ym = /^\d{4}-\d{2}$/
  const lay = p.get('layers')
  return {
    aoi,
    label: labelFor(aoi),
    from: ym.test(p.get('from') ?? '') ? p.get('from')! : FIRST,
    to: ym.test(p.get('to') ?? '') ? p.get('to')! : dataEnd,
    static: p.get('static') === '1',
    unit: p.get('unit') === 'viirs' ? 'viirs' : 'modis',
    ramp: (['cividis', 'inferno', 'viridis'] as const).find((r) => r === p.get('ramp')) ?? 'inferno',
    view: p.get('view') === 'count' ? 'count' : 'anomaly',
    month: ym.test(p.get('month') ?? '') ? p.get('month')! : null,
    day: /^\d{4}-\d{2}-\d{2}$/.test(p.get('day') ?? '') ? p.get('day')! : null,
    layers: lay ? { heat: lay.includes('h'), provinces: lay.includes('p'), imagery: lay.includes('i'), live: false } : { heat: true, provinces: true, imagery: false, live: false },
  }
}

function writeUrl(s: State, dataEnd: string) {
  const p = new URLSearchParams()
  if (s.aoi !== 'pakistan') p.set('aoi', s.aoi)
  if (s.from !== FIRST) p.set('from', s.from)
  if (s.to !== dataEnd) p.set('to', s.to)
  if (s.month) p.set('month', s.month)
  if (s.day) p.set('day', s.day)
  if (s.static) p.set('static', '1')
  if (s.unit !== 'modis') p.set('unit', s.unit)
  if (s.ramp !== 'inferno') p.set('ramp', s.ramp)
  if (s.view !== 'anomaly') p.set('view', s.view)
  const l = `${s.layers.heat ? 'h' : ''}${s.layers.provinces ? 'p' : ''}${s.layers.imagery ? 'i' : ''}`
  if (l !== 'hp') p.set('layers', l || '-')
  const q = p.toString()
  window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname)
}

const ymLabel = (ym: string) => `${MONTHS_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`
const ordinal = (n: number) => {
  const r = Math.round(n)
  const s = ['th', 'st', 'nd', 'rd'] as const
  const v = r % 100
  return `${r}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
const n0 = (v: number) => fmt(v, v < 10 ? 1 : 0)
/** Plain-English verdict for a percentile (vs the same month in other years). */
const verdict = (p: number) => (p >= 90 ? 'Much hotter than usual' : p >= 67 ? 'Hotter than usual' : p > 33 ? 'About usual' : p > 10 ? 'Quieter than usual' : 'Much quieter than usual')
const pad2 = (n: number) => String(n).padStart(2, '0')

/* ------------------------------------------------------------------ diverging percentile bar */
function PctBar({ pct }: { pct: number }) {
  return (
    <div>
      <div className="relative h-2.5 rounded-full" style={{ background: rampGradient(DIVERGING) }} role="img" aria-label={`${ordinal(pct)} percentile: ${verdict(pct).toLowerCase()}`}>
        <span className="absolute inset-y-[-3px] left-1/2 w-px bg-ink/50" aria-hidden="true" />
        <span className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-bg shadow-[0_0_16px_rgba(255,106,43,0.55)]" style={{ left: `${Math.min(97, Math.max(3, pct))}%`, background: pctColor(pct) }} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-mute">
        <span>← Quieter</span>
        <span>Usual</span>
        <span>Hotter →</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ main */
export function Explorer({ dataEnd, dataEndDate }: { dataEnd: string; dataEndDate: string }) {
  const status = useApiStatus()
  const archiveMode = status.mode === 'archive'
  const [s, setS] = useState<State | null>(null)
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<DrawMode>('none')
  const [grid, setGrid] = useState<GridResponse | null>(null)
  const [pts, setPts] = useState<{ key: string; n: number; truncated: boolean; points: ApiPoint[] } | null>(null)
  const [ptsMiss, setPtsMiss] = useState<{ key: string; msg: string } | null>(null)
  const [daily, setDaily] = useState<DailyResponse | null>(null)
  const [rstats, setRstats] = useState<RegionStatsResponse | null>(null)
  const [fcast, setFcast] = useState<ForecastResponse | null>(null)
  const [live, setLive] = useState<LiveResponse | null>(null)
  const [liveErr, setLiveErr] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [dock, setDock] = useState<Dock>('timeline')
  const [tab, setTab] = useState<Tab>('insight')
  const [layersOpen, setLayersOpen] = useState(false)
  const [circleOpen, setCircleOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [circle, setCircle] = useState({ lat: '31.52', lon: '74.36', km: '50' })
  const [camera, setCamera] = useState<Camera | null>(null)
  const [storyOpen, setStoryOpen] = useState(true)
  const [chapter, setChapter] = useState<number | null>(null)
  const [focus, setFocus] = useState<{ from: string; to: string; label: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const chartRef = useRef<ChartHandle>(null)
  const ptsCache = useRef(new Map<string, { n: number; truncated: boolean; points: ApiPoint[] }>())

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the URL once on the client
    setS(readUrl(dataEnd))
  }, [dataEnd])

  const update = useCallback((patch: Partial<State>) => setS((prev) => (prev ? { ...prev, ...patch } : prev)), [])
  const setLayer = useCallback((k: keyof Layers, v: boolean) => setS((p) => (p ? { ...p, layers: { ...p.layers, [k]: v } } : p)), [])
  const selectMonth = useCallback((ym: string | null) => setS((p) => (p ? { ...p, month: ym, day: null } : p)), [])

  useEffect(() => {
    if (s) writeUrl(s, dataEnd)
  }, [s, dataEnd])

  // In Archive Mode, fall back to what the archive can answer instead of showing a dead end.
  useEffect(() => {
    if (!s || !archiveMode || archiveCovers(s)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the API going away
    setNotice(
      !archiveCovers({ ...s, static: false, unit: 'modis' })
        ? `"${s.label}" needs the Live API, so the map is back on Pakistan. Pick a province, or start the API to analyse your own shape.`
        : 'VIIRS units and static heat sources need the Live API, so the default view is shown.'
    )
    setS((p) => (p ? { ...p, ...(archiveCovers({ ...p, static: false, unit: 'modis' }) ? {} : { aoi: 'pakistan', label: 'Pakistan' }), static: false, unit: 'modis' } : p))
  }, [archiveMode, s])

  const qKey = s ? `${s.aoi}|${s.from}|${s.to}|${s.static}|${s.unit}` : ''

  // ---- calendar (monthly series, stats, current-month anomaly)
  useEffect(() => {
    if (!s) return
    const ctl = new AbortController()
    const t = window.setTimeout(async () => {
      setLoading('Loading calendar…')
      try {
        const r = await source.calendar(s, ctl.signal)
        if (!ctl.signal.aborted) setData(r)
      } catch (e) {
        if (ctl.signal.aborted) return
        if (e instanceof NeedsLive) setNotice(e.message)
        else setNotice(`${e instanceof Error ? e.message : 'That request did not work'}.${s.aoi.startsWith('poly:') ? ' Try a simpler polygon.' : ''}`)
      } finally {
        if (!ctl.signal.aborted) setLoading(null)
      }
    }, 120)
    return () => {
      ctl.abort()
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qKey])

  // ---- density grid for the whole range (map overview)
  useEffect(() => {
    if (!s) return
    const ctl = new AbortController()
    source
      .grid(s, ctl.signal)
      .then((g) => !ctl.signal.aborted && setGrid(g))
      .catch(() => {})
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.aoi, s?.from, s?.to, s?.static])

  // ---- hotspots of the selected month (cached; next month prefetched for playback)
  const month = s?.month ?? null
  useEffect(() => {
    if (!s || !month) return
    const key = `${s.aoi}|${s.static}|${month}`
    const fetchPts = (ym: string, signal?: AbortSignal) => {
      const k = `${s.aoi}|${s.static}|${ym}`
      const hit = ptsCache.current.get(k)
      if (hit) return Promise.resolve(hit)
      return source.points(s.aoi, ym, s.static, signal).then((r) => {
        const v = { n: r.n, truncated: r.truncated, points: r.points }
        ptsCache.current.set(k, v)
        if (ptsCache.current.size > 60) ptsCache.current.delete(ptsCache.current.keys().next().value!)
        return v
      })
    }
    const ctl = new AbortController()
    const hit = ptsCache.current.get(key)
    if (hit) setPts({ key, ...hit })
    else setLoading(`Loading ${ymLabel(month)} hotspots…`)
    fetchPts(month, ctl.signal)
      .then((v) => {
        if (ctl.signal.aborted) return
        setPts({ key, ...v })
        setLoading(null)
        const i = data?.months.findIndex((m) => m.ym === month) ?? -1
        const nxt = i >= 0 ? data?.months[i + 1]?.ym : undefined
        if (nxt && !archiveMode) fetchPts(nxt).catch(() => {})
      })
      .catch((e) => {
        if (ctl.signal.aborted) return
        setLoading(null)
        setPtsMiss({ key, msg: e instanceof NeedsLive ? e.message : 'Hotspots for this month could not be loaded.' })
      })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, s?.aoi, s?.static])

  // ---- daily bars for the selected month
  useEffect(() => {
    if (!s || !month) return
    const ctl = new AbortController()
    source
      .daily(s.aoi, month, s.static, ctl.signal)
      .then((d) => !ctl.signal.aborted && setDaily(d))
      .catch(() => !ctl.signal.aborted && setDaily(null))
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, s?.aoi, s?.static])

  // ---- forecast for the next 1-3 months (PERS)
  useEffect(() => {
    if (!s) return
    const ctl = new AbortController()
    source
      .forecast(s.aoi, s.static, ctl.signal)
      .then((f) => !ctl.signal.aborted && setFcast(f))
      .catch(() => !ctl.signal.aborted && setFcast(null))
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.aoi, s?.static])

  // ---- tell the assistant what is on screen
  useEffect(() => {
    if (s) setAskView({ aoi: s.aoi, aoi_label: data?.aoi.label ?? s.label, ym: s.month, page: 'explore' })
    return () => setAskView({})
  }, [s, data?.aoi.label])

  // ---- province stats (choropleth + leaderboard)
  useEffect(() => {
    if (!s) return
    const ctl = new AbortController()
    source
      .regionStats(s, month, ctl.signal)
      .then((r) => !ctl.signal.aborted && setRstats(r))
      .catch(() => !ctl.signal.aborted && setRstats(null))
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, s?.from, s?.to, s?.static])

  // ---- playback through the months
  useEffect(() => {
    if (!playing || !data) return
    const id = window.setInterval(() => {
      setS((p) => {
        if (!p) return p
        const i = p.month ? data.months.findIndex((m) => m.ym === p.month) : -1
        const nxt = data.months[i + 1]
        if (!nxt) {
          setPlaying(false)
          return p
        }
        return { ...p, month: nxt.ym, day: null }
      })
    }, 1100)
    return () => window.clearInterval(id)
  }, [playing, data])

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!data) return
      setS((p) => {
        if (!p) return p
        const i = p.month ? data.months.findIndex((m) => m.ym === p.month) : dir === 1 ? -1 : data.months.length
        const nxt = data.months[i + dir]
        return nxt ? { ...p, month: nxt.ym, day: null } : p
      })
    },
    [data]
  )

  // keyboard: ← → step months, space play/pause, Esc back to the overview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (mode !== 'none' || t.closest('input, select, textarea, [contenteditable]')) return
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === ' ' && !t.closest('button')) {
        e.preventDefault()
        setPlaying((v) => !v)
      } else if (e.key === 'Escape') {
        setPlaying(false)
        selectMonth(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, mode, selectMonth])

  const curAoi = s?.aoi
  const onAoi = useCallback(
    (key: string, label?: string) => {
      if (key === curAoi) return
      if (archiveMode && !archiveCovers({ aoi: key, static: false, unit: 'modis' })) {
        setNotice('Drawing your own shape needs the Live API. In Archive Mode, click Pakistan or any province.')
        return
      }
      setNotice(null)
      setPts(null)
      setLive(null)
      setLiveErr(null)
      setDaily(null)
      setFcast(null)
      update({ aoi: key, label: label ?? labelFor(key), day: null })
    },
    [curAoi, update, archiveMode]
  )

  // live FIRMS layer
  const liveOn = s?.layers.live ?? false
  const bboxKey = data?.aoi.bounds.join(',')
  useEffect(() => {
    if (!liveOn || !data) return
    if (archiveMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the live layer needs the API
      setLiveErr('Needs the Live API')
      return
    }
    const ctl = new AbortController()
    api
      .live(data.aoi.bounds, 10, 'VIIRS_NOAA20_NRT', ctl.signal)
      .then((r) => {
        setLive(r)
        setLiveErr(null)
      })
      .catch((e) => !ctl.signal.aborted && setLiveErr(e instanceof Error ? 'Unavailable right now' : 'Live request failed'))
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOn, bboxKey, archiveMode])

  const unitShort = data?.unit === 'viirs' ? 'VIIRS-eq' : 'MODIS-eq'
  const selMonth = useMemo(() => (data && month ? (data.months.find((m) => m.ym === month) ?? null) : null), [data, month])
  const peakDay = useMemo(() => {
    if (!daily) return null
    const obs = daily.days.filter((d) => !d.future)
    if (!obs.length) return null
    return obs.reduce((a, b) => (b.day + b.night > a.day + a.night ? b : a)).date
  }, [daily])
  const imageryDate = s?.layers.imagery ? (s.day ?? (month && daily?.ym === month ? peakDay : null) ?? dataEndDate) : null

  const provincesOn = s?.layers.provinces ?? false
  const regionPaint = useMemo<RegionPaint | null>(() => {
    if (!rstats) return null
    const out: RegionPaint = {}
    for (const r of rstats.regions) {
      if (rstats.mode === 'month') {
        const color = r.pct == null ? '#57524C' : pctColor(r.pct)
        out[r.key] = {
          color: provincesOn && r.pct != null ? color : '',
          html: `${ymLabel(rstats.ym!)}${rstats.partial ? ` (days ${rstats.window!.slice(3, 5)}–${rstats.window!.slice(-2)})` : ''}: <b>${n0(r.value)}</b> hotspots${r.pct != null ? `<br/><b>${r.ratio ? `${r.ratio.toFixed(2)}× usual` : verdict(r.pct)}</b> · higher than ${Math.round(r.pct)}% of years` : '<br/>Too few earlier years to compare'}`,
        }
      } else {
        out[r.key] = { color: '', html: `<b>${fmt(r.value)}</b> hotspots in range · ${r.share_pct}% of Pakistan` }
      }
    }
    return out
  }, [rstats, provincesOn])

  const downloadPng = () => {
    const url = chartRef.current?.png()
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `aatish_${(data?.aoi.label ?? 'calendar').replace(/\W+/g, '_')}.png`
    a.click()
  }

  /* ---------------------------------------------------------- guided story (numbers from the bundled data) */
  const pkA = regionSummary['pakistan']?.anomaly
  const pbA = regionSummary['region:PK-PB']?.anomaly
  const v = calibration.validation.loyo_merged.country_month
  const seam = overlapPk.months.filter((m) => m.ym >= '2022-10' && m.ym <= '2022-12' && m.modis_observed > 0).map((m) => (m.viirs_derived / m.modis_observed).toFixed(2))
  const spikeYm = pkA?.year && pkA.month ? `${pkA.year}-${pad2(pkA.month)}` : dataEnd
  const spikeDays = pkA?.window ? Number(pkA.window.split('-').pop()) : null
  const rawYear = (y: number) => raw.years.find((r) => r.year === y)
  const raw2011 = rawYear(2011)
  const raw2012 = rawYear(2012)
  const rawJump = raw2011 && raw2012 && raw2011.raw_total > 0 ? raw2012.raw_total / raw2011.raw_total : null
  const yearsSpan = Number(dataEnd.slice(0, 4)) - Number(FIRST.slice(0, 4))
  const chapters: Chapter[] = [
    {
      short: 'The 2012 sensor trap',
      title: rawJump ? `Raw counts jumped ${rawJump.toFixed(1)}× in 2012. The fires did not.` : 'The 2012 sensor trap',
      lead: 'When the satellites changed, the numbers changed. Not the fires.',
      body: (
        <>
          Sharper VIIRS satellites joined MODIS in 2012. Add every satellite together and Pakistan goes from <b className="text-ink">{raw2011 ? fmt(raw2011.raw_total) : '—'}</b> hotspots in 2011 to{' '}
          <b className="text-ink">{raw2012 ? fmt(raw2012.raw_total) : '—'}</b> in 2012. Aatish gives every VIIRS detection a weight, so the series reads in <b className="text-ink">MODIS-equivalent hotspots</b> (counted the way MODIS would see them). The
          highlighted span on the timeline is where VIIRS takes over from the drifting MODIS satellites, in October 2022.
        </>
      ),
      stats: [
        { k: 'detections unified', v: fmt(calibration.rows_total) },
        { k: 'median monthly error, held-out years', v: `${v.MdAPE}%` },
        { k: `Oct–Dec 2022 hand-off, VIIRS ÷ MODIS`, v: seam.join(' / ') || '—' },
      ],
      footnote: 'Raw = every detection passing the confidence filter, static heat sources removed, all satellites added together (complete years only).',
    },
    {
      short: 'Harvest & smoke',
      title: `Harvest & smoke: ${MONTHS_LONG[(pbA?.month ?? 11) - 1]} ${pbA?.year ?? ''} in Punjab is ${pbA?.ratio ? `${pbA.ratio.toFixed(2)}× usual` : 'above usual'}`,
      lead: `Aatish puts ${yearsSpan} years of orbits on one scale, so this season can be held against every season since ${FIRST.slice(0, 4)}.`,
      body: (
        <>
          In the first {spikeDays ?? '—'} days of {MONTHS_LONG[(pbA?.month ?? 11) - 1]}, Punjab logged <b className="text-ink">{pbA?.value != null ? n0(pbA.value) : '—'}</b> MODIS-equivalent hotspots, against a usual{' '}
          <b className="text-ink">{pbA?.median != null ? n0(pbA.median) : '—'}</b> for the same days in {pbA?.baseline_years?.[0]}–{pbA?.baseline_years?.[1]}. That is higher than {pbA?.pct != null ? Math.round(pbA.pct) : '—'}% of past years. The map now shows this month&apos;s hotspots, with each province coloured by how unusual it is.
        </>
      ),
      stats: [
        { k: 'Punjab, MODIS-eq so far', v: pbA?.value != null ? n0(pbA.value) : '—' },
        { k: 'usual for the same days', v: pbA?.median != null ? n0(pbA.median) : '—' },
        { k: `rank among ${pbA?.of ?? '—'} years`, v: pbA?.rank != null ? `#${pbA.rank}` : '—' },
      ],
      footnote: (
        <>
          Provisional: these days come from near-real-time (NRT) data. General background (not from our satellite data): November is the rice-stubble burning season in Punjab, and its smoke adds to the winter smog over Lahore.
        </>
      ),
    },
    {
      short: 'Draw your own area',
      title: 'Draw your own area',
      lead: `Your fields, your district, your city: ${yearsSpan} years of fire history.`,
      body: (
        <>Click any province, or open <b className="text-ink">Area Tools</b> on the map to draw a polygon or a box, or drop a pin with a radius. The calendar, the &quot;vs usual&quot; card, the forecast and every download update for that area.</>
      ),
      stats: [],
      actions: (
        <>
          <button type="button" disabled={archiveMode} onClick={() => setMode('polygon')} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-35">
            <Svg d={Icon.poly} /> Draw polygon
          </button>
          <button type="button" disabled={archiveMode} onClick={() => setMode('rect')} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-35">
            <Svg d={Icon.box} /> Draw box
          </button>
          <button type="button" disabled={archiveMode} onClick={() => onAoi('circle:74.36,31.52,50', '50 km around Lahore')} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-35">
            <Svg d={Icon.pin} /> 50 km around Lahore
          </button>
          <button type="button" onClick={() => onAoi('region:PK-SD', 'Sindh')} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-white/15 px-4 text-sm font-semibold hover:border-accent hover:text-accent">
            Try Sindh
          </button>
        </>
      ),
      footnote: archiveMode ? 'Archive Mode: drawing and pins need the Live API. Province clicks work everywhere.' : 'Polygon: click to add points, double-click to finish. Box: press and drag. Esc cancels.',
    },
  ]

  const goChapter = (i: number | null) => {
    setChapter(i)
    setPlaying(false)
    if (i === null) {
      setFocus(null)
      return
    }
    setTab('insight')
    if (i === 0) {
      setS((p) => (p ? { ...p, aoi: 'pakistan', label: 'Pakistan', month: null, day: null, from: FIRST, to: dataEnd, layers: { ...p.layers, heat: true } } : p))
      setDock('timeline')
      setFocus({ from: '2022-10', to: dataEnd, label: 'VIIRS takes over' })
      setCamera({ center: PK_VIEW, zoom: 4.7, nonce: Date.now() })
    } else if (i === 1) {
      setS((p) => (p ? { ...p, aoi: 'region:PK-PB', label: 'Punjab', month: spikeYm, day: null, from: FIRST, to: dataEnd, layers: { ...p.layers, heat: true, provinces: true } } : p))
      setDock('timeline')
      setFocus(null)
      setCamera({ center: PUNJAB_VIEW, zoom: 6.3, nonce: Date.now() })
    } else {
      setS((p) => (p ? { ...p, aoi: 'pakistan', label: 'Pakistan', month: null, day: null } : p))
      setFocus(null)
      setCamera({ center: PK_VIEW, zoom: 4.9, nonce: Date.now() })
    }
    setNotice(null)
  }

  if (!s) return <div className="h-[100dvh] bg-bg" aria-busy="true" />

  const st = data?.stats
  const an = data?.anomaly
  const anYm = an ? `${an.year}-${pad2(an.month)}` : null
  const monthPts = pts && pts.key === `${s.aoi}|${s.static}|${month}` ? pts : null
  const ptsMissing = !monthPts && ptsMiss && ptsMiss.key === `${s.aoi}|${s.static}|${month}` ? ptsMiss.msg : null
  const dayCount = s.day && monthPts ? monthPts.points.filter((p) => p[5] === s.day).length : null
  const sortedRegions = rstats ? [...rstats.regions].sort((a, b) => (rstats.mode === 'month' ? (b.pct ?? -1) - (a.pct ?? -1) : b.value - a.value)) : []
  const regionMax = Math.max(1, ...sortedRegions.map((r) => r.value))
  const fullRange = s.from === FIRST && s.to === dataEnd
  const showGrid = s.layers.heat && grid && (!month || (!monthPts && ptsMissing))
  const span = `${FIRST.slice(0, 4)}–${dataEnd.slice(0, 4)}`

  const layerControls = (
    <>
      <Toggle on={s.layers.heat} onChange={(val) => setLayer('heat', val)} label="Fire hotspots" hint={month ? 'Heat → dots as you zoom; click a dot' : 'Density over the date range'} swatch={<span className="h-3 w-3 rounded-full bg-gradient-to-br from-[#FDB022] to-[#B3260E]" />} />
      <Toggle on={s.layers.provinces} onChange={(val) => setLayer('provinces', val)} label="Province anomaly" hint={month ? 'Coloured by how unusual the month is' : 'Pick a month to colour provinces'} swatch={<span className="h-3 w-3 rounded-sm" style={{ background: rampGradient(DIVERGING) }} />} />
      <Toggle on={s.layers.imagery} onChange={(val) => setLayer('imagery', val)} label="NASA satellite image" hint={imageryDate ? `${gibsLayer(imageryDate).label}, ${fmtDate(imageryDate)}` : 'GIBS true colour for the chosen day'} swatch={<span className="h-3 w-3 rounded-sm bg-gradient-to-br from-[#6b8f5a] to-[#c9b48a]" />} />
      <Toggle on={s.layers.live} onChange={(val) => setLayer('live', val)} disabled={archiveMode} label="Live FIRMS · last 10 days" hint={archiveMode ? 'Needs the Live API' : liveErr ? liveErr : live ? `${fmt(live.count)} raw NRT detections` : 'Raw NOAA-20 NRT, not harmonized'} swatch={<span className="h-3 w-3 rounded-full bg-signal" />} />
    </>
  )

  const legend =
    month && s.layers.provinces ? (
      <>
        <div className="h-1.5 rounded-full" style={{ background: rampGradient(DIVERGING) }} />
        <div className="mt-1 flex justify-between text-xs text-mute">
          <span>Quieter than usual</span>
          <span>Hotter</span>
        </div>
      </>
    ) : (
      <>
        <div className="h-1.5 rounded-full" style={{ background: 'linear-gradient(90deg,#7a1d0c,#F05A1A,#FDB022,#FFF4C2)' }} />
        <div className="mt-1 flex justify-between text-xs text-mute">
          <span>Few</span>
          <span>Many hotspots</span>
        </div>
      </>
    )

  /* ---------------------------------------------------------- Insight: hero anomaly card */
  const soFar = an && (!selMonth || selMonth.ym === anYm) ? an : null
  const hero = soFar ? (
    <Glass active>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-accent">
          <span className="relative h-1.5 w-1.5 rounded-full bg-accent">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/70" />
          </span>
          {MONTHS_LONG[soFar.month - 1]} 1–{Number(soFar.window.split('-').pop())}, {soFar.year} · so far
        </p>
        <span className="rounded-full border border-accent/40 px-2 py-0.5 text-sm font-semibold text-accent">provisional</span>
      </div>
      <p className="mt-3 font-display text-[2.9rem] font-bold leading-none tracking-tight tabular-nums">
        {soFar.ratio ? (
          <>
            {soFar.ratio.toFixed(2)}× <span className="em text-[2.2rem] font-normal text-accent">usual</span>
          </>
        ) : (
          <>
            {soFar.diff > 0 ? '+' : ''}
            {fmt(soFar.diff, 1)} <span className="em text-[2.2rem] font-normal text-accent">vs usual</span>
          </>
        )}
      </p>
      <p className="mt-2 text-sm font-semibold text-ink">
        {n0(soFar.value)} hotspots · higher than {Math.round(soFar.pct)}% of past {MONTHS_LONG[soFar.month - 1]}s
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">
        {verdict(soFar.pct)} for {data?.aoi.label}: the usual for these same days ({soFar.baseline_years[0]}–{soFar.baseline_years[1]}) is {n0(soFar.median)}. Ranked #{soFar.rank} of {soFar.of} years.
      </p>
      <div className="mt-4">
        <PctBar pct={soFar.pct} />
      </div>
      <p className="mt-3 text-sm text-mute">
        80% likely range {n0(soFar.lo)}–{n0(soFar.hi)} {unitShort} <span className="text-ink-2">(counted the way MODIS would see them)</span>
      </p>
      {selMonth?.ym !== anYm && (
        <button type="button" onClick={() => selectMonth(anYm)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-full bg-accent px-4 text-xs font-bold text-on-accent hover:bg-ink hover:text-bg">
          Show this month on the map →
        </button>
      )}
    </Glass>
  ) : selMonth ? (
    <Glass active>
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-accent">
          {ymLabel(selMonth.ym)} · {ROLE_LABEL[selMonth.role] ?? selMonth.role}
        </p>
        {selMonth.provisional && <span className="rounded-full border border-accent/40 px-2 py-0.5 text-sm font-semibold text-accent">provisional</span>}
      </div>
      <p className="mt-3 font-display text-[2.9rem] font-bold leading-none tracking-tight tabular-nums">
        {selMonth.ratio ? (
          <>
            {selMonth.ratio.toFixed(2)}× <span className="em text-[2.2rem] font-normal text-accent">usual</span>
          </>
        ) : (
          <>
            {n0(selMonth.value)} <span className="em text-[2.2rem] font-normal text-accent">hotspots</span>
          </>
        )}
      </p>
      <p className="mt-2 text-sm font-semibold">
        {n0(selMonth.value)} hotspots{selMonth.pct !== null ? ` · higher than ${Math.round(selMonth.pct)}% of ${MONTHS_LONG[selMonth.month - 1]}s` : ''}
      </p>
      {selMonth.pct !== null ? (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {verdict(selMonth.pct)} for {data?.aoi.label}
            {selMonth.median !== null ? `: a usual ${MONTHS_LONG[selMonth.month - 1]} has ${n0(selMonth.median)}.` : '.'}
          </p>
          <div className="mt-4">
            <PctBar pct={selMonth.pct} />
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-mute">{selMonth.days_covered < selMonth.days_in_month ? `Partial month (${selMonth.days_covered} of ${selMonth.days_in_month} days), so it is not ranked yet.` : 'Not enough complete years to compare this month.'}</p>
      )}
      <p className="mt-3 text-sm text-mute">{selMonth.role !== 'native' ? `80% likely range ${n0(selMonth.lo)}–${n0(selMonth.hi)} ${unitShort}` : 'Observed directly by MODIS (no model range needed)'}</p>
      {(selMonth.gap_days > 0 || selMonth.notes.length > 0) && (
        <ul className="mt-2 space-y-1 text-sm text-ink-2">
          {selMonth.gap_days > 0 && <li className="text-[#E9B44C]">{selMonth.gap_days} day(s) without satellite data</li>}
          {selMonth.notes.slice(0, 2).map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
    </Glass>
  ) : st ? (
    <Glass active>
      <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-accent">{data?.aoi.label} · {fmtDate(data!.range.from)} → {fmtDate(data!.range.to)}</p>
      <p className="mt-3 font-display text-[2.9rem] font-bold leading-none tracking-tight tabular-nums">{fmt(st.total)}</p>
      <p className="mt-2 text-sm font-semibold">{unitShort} hotspots in this range</p>
      <p className="mt-1 text-sm text-mute">Pick a month on the timeline below to see how it compares with usual.</p>
    </Glass>
  ) : null

  /* ---------------------------------------------------------- tabs */
  const insightTab = (
    <div className="space-y-4">
      {hero ?? <div className="h-48 animate-pulse rounded-2xl bg-white/[0.04]" />}

      {month && daily && daily.ym === month && (
        <Glass
          title="Day by day"
          aside={
            s.day ? (
              <button type="button" onClick={() => update({ day: null })} className="text-sm font-semibold text-accent hover:underline">
                {fmtDate(s.day)} · whole month
              </button>
            ) : (
              <span className="flex items-center gap-2 text-sm text-mute">
                <i className="h-2 w-2 rounded-sm bg-[#F05A1A]" /> day <i className="h-2 w-2 rounded-sm bg-signal" /> night
              </span>
            )
          }
        >
          <DailyChart days={daily.days} selected={s.day} onSelect={(d) => update({ day: d, layers: d ? { ...s.layers, imagery: true } : s.layers })} />
          <p className="mt-1 text-sm text-mute">Click a day: only its hotspots, over that day&apos;s NASA satellite image.</p>
        </Glass>
      )}

      {sortedRegions.length > 0 && (
        <Fold title={rstats?.mode === 'month' ? `Province comparison · ${ymLabel(rstats.ym!)} vs usual` : 'Province comparison · share of hotspots'}>
          <ul className="space-y-0.5">
            {sortedRegions.map((r, i) => (
              <li key={r.key}>
                <button type="button" onClick={() => onAoi(r.key, r.label)} className={cn('group w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/5', s.aoi === r.key && 'bg-white/[0.07] ring-1 ring-accent/40')}>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono text-[0.6875rem] text-mute">{pad2(i + 1)}</span>
                      <span className="truncate font-semibold">{r.label.replace(' Capital Territory', '')}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-2">
                      {n0(r.value)}
                      {rstats?.mode === 'month' ? (
                        r.ratio ? <b className="ml-2 text-ink">{r.ratio.toFixed(1)}×</b> : r.pct != null ? <b className="ml-2 text-ink">{ordinal(r.pct)} pct</b> : <span className="ml-2 text-mute">n/a</span>
                      ) : (
                        <b className="ml-2 text-ink">{r.share_pct}%</b>
                      )}
                    </span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(1.5, rstats?.mode === 'month' ? (r.pct ?? 0) : (r.value / regionMax) * 100)}%`, background: rstats?.mode === 'month' && r.pct != null ? pctColor(r.pct) : '#F05A1A' }} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-mute">
            {rstats?.mode === 'month' && rstats.baseline_years
              ? `Bar = how unusual (percentile vs the same ${rstats.partial ? 'days' : 'month'} in ${rstats.baseline_years[0]}–${rstats.baseline_years[1]})${rstats.provisional ? ' · provisional' : ''}. Click to fly there.`
              : `${archiveMode && !fullRange ? 'Whole record (Archive Mode)' : 'Selected date range'}. Click a province to fly there.`}
          </p>
        </Fold>
      )}
    </div>
  )

  const outlookTab = (
    <div className="space-y-4">
      {fcast && fcast.aoi.key === s.aoi && fcast.aoi.coverage_pakistan > 0.5 ? (
        <ForecastCard f={fcast} />
      ) : (
        <Glass title="Next 3 months">
          <p className="text-sm text-ink-2">{data && data.aoi.coverage_pakistan <= 0.5 ? 'Forecasts need an area that is mostly inside Pakistan.' : 'Loading the forecast…'}</p>
        </Glass>
      )}
      {st?.climatology && (
        <Glass title="12-month fire clock · typical year">
          <div className="grid grid-cols-[9.5rem_1fr] items-center gap-3">
            <SeasonClock clim={st.climatology} highlight={selMonth?.month ?? st.peak_month?.month ?? null} />
            <p className="text-sm leading-relaxed text-ink-2">
              The usual (median) number of hotspots in each calendar month.{' '}
              {st.peak_month && (
                <>
                  <b className="text-ink">{MONTHS_LONG[st.peak_month.month - 1]}</b> is the peak, {st.peak_month.share_pct}% of a typical year.
                </>
              )}
            </p>
          </div>
        </Glass>
      )}
      {st && (
        <Fold title={`Key numbers · ${data?.aoi.label}`}>
          <div className="grid grid-cols-2 gap-2">
            {[
              { k: 'Total', v: fmt(st.total), n: `${unitShort} · 80% range ${fmt(st.total_lo)}–${fmt(st.total_hi)}` },
              { k: 'Peak month', v: st.peak_month ? MONTHS_LONG[st.peak_month.month - 1]! : '—', n: st.peak_month ? `${st.peak_month.share_pct ?? '—'}% of a typical year` : undefined },
              {
                k: 'Highest year',
                v: st.worst_year ? String(st.worst_year.year) : '—',
                n: st.worst_year ? (st.worst_year.clear ? 'Clearly above the next year' : `Among the highest (${st.worst_year.runner_up} is within range)`) : 'Needs a full year',
              },
              {
                k: 'Trend',
                v: st.trend ? `${st.trend.pct_per_year > 0 ? '+' : ''}${st.trend.pct_per_year}%/yr` : '—',
                n: st.trend ? (st.trend.claim ? `Significant, ${st.trend.years[0]}–${st.trend.years[1]}` : 'Within uncertainty: no trend claimed') : 'Needs 8+ complete years',
              },
            ].map((x) => (
              <div key={x.k} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-mute">{x.k}</p>
                {x.k === 'Highest year' && st.worst_year ? (
                  <button type="button" className="mt-1 font-display text-xl font-bold tabular-nums leading-tight hover:text-accent" onClick={() => selectMonth(`${st.worst_year!.year}-${pad2(st.peak_month?.month ?? 11)}`)} title="Show that year's peak month">
                    {x.v}
                  </button>
                ) : (
                  <p className="mt-1 font-display text-xl font-bold tabular-nums leading-tight">{x.v}</p>
                )}
                {x.n && <p className="mt-1 text-sm leading-snug text-ink-2">{x.n}</p>}
              </div>
            ))}
          </div>
          {archiveMode && !fullRange && <p className="mt-2 text-sm text-mute">Archive Mode: total follows your dates; peak month, highest year and trend describe the whole record.</p>}
        </Fold>
      )}
    </div>
  )

  const presets = [
    { l: `All years ${span}`, f: FIRST, t: dataEnd },
    { l: 'Last 5 years', f: `${Number(dataEnd.slice(0, 4)) - 5}-${dataEnd.slice(5)}`, t: dataEnd },
    { l: 'VIIRS era (Oct 2022+)', f: '2022-10', t: dataEnd },
  ]
  const hotspotsHref = !archiveMode ? api.hotspotsCsv(month ? { ...s, from: month, to: month } : s) : null
  const btn = 'flex min-h-11 items-center gap-2.5 rounded-xl border border-white/15 px-3 text-left text-sm font-bold transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-40'
  const controlsTab = (
    <div className="space-y-4">
      <Glass title="Date range">
        <div className="flex flex-wrap gap-1.5">
          {presets.map((r) => (
            <button key={r.l} type="button" onClick={() => update({ from: r.f, to: r.t, month: null, day: null })} className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', s.from === r.f && s.to === r.t ? 'border-accent bg-accent/10 text-accent' : 'border-white/15 text-ink-2 hover:border-ink')}>
              {r.l}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-mute">From</span>
            <input type="month" min={FIRST} max={s.to} value={s.from} onChange={(e) => e.target.value && update({ from: e.target.value, month: null, day: null })} className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-black/30 px-2 text-sm outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-mute">To</span>
            <input type="month" min={s.from} max={dataEnd} value={s.to} onChange={(e) => e.target.value && update({ to: e.target.value, month: null, day: null })} className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-black/30 px-2 text-sm outline-none focus:border-accent" />
          </label>
        </div>
      </Glass>

      <Glass title="Display">
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-semibold">Units</p>
            <Seg
              label="Units"
              value={s.unit}
              onChange={(u) => update({ unit: u })}
              options={[
                { v: 'modis', l: 'MODIS-eq' },
                { v: 'viirs', l: 'VIIRS-eq', disabled: archiveMode, title: archiveMode ? 'Needs the Live API' : undefined },
              ]}
            />
            <p className="mt-1 text-sm text-mute">MODIS-eq: the long-record scale (default). VIIRS-eq: the same series in sharper-sensor units.</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Colour ramp · colour-blind safe</p>
            <Seg label="Colour ramp" value={s.ramp} onChange={(r) => update({ ramp: r })} options={[{ v: 'inferno', l: 'Inferno' }, { v: 'cividis', l: 'Cividis' }, { v: 'viridis', l: 'Viridis' }]} />
            <span aria-hidden="true" className="mt-2 block h-1.5 rounded-full" style={{ background: rampGradient(RAMPS[s.ramp]) }} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Static industrial sources</p>
            <Seg
              label="Static industrial sources"
              value={s.static ? 'on' : 'off'}
              onChange={(x) => update({ static: x === 'on' })}
              options={[
                { v: 'off', l: 'Hidden (open burning)' },
                { v: 'on', l: 'Include kilns & flares', disabled: archiveMode, title: archiveMode ? 'Needs the Live API' : undefined },
              ]}
            />
          </div>
        </div>
      </Glass>

      <div className="lg:hidden">
        <Glass title="Map layers">{layerControls}</Glass>
      </div>

      <Glass title="Take the data">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
          {hotspotsHref ? (
            <a href={hotspotsHref} download className={cn(btn, 'border-transparent bg-accent text-on-accent hover:bg-ink hover:text-bg')}>
              <Svg d={Icon.download} /> Download Hotspots CSV{month ? ` · ${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : ' · whole range'}
            </a>
          ) : (
            <button
              type="button"
              disabled={!monthPts}
              title={monthPts ? undefined : 'In Archive Mode, pick one of the recent months to export its hotspots'}
              onClick={() => monthPts && month && downloadText(`aatish_hotspots_${s.label.replace(/\W+/g, '_')}_${month}.csv`, pointsCsv(s.label, month, monthPts.points))}
              className={cn(btn, 'border-transparent bg-accent text-on-accent hover:bg-ink hover:text-bg')}
            >
              <Svg d={Icon.download} /> Download Hotspots CSV{month ? ` · ${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : ' · pick a recent month'}
            </button>
          )}
          {!archiveMode ? (
            <a href={api.monthlyCsv(s)} download className={btn}>
              <Svg d={Icon.download} /> Monthly Series CSV
            </a>
          ) : (
            <button type="button" disabled={!data} onClick={() => data && downloadText(`aatish_monthly_${data.aoi.label.replace(/\W+/g, '_')}.csv`, monthlyCsv(data))} className={btn}>
              <Svg d={Icon.download} /> Monthly Series CSV
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDock('calendar')
              window.setTimeout(downloadPng, 450)
            }}
            className={btn}
          >
            <Svg d={Icon.image} /> Export Calendar PNG
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href).then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1800)
              })
            }}
            className={btn}
          >
            <Svg d={Icon.link} /> {copied ? 'Link copied ✓' : 'Copy Shareable Link'}
          </button>
        </div>
        <p className="mt-2 text-sm text-mute">Every view is a link: area, dates, month, day and layers live in the URL.</p>
      </Glass>

      <p className="px-1 pb-1 text-sm leading-relaxed text-mute">
        Keys: <kbd>←</kbd> <kbd>→</kbd> step months · <kbd>Space</kbd> play · <kbd>Esc</kbd> overview. NRT data is provisional.
      </p>
    </div>
  )

  return (
    <div className="relative bg-bg pt-16 lg:h-[100dvh] lg:min-h-[700px] lg:overflow-hidden">
      <h1 className="sr-only">Explore Aatish: harmonized MODIS and VIIRS hotspots for Pakistan</h1>

      {/* ============================================================ MAP */}
      <div className="relative h-[60dvh] min-h-[380px] lg:absolute lg:inset-x-0 lg:bottom-[14.25rem] lg:top-16 lg:h-auto">
        <MapView
          aoiKey={s.aoi}
          mode={mode}
          onModeChange={setMode}
          onAoi={onAoi}
          grid={showGrid ? grid.cells : null}
          points={s.layers.heat && month && monthPts ? monthPts.points : null}
          dayFilter={s.day}
          livePoints={s.layers.live && live && !archiveMode ? live.points : null}
          regionPaint={regionPaint}
          imageryDate={imageryDate}
          camera={camera}
        />

        {/* guided story: top centre of the map area */}
        <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex justify-center lg:left-[444px] lg:right-44 lg:top-3">
          <StoryBar
            chapters={chapters}
            active={chapter}
            open={storyOpen}
            onOpen={(o) => {
              setStoryOpen(o)
              if (!o) goChapter(null)
            }}
            onChapter={goChapter}
          />
        </div>

        {/* map tools: Layers (desktop) + Area Tools */}
        <div className="absolute right-3 top-16 z-20 flex flex-col items-end gap-2 lg:top-3">
          <div className="flex flex-col items-end max-lg:hidden">
            <button type="button" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} className={cn('glass flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold', layersOpen && 'border-accent/60')}>
              <Svg d={Icon.layers} className="text-accent" /> Layers
              <span className="flex -space-x-1" aria-hidden="true">
                {s.layers.heat && <i className="h-2 w-2 rounded-full bg-[#F05A1A] ring-1 ring-bg" />}
                {s.layers.provinces && <i className="h-2 w-2 rounded-full bg-[#86A9D4] ring-1 ring-bg" />}
                {s.layers.imagery && <i className="h-2 w-2 rounded-full bg-[#6b8f5a] ring-1 ring-bg" />}
                {s.layers.live && <i className="h-2 w-2 rounded-full bg-signal ring-1 ring-bg" />}
              </span>
            </button>
            {layersOpen && (
              <div className="glass mt-2 w-72 rounded-2xl p-2">
                {layerControls}
                <div className="mt-1 border-t border-white/10 px-2 pb-1 pt-2">{legend}</div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={() => setToolsOpen((o) => !o)}
              aria-expanded={toolsOpen}
              aria-controls="area-tools"
              className={cn('glass flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold', (toolsOpen || mode !== 'none') && 'border-accent/60 text-accent')}
            >
              <Svg d={Icon.tools} className="text-accent" /> Area Tools
            </button>
            {toolsOpen && (
              <div id="area-tools" className="glass w-72 rounded-2xl p-3">
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { m: 'polygon' as const, icon: Icon.poly, l: 'Polygon', t: 'Draw a polygon' },
                      { m: 'rect' as const, icon: Icon.box, l: 'Box', t: 'Draw a box' },
                    ] as const
                  ).map((b) => (
                    <button
                      key={b.m}
                      type="button"
                      title={archiveMode ? `${b.t} (needs the Live API)` : b.t}
                      disabled={archiveMode}
                      aria-pressed={mode === b.m}
                      onClick={() => {
                        setCircleOpen(false)
                        setMode(mode === b.m ? 'none' : b.m)
                        if (mode !== b.m) setToolsOpen(false)
                      }}
                      className={cn('flex flex-col items-center gap-1 rounded-xl border py-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-35', mode === b.m ? 'border-accent bg-accent/10 text-accent' : 'border-white/10 hover:border-ink')}
                    >
                      <Svg d={b.icon} className="h-5 w-5" />
                      {b.l}
                    </button>
                  ))}
                  <button
                    type="button"
                    title={archiveMode ? 'Point + radius (needs the Live API)' : 'Point + radius'}
                    disabled={archiveMode}
                    aria-expanded={circleOpen}
                    onClick={() => setCircleOpen((o) => !o)}
                    className={cn('flex flex-col items-center gap-1 rounded-xl border py-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-35', circleOpen ? 'border-accent bg-accent/10 text-accent' : 'border-white/10 hover:border-ink')}
                  >
                    <Svg d={Icon.pin} className="h-5 w-5" />
                    Radius
                  </button>
                </div>
                {circleOpen && !archiveMode && (
                  <form
                    className="mt-3 grid grid-cols-[1fr_1fr_0.8fr_auto] items-end gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const lat = Number(circle.lat),
                        lon = Number(circle.lon),
                        km = Number(circle.km)
                      if (Number.isFinite(lat) && Number.isFinite(lon) && km > 0 && km <= 500) {
                        onAoi(`circle:${lon},${lat},${km}`, `${km} km around ${lat}, ${lon}`)
                        setToolsOpen(false)
                      }
                    }}
                  >
                    {(['lat', 'lon', 'km'] as const).map((k) => (
                      <label key={k} className="block">
                        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-mute">{k === 'km' ? 'Km' : k === 'lat' ? 'Lat' : 'Lon'}</span>
                        <input inputMode="decimal" value={circle[k]} onChange={(e) => setCircle((c) => ({ ...c, [k]: e.target.value }))} className="mt-0.5 h-9 w-full rounded-lg border border-white/15 bg-black/30 px-2 text-sm tabular-nums outline-none focus:border-accent" />
                      </label>
                    ))}
                    <button type="submit" className="h-9 rounded-lg bg-ink px-3 text-xs font-bold text-bg hover:bg-accent">
                      Go
                    </button>
                  </form>
                )}
                <p className="mt-3 text-xs leading-relaxed text-mute">{archiveMode ? 'Archive Mode: drawing needs the Live API. Click any province instead.' : 'Polygon: click to add points, double-click to finish. Box: press and drag. Esc cancels.'}</p>
              </div>
            )}
          </div>
        </div>

        {/* on the map: what is shown + legend (bottom left of the map area) */}
        <div className="absolute bottom-3 left-3 z-10 max-w-[19rem] lg:left-[444px]">
          <div className="glass rounded-xl px-3 py-2">
            <p className="flex items-center gap-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-mute">
              On the map {loading && <span className="normal-case tracking-normal text-accent">· {loading}</span>}
            </p>
            <p className="text-[0.82rem] font-semibold">
              {month && monthPts ? (
                <>
                  {s.day ? fmtDate(s.day) : ymLabel(month)} · {fmt(dayCount ?? monthPts.n)} satellite detections
                  {monthPts.truncated && !s.day ? ' (heaviest 40k)' : ''}
                </>
              ) : month && ptsMissing ? (
                <>{ymLabel(month)} · density of the whole record</>
              ) : grid ? (
                <>
                  All hotspots {grid.from.slice(0, 4)}–{grid.to.slice(0, 4)} · density
                </>
              ) : (
                'Loading…'
              )}
            </p>
            {month && ptsMissing && <p className="text-xs text-mute">{ptsMissing}</p>}
            {!month && <p className="text-xs text-ink-2">Click a month on the timeline below, or press ▶</p>}
            {s.layers.heat && <div className="mt-1.5">{legend}</div>}
          </div>
        </div>
      </div>

      {/* ============================================================ DOCK */}
      <div className="z-20 border-y border-white/10 bg-raised lg:glass lg:absolute lg:bottom-3 lg:left-3 lg:right-3 lg:h-[13.25rem] lg:rounded-2xl lg:border">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => step(-1)} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 hover:border-ink" aria-label="Previous month">
              <Svg d={Icon.prev} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (!playing && !month && data) selectMonth(data.months[Math.max(0, data.months.length - 36)]!.ym)
                setPlaying((x) => !x)
              }}
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-on-accent shadow-[0_0_20px_rgba(255,106,43,0.4)] hover:bg-ink hover:text-bg"
              aria-label={playing ? 'Pause' : 'Play month by month'}
            >
              <Svg d={playing ? Icon.pause : Icon.play} />
            </button>
            <button type="button" onClick={() => step(1)} className="grid h-8 w-8 place-items-center rounded-full border border-white/15 hover:border-ink" aria-label="Next month">
              <Svg d={Icon.next} />
            </button>
          </div>
          <p className="min-w-[8.5rem] font-display text-sm font-bold tabular-nums">{month ? ymLabel(month) : 'All months'}</p>
          {month && (
            <button
              type="button"
              onClick={() => {
                setPlaying(false)
                selectMonth(null)
              }}
              className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-ink-2 hover:border-ink hover:text-ink"
            >
              Overview
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Seg
              label="Bottom panel"
              size="sm"
              value={dock}
              onChange={setDock}
              options={[
                { v: 'timeline', l: 'Timeline' },
                { v: 'years', l: 'Yearly trend' },
                { v: 'calendar', l: 'Full Calendar Grid' },
              ]}
            />
            <Seg label="Colour by" size="sm" value={s.view} onChange={(x) => update({ view: x })} options={[{ v: 'anomaly', l: 'vs usual' }, { v: 'count', l: 'Count' }]} />
          </div>
        </div>
        <div className="h-48 lg:h-[calc(100%-3.1rem)]">
          {data ? (
            dock === 'timeline' ? (
              <TimelineChart
                data={data}
                ramp={s.ramp}
                view={s.view}
                selected={month}
                focus={focus}
                onSelect={(ym) => {
                  setPlaying(false)
                  selectMonth(ym === month ? null : ym)
                }}
              />
            ) : dock === 'calendar' ? (
              <div className="h-full px-1">
                <CalendarChart
                  ref={chartRef}
                  data={data}
                  ramp={s.ramp}
                  view={s.view}
                  vertical={false}
                  fill
                  selected={month}
                  onSelect={(ym) => {
                    setPlaying(false)
                    selectMonth(ym)
                  }}
                />
              </div>
            ) : st && st.yearly.length > 1 ? (
              <div className="h-full overflow-hidden px-2 [&>div]:!h-full">
                <YearChart yearly={st.yearly} unitShort={unitShort} />
              </div>
            ) : (
              <p className="grid h-full place-items-center text-sm text-mute">Needs at least two complete years in the range.</p>
            )
          ) : (
            <div className="h-full animate-pulse bg-white/[0.03]" />
          )}
        </div>
      </div>

      {/* ============================================================ LEFT HUD PANEL */}
      <aside className="z-20 flex flex-col p-3 lg:glass lg:absolute lg:bottom-[15rem] lg:left-3 lg:top-[4.75rem] lg:w-[420px] lg:rounded-2xl lg:p-0" aria-label="Analysis">
        {/* area selector (pinned) */}
        <div className="space-y-2 lg:border-b lg:border-white/10 lg:p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-mute">Area</p>
            <StatusPill span={span} />
          </div>
          <div className="flex items-center gap-1.5">
            <AreaSelect
              options={PRESETS}
              value={s.aoi}
              customLabel={data?.aoi.label ?? s.label}
              onChange={(k) => onAoi(k, labelFor(k))}
            />
          </div>
          <p className="text-sm text-mute">{archiveMode ? 'Click a province on the map or pick one above.' : 'Click a province on the map, or use Area Tools to draw your own.'}</p>
          {notice && (
            <div className="flex items-start gap-2 rounded-xl border border-[#E9B44C]/30 bg-[#E9B44C]/[0.07] px-3 py-2 text-sm text-ink-2" role="status">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E9B44C]" />
              <span className="flex-1">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="text-mute hover:text-ink" aria-label="Dismiss">
                <Svg d={Icon.close} className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {data && data.aoi.coverage_pakistan < 0.999 && (
            <p className="rounded-xl border border-white/10 px-3 py-2 text-sm text-ink-2">
              {Math.round(data.aoi.coverage_pakistan * 100)}% of this area is in Pakistan; the harmonized history covers Pakistan only. Turn on <b>Live FIRMS</b> for raw detections elsewhere.
            </p>
          )}
        </div>

        {/* tabs */}
        <div role="tablist" aria-label="Analysis views" className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-white/10 bg-black/25 p-1 lg:mx-3">
          {(
            [
              { v: 'insight', l: 'Insight' },
              { v: 'outlook', l: 'Outlook' },
              { v: 'controls', l: 'Controls' },
            ] as const
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              role="tab"
              id={`tab-${t.v}`}
              aria-selected={tab === t.v}
              aria-controls={`panel-${t.v}`}
              onClick={() => setTab(t.v)}
              className={cn('min-h-8 rounded-full px-2 text-sm font-bold transition-colors', tab === t.v ? 'bg-accent text-on-accent shadow-[0_0_18px_rgba(255,106,43,0.35)]' : 'text-ink-2 hover:text-ink')}
            >
              {t.l}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} key={tab} aria-labelledby={`tab-${tab}`} className="mt-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:px-3 lg:pb-3" data-lenis-prevent>
          {tab === 'insight' ? insightTab : tab === 'outlook' ? outlookTab : controlsTab}
          {tab !== 'controls' && (
            <button type="button" onClick={() => askAssistant(`Explain what I am looking at: ${data?.aoi.label ?? 'Pakistan'}${month ? `, ${ymLabel(month)}` : ''}. Is it unusual?`)} className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 text-sm font-bold text-ink-2 hover:border-accent hover:text-accent">
              ✦ Ask AI to explain this view
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}
