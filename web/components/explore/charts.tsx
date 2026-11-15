'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'

import type { ApiMonth, CalendarResponse } from '@/lib/api'
import { MONTHS, fmt } from '@/lib/data'
import { countColor, pctColor, type RampName } from '@/lib/ramps'

type ECharts = import('echarts/core').EChartsType
type Opt = Record<string, unknown>

/** echarts is ~300 kB, so only the pieces in use are loaded, on demand. */
let loader: Promise<typeof import('echarts/core')> | null = null
function loadECharts() {
  loader ??= Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ]).then(([core, charts, comps, renderers]) => {
    core.use([
      charts.BarChart,
      charts.LineChart,
      charts.CustomChart,
      comps.PolarComponent,
      comps.DataZoomInsideComponent,
      comps.MarkAreaComponent,
      comps.GridComponent,
      comps.TooltipComponent,
      comps.MarkLineComponent,
      comps.AriaComponent,
      renderers.CanvasRenderer,
    ])
    return core
  })
  return loader
}

const INK = '#f3eee6'
const MUTE = '#8a8378'
const LINE = 'rgba(243,238,230,0.12)'
const BG = '#0B0D10'
const FONT = 'var(--font-body), system-ui, sans-serif'
const tooltipBase = {
  backgroundColor: 'rgba(14,17,22,0.94)',
  borderColor: 'rgba(255,255,255,0.12)',
  textStyle: { color: INK, fontFamily: 'system-ui, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:12px;box-shadow:0 12px 40px -12px rgba(0,0,0,.7);max-width:320px;white-space:normal;',
}

export type ChartHandle = { png: () => string | null }

export function useChart(option: Opt | null, onClick?: (p: { data: unknown }) => void, onGridClick?: (index: number) => void) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<ECharts | null>(null)
  const click = useRef(onClick)
  const gridClick = useRef(onGridClick)
  const latest = useRef(option)
  useEffect(() => {
    click.current = onClick
    gridClick.current = onGridClick
  }, [onClick, onGridClick])

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | null = null
    loadECharts().then((core) => {
      if (disposed || !el.current) return
      const c = core.init(el.current, undefined, { renderer: 'canvas' })
      chart.current = c
      c.on('click', (p) => click.current?.(p as { data: unknown }))
      // a click anywhere in a bar's column (thin bars are hard to hit)
      c.getZr().on('click', (e) => {
        if (!gridClick.current) return
        const px = [e.offsetX, e.offsetY]
        if (!c.containPixel('grid', px)) return
        const ix = Math.round((c.convertFromPixel({ seriesIndex: 0 }, px) as number[])[0]!)
        if (Number.isFinite(ix)) gridClick.current(ix)
      })
      c.getZr().on('mousemove', (e) => {
        if (gridClick.current) c.getZr().setCursorStyle(c.containPixel('grid', [e.offsetX, e.offsetY]) ? 'pointer' : 'default')
      })
      ro = new ResizeObserver(() => c.resize())
      ro.observe(el.current)
      // the newest option, not the one captured at mount (data can arrive before echarts finishes loading)
      if (latest.current) c.setOption(latest.current, true)
    })
    return () => {
      disposed = true
      ro?.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    latest.current = option
    if (chart.current && option) chart.current.setOption(option, true)
  }, [option])

  return { el, chart }
}

const ROLE: Record<string, string> = {
  native: 'MODIS observed (Terra + Aqua)',
  terra_scaled: 'Terra only, scaled to Terra + Aqua (wider band)',
  derived: 'VIIRS-derived MODIS-equivalent',
  mixed: 'Mixed sources this month',
}

export function monthTooltip(m: ApiMonth, unitShort: string) {
  const rows = [
    `<b style="font-size:13px">${MONTHS[m.month - 1]} ${m.year}</b>`,
    `<span style="font-size:18px;font-weight:700">${fmt(m.value, m.value < 10 ? 1 : 0)}</span> ${unitShort}`,
    m.role !== 'native' ? `80% band ${fmt(m.lo, m.lo < 10 ? 1 : 0)}–${fmt(m.hi, m.hi < 10 ? 1 : 0)}` : 'Observed directly (no model band)',
    ROLE[m.role] ?? m.role,
    m.ratio ? `<b style="color:${m.ratio >= 1 ? '#FF9A5C' : '#8FB4FF'}">${m.ratio >= 1 ? '+' : '−'}${Math.abs(Math.round((m.ratio - 1) * 100))}% vs usual</b> (usual ${fmt(m.median ?? 0)})` : m.diff !== null && m.diff !== undefined && m.median !== null ? `<b>${m.diff > 0 ? '+' : ''}${fmt(m.diff, 1)} vs usual</b> (usual ${fmt(m.median ?? 0, 1)})` : '',
    m.pct !== null ? `Higher than ${Math.round(m.pct)}% of other ${MONTHS[m.month - 1]}s` : '',
    m.provisional ? '<span style="color:#FF6A2B">Provisional (NRT)</span>' : '',
    m.days_covered < m.days_in_month ? `Partial month: ${m.days_covered} of ${m.days_in_month} days in range` : '',
    m.gap_days ? `<span style="color:#FF6A2B">${m.gap_days} day(s) with no satellite data</span>` : '',
    ...m.notes.slice(0, 2).map((n) => `<span style="color:${MUTE}">${n}</span>`),
  ]
  return rows.filter(Boolean).join('<br/>')
}

export const CalendarChart = forwardRef<
  ChartHandle,
  { data: CalendarResponse; ramp: RampName; view: 'count' | 'anomaly'; vertical: boolean; selected: string | null; onSelect: (ym: string) => void; fill?: boolean }
>(function CalendarChart({ data, ramp, view, vertical, selected, onSelect, fill }, ref) {
  const years = useMemo(() => Array.from(new Set(data.months.map((m) => m.year))).sort((a, b) => a - b), [data])
  const option = useMemo<Opt>(() => {
  const max = Math.max(1, ...data.months.map((m) => m.value))
  const unitShort = data.unit === 'modis' ? 'MODIS-eq' : 'VIIRS-eq'
  const items = data.months.map((m) => {
    const yi = years.indexOf(m.year)
    const color = view === 'count' ? countColor(ramp, m.value, max) : m.pct === null ? '#2a2724' : pctColor(m.pct)
    const partial = m.days_covered < m.days_in_month || m.gap_days > 0
    const sel = m.ym === selected
    return {
      value: vertical ? [m.month - 1, yi, m.value] : [yi, m.month - 1, m.value],
      ym: m.ym,
      m,
      fill: color,
      stroke: sel ? INK : m.provisional || partial ? 'rgba(243,238,230,0.75)' : null,
      lineWidth: sel ? 2.5 : 1.5,
      dashed: m.provisional && !sel,
    }
  })
  type Item = (typeof items)[number]
  // A custom series rather than 'heatmap': ECharts' heatmap requires a visualMap (it throws in dev builds),
  // and a visualMap would override the per-cell colours, dashed NRT outlines and selection ring drawn here.
  const renderItem = (
    params: { dataIndex: number },
    api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }
  ) => {
    const it = items[params.dataIndex] as Item | undefined
    if (!it) return null
    const [cx, cy] = api.coord([api.value(0), api.value(1)]) as [number, number]
    const [cw, ch] = api.size([1, 1]) as [number, number]
    const gap = 2
    return {
      type: 'rect',
      shape: { x: cx - cw / 2 + gap / 2, y: cy - ch / 2 + gap / 2, width: Math.max(1, cw - gap), height: Math.max(1, ch - gap), r: 3 },
      style: { fill: it.fill, stroke: it.stroke, lineWidth: it.stroke ? it.lineWidth : 0, lineDash: it.dashed ? [3, 2] : null },
      emphasis: { style: { stroke: INK, lineWidth: 2, lineDash: null } },
    }
  }
  const yearAxis = { type: 'category', data: years.map(String), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: MUTE, fontFamily: FONT, fontSize: 11, interval: vertical ? 0 : 'auto' }, splitLine: { show: false } }
  const monthAxis = { type: 'category', data: MONTHS, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: MUTE, fontFamily: FONT, fontSize: 11 }, splitLine: { show: false } }
  return {
    animation: false,
    aria: { enabled: true, label: { description: `Calendar heatmap of ${unitShort} hotspot counts, ${years[0]} to ${years[years.length - 1]}, for ${data.aoi.label}.` } },
    grid: vertical ? { left: 44, right: 8, top: 24, bottom: 8 } : { left: 36, right: 8, top: 8, bottom: 22 },
    xAxis: vertical ? { ...monthAxis, position: 'top' } : yearAxis,
    yAxis: vertical ? { ...yearAxis, inverse: true } : { ...monthAxis, inverse: true },
    tooltip: { ...tooltipBase, formatter: (p: { data: { m: ApiMonth } }) => monthTooltip(p.data.m, unitShort) + '<br/><span style="color:#8a8378">Click to map this month</span>' },
    series: [{ type: 'custom', data: items, renderItem, encode: { x: 0, y: 1, tooltip: 2 }, progressive: 0 }],
  }
  }, [data, ramp, view, vertical, selected, years])
  const { el, chart } = useChart(option, (p) => {
    const d = p.data as { ym?: string }
    if (d?.ym) onSelect(d.ym)
  })
  useImperativeHandle(ref, () => ({ png: () => chart.current?.getDataURL({ pixelRatio: 2, backgroundColor: BG, type: 'png' }) ?? null }), [chart])
  return <div ref={el} style={fill ? undefined : { height: vertical ? Math.max(420, years.length * 22 + 40) : 360 }} className={fill ? 'h-full w-full' : 'w-full'} />
})

export function WindowChart({ data }: { data: NonNullable<CalendarResponse['anomaly']> }) {
  const option = useMemo<Opt>(() => {
  const rows = [...data.series, { year: data.year, value: data.value }]
  return {
    animation: false,
    grid: { left: 44, right: 12, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: rows.map((r) => String(r.year)), axisLabel: { color: MUTE, fontSize: 10 }, axisLine: { lineStyle: { color: LINE } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: MUTE, fontSize: 10 }, splitLine: { lineStyle: { color: LINE } } },
    tooltip: { ...tooltipBase, trigger: 'axis', valueFormatter: (v: number) => fmt(v, v < 10 ? 1 : 0) },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.year === data.year ? '#FF6A2B' : 'rgba(243,238,230,0.28)', borderRadius: [3, 3, 0, 0] } })),
        markLine: {
          symbol: 'none',
          silent: true,
          label: { color: INK, formatter: `median ${fmt(data.median, data.median < 10 ? 1 : 0)}`, position: 'insideEndTop', fontSize: 11 },
          lineStyle: { color: '#8FB4FF', type: 'dashed', width: 1.5 },
          data: [{ yAxis: data.median }],
        },
      },
    ],
  }
  }, [data])
  const { el } = useChart(option)
  return <div ref={el} className="h-56 w-full" />
}

export function YearChart({ yearly, unitShort }: { yearly: CalendarResponse['stats']['yearly']; unitShort: string }) {
  const option = useMemo<Opt>(() => ({
    animation: false,
    grid: { left: 52, right: 12, top: 16, bottom: 28 },
    xAxis: { type: 'category', data: yearly.map((y) => String(y.year)), axisLabel: { color: MUTE, fontSize: 10 }, axisLine: { lineStyle: { color: LINE } }, axisTick: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: MUTE, fontSize: 10 }, splitLine: { lineStyle: { color: LINE } } },
    tooltip: {
      ...tooltipBase,
      trigger: 'axis',
      formatter: (ps: { dataIndex: number }[]) => {
        const y = yearly[ps[0]!.dataIndex]!
        return `<b>${y.year}</b><br/>${fmt(y.value)} ${unitShort}<br/>80% band ${fmt(y.lo)}–${fmt(y.hi)}${y.provisional ? '<br/>includes provisional months' : ''}`
      },
    },
    series: [
      { type: 'bar', data: yearly.map((y) => y.value), itemStyle: { color: 'rgba(255,106,43,0.75)', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 },
      {
        type: 'custom',
        silent: true,
        data: yearly.map((y, i) => [i, y.lo, y.hi]),
        renderItem: (_: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const x = api.value(0)
          const lo = api.coord([x, api.value(1)])
          const hi = api.coord([x, api.value(2)])
          const w = Math.min(10, api.size([1, 0])[0]! * 0.3)
          const s = { stroke: INK, lineWidth: 1.2, opacity: 0.8 }
          return {
            type: 'group',
            children: [
              { type: 'line', shape: { x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] }, style: s },
              { type: 'line', shape: { x1: lo[0]! - w / 2, y1: lo[1], x2: lo[0]! + w / 2, y2: lo[1] }, style: s },
              { type: 'line', shape: { x1: hi[0]! - w / 2, y1: hi[1], x2: hi[0]! + w / 2, y2: hi[1] }, style: s },
            ],
          }
        },
        z: 3,
      },
    ],
  }), [yearly, unitShort])
  const { el } = useChart(option)
  return <div ref={el} className="h-64 w-full" />
}

/* ------------------------------------------------------------------ Timeline (dock) */
const ERA_MARKS = [
  { ym: '2002-07', label: 'Aqua joins' },
  { ym: '2012-01', label: 'VIIRS S-NPP' },
  { ym: '2022-10', label: 'VIIRS-derived' },
]

export function TimelineChart({
  data,
  ramp,
  view,
  selected,
  onSelect,
  focus,
}: {
  data: CalendarResponse
  ramp: RampName
  view: 'count' | 'anomaly'
  selected: string | null
  onSelect: (ym: string) => void
  /** Shaded span with a label (guided story). */
  focus?: { from: string; to: string; label: string } | null
}) {
  const months = data.months
  const option = useMemo<Opt>(() => {
    const max = Math.max(1, ...months.map((m) => m.value))
    const unitShort = data.unit === 'modis' ? 'MODIS-eq' : 'VIIRS-eq'
    const cats = months.map((m) => m.ym)
    const selIdx = selected ? cats.indexOf(selected) : -1
    const many = months.length > 60
    return {
      animation: false,
      grid: { left: 44, right: 14, top: 18, bottom: 22 },
      xAxis: {
        type: 'category',
        data: cats,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: LINE } },
        axisLabel: {
          color: MUTE,
          fontSize: 10,
          interval: (i: number) => (many ? cats[i]!.endsWith('-01') && Number(cats[i]!.slice(0, 4)) % 2 === 0 : true),
          formatter: (v: string) => (many ? v.slice(0, 4) : `${MONTHS[Number(v.slice(5)) - 1]} ${v.slice(2, 4)}`),
        },
      },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { color: MUTE, fontSize: 10, formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v)) }, splitLine: { lineStyle: { color: LINE } } },
      dataZoom: [{ type: 'inside', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, moveOnMouseMove: true }],
      tooltip: {
        ...tooltipBase,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(243,238,230,0.06)' } },
        formatter: (ps: { dataIndex: number }[]) => monthTooltip(months[ps[0]!.dataIndex]!, unitShort) + '<br/><span style="color:#8a8378">Click to map this month</span>',
      },
      series: [
        { type: 'line', data: months.map((m) => m.lo), stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true },
        { type: 'line', data: months.map((m) => Math.max(0, m.hi - m.lo)), stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: 'rgba(143,180,255,0.18)' }, silent: true },
        {
          type: 'bar',
          barCategoryGap: '18%',
          data: months.map((m, i) => ({
            value: m.value,
            itemStyle: {
              color: view === 'count' ? countColor(ramp, m.value, max) : m.pct === null ? '#3a3632' : pctColor(m.pct),
              opacity: selIdx < 0 || i === selIdx ? 1 : 0.6,
              borderColor: i === selIdx ? INK : m.provisional ? 'rgba(255,106,43,0.9)' : undefined,
              borderWidth: i === selIdx ? 1.5 : m.provisional ? 1 : 0,
              borderType: m.provisional && i !== selIdx ? 'dashed' : 'solid',
              borderRadius: [2, 2, 0, 0],
            },
          })),
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: 'rgba(243,238,230,0.35)', type: 'dashed', width: 1 },
            label: { color: MUTE, fontSize: 10, position: 'insideEndTop' },
            data: [
              ...ERA_MARKS.filter((e) => cats.includes(e.ym)).map((e) => ({ xAxis: e.ym, label: { formatter: e.label } })),
              ...(selIdx >= 0 ? [{ xAxis: cats[selIdx]!, lineStyle: { color: INK, type: 'solid', width: 1, opacity: 0.7 }, label: { show: false } }] : []),
            ],
          },
          markArea:
            focus && cats.includes(focus.from)
              ? {
                  silent: true,
                  itemStyle: { color: 'rgba(255,106,43,0.12)', borderColor: 'rgba(255,106,43,0.7)', borderWidth: 1, borderType: 'dashed' },
                  label: { color: '#FF9A5C', fontSize: 11, fontWeight: 700, position: 'insideTop', formatter: focus.label },
                  data: [[{ xAxis: focus.from }, { xAxis: cats.includes(focus.to) ? focus.to : cats[cats.length - 1] }]],
                }
              : undefined,
        },
      ],
    }
  }, [months, data.unit, ramp, view, selected, focus])
  const { el } = useChart(option, undefined, (i) => {
    const m = months[i]
    if (m) onSelect(m.ym)
  })
  return <div ref={el} className="h-full w-full" />
}

/* ------------------------------------------------------------------ Daily (selected month) */
export type DayRow = { date: string; day: number; night: number; no_data: boolean; future: boolean }

export function DailyChart({ days, selected, onSelect }: { days: DayRow[]; selected: string | null; onSelect: (d: string | null) => void }) {
  const option = useMemo<Opt>(() => {
    const on = (i: number) => !selected || days[i]!.date === selected
    return {
      animation: false,
      grid: { left: 34, right: 6, top: 10, bottom: 20 },
      xAxis: { type: 'category', data: days.map((d) => String(Number(d.date.slice(8)))), axisTick: { show: false }, axisLine: { lineStyle: { color: LINE } }, axisLabel: { color: MUTE, fontSize: 9, interval: 4 } },
      yAxis: { type: 'value', splitNumber: 2, axisLabel: { color: MUTE, fontSize: 9 }, splitLine: { lineStyle: { color: LINE } } },
      tooltip: {
        ...tooltipBase,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(243,238,230,0.06)' } },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = days[ps[0]!.dataIndex]!
          if (d.future) return `<b>${d.date}</b><br/>Not observed yet`
          return `<b>${d.date}</b><br/>Day overpasses: ${fmt(d.day, 1)}<br/>Night overpasses: ${fmt(d.night, 1)}${d.no_data ? '<br/><span style="color:#FF6A2B">No satellite data this day</span>' : ''}<br/><span style="color:#8a8378">Click: only this day on the map + its satellite image</span>`
        },
      },
      series: [
        { type: 'bar', stack: 'd', data: days.map((d, i) => ({ value: d.day, itemStyle: { color: '#F05A1A', opacity: on(i) ? 1 : 0.3 } })), barCategoryGap: '20%' },
        { type: 'bar', stack: 'd', data: days.map((d, i) => ({ value: d.night, itemStyle: { color: '#8FB4FF', opacity: on(i) ? 1 : 0.3, borderRadius: [2, 2, 0, 0] } })) },
      ],
    }
  }, [days, selected])
  const { el } = useChart(option, undefined, (i) => {
    const d = days[i]
    if (d && !d.future) onSelect(d.date === selected ? null : d.date)
  })
  return <div ref={el} className="h-28 w-full" />
}

/* ------------------------------------------------------------------ Fire clock (climatology) */
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function SeasonClock({ clim, highlight }: { clim: { month: number; median: number }[]; highlight: number | null }) {
  const option = useMemo<Opt>(() => {
    const max = Math.max(1, ...clim.map((c) => c.median))
    return {
      animation: false,
      polar: { radius: ['16%', '80%'] },
      angleAxis: { type: 'category', data: MONTHS.map((m) => m[0]), startAngle: 90 + 15, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: MUTE, fontSize: 10 }, splitLine: { show: false } },
      radiusAxis: { show: false, max },
      tooltip: { ...tooltipBase, formatter: (p: { dataIndex: number; value: number }) => `<b>${MONTHS_FULL[p.dataIndex]}</b><br/>Typical (median) month: ${fmt(p.value, p.value < 10 ? 1 : 0)}` },
      series: [
        {
          type: 'bar',
          coordinateSystem: 'polar',
          barCategoryGap: '8%',
          data: clim.map((c) => ({
            value: c.median,
            itemStyle: { color: countColor('inferno', c.median, max), opacity: highlight && c.month !== highlight ? 0.45 : 1, borderColor: c.month === highlight ? INK : undefined, borderWidth: c.month === highlight ? 1.5 : 0 },
          })),
        },
      ],
    }
  }, [clim, highlight])
  const { el } = useChart(option)
  return <div ref={el} className="aspect-square w-full" />
}
