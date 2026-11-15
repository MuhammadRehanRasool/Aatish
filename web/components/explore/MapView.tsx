'use client'

import 'maplibre-gl/dist/maplibre-gl.css'

import {
  AttributionControl,
  Map as MLMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type MapTouchEvent,
} from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'

import type { ApiPoint } from '@/lib/api'

export type DrawMode = 'none' | 'polygon' | 'rect'
type LngLat = [number, number]
type Feature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>
const fc = (features: Feature[] = []): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })

const ACCENT = '#FF6A2B'
const STYLE = 'https://tiles.openfreemap.org/styles/dark'
/** Fire ramp for densities: transparent → ember → orange → yellow → white-hot. */
const HEAT: unknown[] = ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.08, 'rgba(120,20,10,0.45)', 0.3, '#B3260E', 0.55, '#F05A1A', 0.78, '#FDB022', 1, '#FFF4C2']

/** NASA GIBS true-colour layer for a date (verified tiles: Terra 2005, NOAA-20 2018+, NOAA-21 2026). */
export function gibsLayer(date: string) {
  return date >= '2018-04-01' ? { id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', label: 'VIIRS NOAA-20 true colour' } : { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', label: 'MODIS Terra true colour' }
}

/** AOI key ('pakistan' | 'region:ISO' | 'bbox:…' | 'circle:…' | 'poly:…') to a polygon for display. */
export function aoiGeometry(key: string, regions: GeoJSON.FeatureCollection | null): GeoJSON.Geometry | null {
  const nums = (s: string) => s.split(/[,\s]+/).filter(Boolean).map(Number)
  if (key === 'pakistan' || key.startsWith('region:')) {
    const f = regions?.features.find((x) => x.properties?.key === key)
    return f?.geometry ?? null
  }
  if (key.startsWith('bbox:')) {
    const [w, s, e, n] = nums(key.slice(5)) as [number, number, number, number]
    return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
  }
  if (key.startsWith('circle:')) {
    const [lon, lat, km] = nums(key.slice(7)) as [number, number, number]
    const ring: LngLat[] = []
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2
      ring.push([lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 111.32) * Math.sin(a)])
    }
    return { type: 'Polygon', coordinates: [ring] }
  }
  if (key.startsWith('poly:')) {
    const pts = key
      .slice(5)
      .split(';')
      .map((p) => nums(p) as LngLat)
    return { type: 'Polygon', coordinates: [[...pts, pts[0]!]] }
  }
  return null
}

function bounds(g: GeoJSON.Geometry): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as LngLat
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y)
    } else if (Array.isArray(c)) c.forEach(walk)
  }
  if ('coordinates' in g) walk(g.coordinates)
  return [w, s, e, n]
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const hhmm = (t: number) => `${String(Math.floor(t / 100)).padStart(2, '0')}:${String(t % 100).padStart(2, '0')}`

export type RegionPaint = Record<string, { color: string; html: string }>
export type Camera = { center: LngLat; zoom: number; nonce: number }

const SENSOR: Record<string, string> = { Terra: 'MODIS · 1 km', Aqua: 'MODIS · 1 km', 'S-NPP': 'VIIRS · 375 m', 'NOAA-20': 'VIIRS · 375 m', 'NOAA-21': 'VIIRS · 375 m' }
/** Aerospace-style telemetry card for one detection (all values escaped or numeric). */
function telemetry(p: Record<string, string | number | boolean>, co: LngLat) {
  const sat = String(p.sat)
  const frp = Number(p.frp)
  const w = Number(p.wr)
  const frpPct = Math.min(100, (Math.log10(1 + frp) / Math.log10(301)) * 100)
  return (
    `<div class="fc-tel">` +
    `<p class="fc-tel-h"><span class="fc-tel-dot"></span>Hotspot telemetry${p.nrt ? '<span class="fc-badge">NRT · provisional</span>' : ''}</p>` +
    `<p class="fc-tel-t">${esc(String(p.date))} <span>${hhmm(Number(p.t))} UTC · ${p.night ? 'night pass' : 'day pass'}</span></p>` +
    `<dl class="fc-tel-g">` +
    `<div><dt>Satellite</dt><dd>${esc(sat)}<small>${esc(SENSOR[sat] ?? '')}</small></dd></div>` +
    `<div><dt>Fire power</dt><dd>${frp.toFixed(1)} MW<small>radiative power</small></dd></div>` +
    `<div><dt>Harmonized weight</dt><dd>${w.toFixed(3)}<small>${w >= 0.995 && w <= 1.005 ? 'MODIS observed, counts as 1' : `counts as ${w < 1 ? `${Math.round(w * 100)}% of` : `${w.toFixed(2)}×`} a MODIS hotspot`}</small></dd></div>` +
    `<div><dt>Position</dt><dd>${co[1].toFixed(4)}°N<small>${co[0].toFixed(4)}°E</small></dd></div>` +
    `</dl>` +
    `<div class="fc-tel-bar" title="Fire radiative power, log scale to 300 MW"><i style="width:${frpPct.toFixed(0)}%"></i></div>` +
    `</div>`
  )
}

export function MapView({
  aoiKey,
  mode,
  onModeChange,
  onAoi,
  grid,
  points,
  dayFilter,
  livePoints,
  regionPaint,
  imageryDate,
  camera,
}: {
  aoiKey: string
  mode: DrawMode
  onModeChange: (m: DrawMode) => void
  onAoi: (key: string, label?: string) => void
  grid: [number, number, number, number][] | null
  points: ApiPoint[] | null
  dayFilter: string | null
  livePoints: [number, number, string, number, number, string, string][] | null
  regionPaint: RegionPaint | null
  imageryDate: string | null
  camera?: Camera | null
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [regions, setRegions] = useState<GeoJSON.FeatureCollection | null>(null)
  const draft = useRef<LngLat[]>([])
  const suppressClickUntil = useRef(0)
  const paintRef = useRef<RegionPaint | null>(regionPaint)
  const cb = useRef({ onAoi, onModeChange })
  useEffect(() => {
    cb.current = { onAoi, onModeChange }
  }, [onAoi, onModeChange])
  useEffect(() => {
    paintRef.current = regionPaint
  }, [regionPaint])

  // init once
  useEffect(() => {
    if (!el.current) return
    let cancelled = false
    let m: MLMap
    try {
      setWorkerUrl('/vendor/maplibre-gl-worker.mjs')
      m = new MLMap({
        container: el.current,
        style: STYLE,
        center: [69.5, 30.2],
        zoom: 4.6,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      })
    } catch (e) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- map construction failed (external system)
      setFailed(e instanceof Error ? e.message : 'The map could not start (WebGL unavailable?)')
      return
    }
    map.current = m
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
    m.addControl(new AttributionControl({ compact: true, customAttribution: 'Fire data: NASA FIRMS · Imagery: NASA GIBS' }), 'bottom-right')
    m.touchZoomRotate.disableRotation()
    m.setMissingStyleImageResolver((id) => {
      if (!m.hasImage(id)) m.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) })
    })
    m.on('load', async () => {
      let r: GeoJSON.FeatureCollection = fc()
      try {
        const res = await fetch('/data/regions.geojson')
        if (!res.ok) throw new Error(`${res.status}`)
        const raw: GeoJSON.FeatureCollection = await res.json()
        r = { ...raw, features: raw.features.map((f, i) => ({ ...f, id: i })) }
      } catch {
        // Province outlines are optional; drawing and the calendar still work without them.
      }
      if (cancelled) return
      setRegions(r)
      // the first label layer of the basemap: imagery and data go below place names
      const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id
      for (const id of ['regions', 'aoi', 'draft', 'grid', 'pts', 'live']) m.addSource(id, { type: 'geojson', data: fc() })
      m.addLayer({ id: 'regions-fill', type: 'fill', source: 'regions', filter: ['!=', ['get', 'key'], 'pakistan'], paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#f3eee6'], 'fill-opacity': ['case', ['has', 'fill'], ['case', ['boolean', ['feature-state', 'hover'], false], 0.5, 0.3], ['case', ['boolean', ['feature-state', 'hover'], false], 0.07, 0]] } }, firstSymbol)
      m.addLayer({ id: 'regions-line', type: 'line', source: 'regions', paint: { 'line-color': '#f3eee6', 'line-opacity': ['case', ['==', ['get', 'key'], 'pakistan'], 0.6, 0.28], 'line-width': ['case', ['==', ['get', 'key'], 'pakistan'], 1.3, 0.8] } }, firstSymbol)
      // ---- Jammu & Kashmir shown as disputed territory (Natural Earth; built by web/scripts/build_kashmir.py)
      try {
        const res = await fetch('/data/kashmir.geojson')
        if (!res.ok) throw new Error(`${res.status}`)
        const kj: GeoJSON.FeatureCollection = await res.json()
        if (cancelled) return
        if (!m.hasImage('fc-hatch')) {
          const n = 8
          const px = new Uint8Array(n * n * 4)
          for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++) {
              const on = (x + y) % n === 0 || (x + y) % n === n - 1
              px.set(on ? [243, 238, 230, 70] : [0, 0, 0, 0], (y * n + x) * 4)
            }
          m.addImage('fc-hatch', { width: n, height: n, data: px }, { pixelRatio: 1 })
        }
        m.addSource('kashmir', { type: 'geojson', data: kj })
        m.addLayer({ id: 'kashmir-fill', type: 'fill', source: 'kashmir', filter: ['==', ['get', 'part'], 'outside'], paint: { 'fill-pattern': 'fc-hatch', 'fill-opacity': 0.9 } }, firstSymbol)
        m.addLayer({ id: 'kashmir-line', type: 'line', source: 'kashmir', filter: ['==', ['get', 'part'], 'outline'], paint: { 'line-color': '#f3eee6', 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [3, 2] } }, firstSymbol)
        m.addLayer({
          id: 'kashmir-label',
          type: 'symbol',
          source: 'kashmir',
          filter: ['==', ['get', 'part'], 'label'],
          minzoom: 4,
          layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9, 8, 13], 'text-letter-spacing': 0.12, 'text-allow-overlap': true },
          paint: { 'text-color': '#f3eee6', 'text-opacity': 0.75, 'text-halo-color': '#0B0D10', 'text-halo-width': 1.4 },
        })
        const ktip = new Popup({ closeButton: false, closeOnClick: false, className: 'fc-tip', offset: 12, maxWidth: '280px' })
        m.on('mousemove', 'kashmir-fill', (e) => {
          if (m.getCanvas().dataset.drawing) return
          ktip
            .setLngLat(e.lngLat)
            .setHTML('<b>Jammu &amp; Kashmir · disputed territory</b><br/>This part is administered by India and claimed by Pakistan (Siachen: claimed by both).<br/><span class="fc-tip-mute">No fire data shown here. The app covers Pakistan-administered areas only.</span>')
            .addTo(m)
        })
        m.on('mouseleave', 'kashmir-fill', () => ktip.remove())
      } catch {
        // The disputed-territory overlay is optional; the map works without it.
      }
      m.addLayer({ id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': ACCENT, 'line-width': 2.2 } })
      m.addLayer({
        id: 'grid-heat',
        type: 'heatmap',
        source: 'grid',
        maxzoom: 10,
        paint: {
          'heatmap-weight': ['get', 'w'],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.55, 6, 0.9, 9, 2],
          'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 4, 4.5, 7, 18, 10, 100],
          'heatmap-color': HEAT as never,
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7.5, 0.9, 9.5, 0.25],
        },
      })
      m.addLayer({
        id: 'grid-cells',
        type: 'circle',
        source: 'grid',
        minzoom: 7,
        paint: {
          'circle-color': ['interpolate', ['linear'], ['get', 'w'], 0, '#7a1d0c', 0.4, '#F05A1A', 0.8, '#FDB022', 1, '#FFF4C2'],
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 7, 3, 10, 22],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 8.5, 0.55],
          'circle-stroke-width': 0,
        },
      })
      m.addLayer({
        id: 'pts-heat',
        type: 'heatmap',
        source: 'pts',
        maxzoom: 9,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0, 0, 1, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.32, 6, 0.6, 8, 1.4],
          'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 4, 6, 7, 16, 9, 30],
          'heatmap-color': HEAT as never,
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.85, 8.5, 0],
        },
      })
      m.addLayer({
        id: 'pts',
        type: 'circle',
        source: 'pts',
        paint: {
          'circle-color': ['interpolate', ['linear'], ['get', 'lfrp'], 0, '#FDE68A', 1.3, '#FDB022', 2, '#F05A1A', 2.7, '#D11F0B'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1, 6, 1.8, 9, 4, 13, 8],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.25, 6, 0.6, 8, 0.95],
          'circle-stroke-color': '#0B0D10',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 7, 0, 10, 0.8],
        },
      })
      m.addLayer({ id: 'live', type: 'circle', source: 'live', paint: { 'circle-color': '#8FB4FF', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.5, 8, 3.5, 12, 6], 'circle-opacity': 0.9, 'circle-stroke-color': '#0B0D10', 'circle-stroke-width': 0.5 } })
      m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': ACCENT, 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      m.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': ACCENT, 'circle-stroke-color': '#0B0D10', 'circle-stroke-width': 1.5 } })

      // ---- hover: province tooltip
      const tip = new Popup({ closeButton: false, closeOnClick: false, className: 'fc-tip', offset: 12, maxWidth: '280px' })
      let hoverId: string | number | undefined
      m.on('mousemove', 'regions-fill', (e) => {
        if (m.getCanvas().dataset.drawing) return
        const f = e.features?.[0]
        if (hoverId !== undefined) m.setFeatureState({ source: 'regions', id: hoverId }, { hover: false })
        hoverId = f?.id
        if (hoverId !== undefined) m.setFeatureState({ source: 'regions', id: hoverId }, { hover: true })
        m.getCanvas().style.cursor = 'pointer'
        const key = String(f?.properties?.key ?? '')
        const info = paintRef.current?.[key]?.html
        const disputed = key === 'region:PK-JK' || key === 'region:PK-GB' ? '<br/><span class="fc-tip-mute">Part of disputed Jammu &amp; Kashmir</span>' : ''
        tip.setLngLat(e.lngLat).setHTML(`<b>${esc(String(f?.properties?.label ?? ''))}</b>${disputed}${info ? `<br/>${info}` : ''}<br/><span class="fc-tip-mute">Click to analyse this province</span>`).addTo(m)
      })
      m.on('mouseleave', 'regions-fill', () => {
        if (hoverId !== undefined) m.setFeatureState({ source: 'regions', id: hoverId }, { hover: false })
        hoverId = undefined
        tip.remove()
        if (!m.getCanvas().dataset.drawing) m.getCanvas().style.cursor = ''
      })

      // ---- clicks: a hotspot first, then a grid cell, then a province
      const pop = new Popup({ closeButton: true, className: 'fc-pop', offset: 8, maxWidth: '320px' })
      const onPoint = (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties as Record<string, string | number | boolean> | undefined
        if (!p) return
        const co = (e.features![0]!.geometry as GeoJSON.Point).coordinates as LngLat
        suppressClickUntil.current = performance.now() + 50
        pop
          .setLngLat(co)
          .setHTML(telemetry(p, co))
          .addTo(m)
      }
      m.on('click', 'pts', onPoint)
      m.on('click', 'grid-cells', (e) => {
        if (performance.now() < suppressClickUntil.current) return
        const p = e.features?.[0]?.properties as { wr: number; n: number } | undefined
        if (!p) return
        suppressClickUntil.current = performance.now() + 50
        pop.setLngLat(e.lngLat).setHTML(`<div class="fc-tel"><p class="fc-tel-h"><span class="fc-tel-dot"></span>0.1° cell · whole date range</p><p class="fc-tel-t">${Math.round(p.wr).toLocaleString('en-US')} <span>MODIS-equivalent hotspots</span></p><p class="fc-tip-mute">${p.n.toLocaleString('en-US')} raw satellite detections, before harmonizing</p></div>`).addTo(m)
      })
      for (const id of ['pts', 'grid-cells', 'live']) {
        m.on('mouseenter', id, () => !m.getCanvas().dataset.drawing && (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', id, () => !m.getCanvas().dataset.drawing && (m.getCanvas().style.cursor = ''))
      }
      m.on('click', 'regions-fill', (e) => {
        if (m.getCanvas().dataset.drawing || performance.now() < suppressClickUntil.current) return
        const p = e.features?.[0]?.properties as { key?: string; label?: string } | undefined
        if (p?.key) cb.current.onAoi(p.key, p.label)
      })
      setReady(true)
    })
    m.on('error', (e) => {
      if (String(e.error?.message ?? '').includes('WebGL')) setFailed('The map needs WebGL, which this browser has turned off.')
    })
    return () => {
      cancelled = true
      setReady(false)
      m.remove()
      map.current = null
    }
  }, [])

  // AOI outline + fit
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const g = aoiGeometry(aoiKey, regions)
    ;(m.getSource('aoi') as GeoJSONSource | undefined)?.setData(fc(g && aoiKey !== 'pakistan' ? [{ type: 'Feature', properties: {}, geometry: g }] : []))
    if (g) {
      const [w, s, e, n] = bounds(g)
      const wide = window.innerWidth >= 1024
      m.fitBounds([w, s, e, n], {
        padding: wide ? { left: 440, right: 80, top: 120, bottom: 30 } : 24,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900,
        maxZoom: 10,
      })
    }
  }, [aoiKey, ready, regions])

  // guided-story camera moves (after the AOI fit, so it wins when both change together)
  useEffect(() => {
    const m = map.current
    if (!ready || !m || !camera) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const wide = window.innerWidth >= 1024
    m.flyTo({ center: camera.center, zoom: camera.zoom, duration: reduce ? 0 : 2200, curve: 1.5, essential: true, padding: wide ? { left: 420, right: 0, top: 80, bottom: 0 } : undefined })
  }, [camera, ready])

  // province fill (anomaly choropleth)
  useEffect(() => {
    const m = map.current
    if (!ready || !m || !regions) return
    ;(m.getSource('regions') as GeoJSONSource | undefined)?.setData({
      ...regions,
      features: regions.features.map((f) => {
        const k = String(f.properties?.key ?? '')
        const p = regionPaint?.[k]
        return { ...f, properties: { ...f.properties, ...(p?.color ? { fill: p.color } : {}) } }
      }),
    })
  }, [regionPaint, regions, ready])

  // range density grid
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const max = Math.log1p(grid?.[0]?.[2] ?? 1)
    ;(m.getSource('grid') as GeoJSONSource | undefined)?.setData(
      fc((grid ?? []).map(([x, y, w, n]) => ({ type: 'Feature', properties: { w: Math.log1p(w) / max, wr: w, n }, geometry: { type: 'Point', coordinates: [x, y] } })))
    )
  }, [grid, ready])

  // month hotspots
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const max = points?.reduce((a, p) => Math.max(a, p[2]), 0) || 1
    ;(m.getSource('pts') as GeoJSONSource | undefined)?.setData(
      fc(
        (points ?? []).map(([x, y, w, sat, nrt, date, t, frp, night]) => ({
          type: 'Feature',
          properties: { w: w / max, wr: w, sat, nrt, date, t, frp, lfrp: Math.log10(1 + frp), night },
          geometry: { type: 'Point', coordinates: [x, y] },
        }))
      )
    )
  }, [points, ready])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const f = dayFilter ? ['==', ['get', 'date'], dayFilter] : null
    m.setFilter('pts', f as never)
    m.setFilter('pts-heat', f as never)
  }, [dayFilter, ready])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    ;(m.getSource('live') as GeoJSONSource | undefined)?.setData(
      fc((livePoints ?? []).map(([x, y]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, y] } })))
    )
  }, [livePoints, ready])

  // NASA GIBS true-colour imagery for the chosen day
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    if (m.getLayer('gibs')) m.removeLayer('gibs')
    if (m.getSource('gibs')) m.removeSource('gibs')
    if (!imageryDate) return
    const layer = gibsLayer(imageryDate).id
    m.addSource('gibs', {
      type: 'raster',
      tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${imageryDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`],
      tileSize: 256,
      maxzoom: 9,
    })
    m.addLayer({ id: 'gibs', type: 'raster', source: 'gibs', paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 200 } }, 'regions-fill')
  }, [imageryDate, ready])

  // drawing
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const canvas = m.getCanvas()
    const setDraft = (pts: LngLat[], cursor?: LngLat, closed = false) => {
      const line = cursor ? [...pts, cursor] : pts
      const feats: Feature[] = pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
      if (line.length > 1) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: closed || line.length > 2 ? [...line, line[0]!] : line } })
      ;(m.getSource('draft') as GeoJSONSource | undefined)?.setData(fc(feats))
    }
    const clear = () => {
      draft.current = []
      setDraft([])
    }
    if (mode === 'none') {
      delete canvas.dataset.drawing
      canvas.style.cursor = ''
      m.doubleClickZoom.enable()
      m.dragPan.enable()
      clear()
      return
    }
    canvas.dataset.drawing = '1'
    canvas.style.cursor = 'crosshair'
    m.doubleClickZoom.disable()
    const r4 = (n: number) => Math.round(n * 1e4) / 1e4
    const endGesture = () => {
      suppressClickUntil.current = performance.now() + 400
      clear()
      cb.current.onModeChange('none')
    }
    const finishPoly = () => {
      const pts = draft.current
        .map(([x, y]): LngLat => [r4(x), r4(y)])
        .filter((p, i, a) => i === 0 || p[0] !== a[i - 1]![0] || p[1] !== a[i - 1]![1])
      if (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop()
      if (pts.length >= 3) cb.current.onAoi('poly:' + pts.map(([x, y]) => `${x},${y}`).join(';'), 'Drawn area')
      endGesture()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clear()
        cb.current.onModeChange('none')
      }
      if (e.key === 'Enter' && mode === 'polygon') finishPoly()
      if (e.key === 'Backspace' && mode === 'polygon' && draft.current.length) {
        draft.current = draft.current.slice(0, -1)
        setDraft(draft.current)
      }
    }
    window.addEventListener('keydown', onKey)

    if (mode === 'polygon') {
      const onClick = (e: MapMouseEvent) => {
        const p: LngLat = [e.lngLat.lng, e.lngLat.lat]
        const first = draft.current[0]
        if (first && draft.current.length >= 3) {
          const a = m.project(first)
          if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 10) return finishPoly()
        }
        draft.current = [...draft.current, p]
        setDraft(draft.current)
      }
      const onMove = (e: MapMouseEvent) => draft.current.length && setDraft(draft.current, [e.lngLat.lng, e.lngLat.lat])
      const onDbl = (e: MapMouseEvent) => {
        e.preventDefault()
        finishPoly()
      }
      m.on('click', onClick)
      m.on('mousemove', onMove)
      m.on('dblclick', onDbl)
      return () => {
        m.off('click', onClick)
        m.off('mousemove', onMove)
        m.off('dblclick', onDbl)
        window.removeEventListener('keydown', onKey)
      }
    }

    m.dragPan.disable()
    m.touchZoomRotate.disable()
    let start: LngLat | null = null
    let last: LngLat | null = null
    const rect = (a: LngLat, b: LngLat): LngLat[] => [a, [b[0], a[1]], b, [a[0], b[1]]]
    const onDown = (e: MapMouseEvent | MapTouchEvent) => {
      if ('points' in e && e.points.length > 1) return
      start = last = [e.lngLat.lng, e.lngLat.lat]
    }
    const onMove = (e: MapMouseEvent | MapTouchEvent) => {
      if (!start) return
      last = [e.lngLat.lng, e.lngLat.lat]
      setDraft(rect(start, last), undefined, true)
    }
    const finishRect = (b: LngLat | null) => {
      if (!start) return
      const a = start
      start = last = null
      if (b) {
        const [w, e2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
        const [s, n] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
        if (e2 - w > 0.01 && n - s > 0.01) cb.current.onAoi(`bbox:${r4(w)},${r4(s)},${r4(e2)},${r4(n)}`, 'Drawn box')
      }
      endGesture()
    }
    const onUp = (e: MapMouseEvent) => finishRect([e.lngLat.lng, e.lngLat.lat])
    const onTouchEnd = () => finishRect(last)
    const onWindowUp = () => finishRect(last)
    m.on('mousedown', onDown)
    m.on('mousemove', onMove)
    m.on('mouseup', onUp)
    m.on('touchstart', onDown)
    m.on('touchmove', onMove)
    m.on('touchend', onTouchEnd)
    window.addEventListener('mouseup', onWindowUp)
    return () => {
      m.off('mousedown', onDown)
      m.off('mousemove', onMove)
      m.off('mouseup', onUp)
      m.off('touchstart', onDown)
      m.off('touchmove', onMove)
      m.off('touchend', onTouchEnd)
      window.removeEventListener('mouseup', onWindowUp)
      m.dragPan.enable()
      m.touchZoomRotate.enable()
      m.touchZoomRotate.disableRotation()
      window.removeEventListener('keydown', onKey)
    }
  }, [mode, ready])

  return (
    <div className="relative h-full w-full overflow-hidden bg-raised" data-lenis-prevent>
      <div ref={el} className="h-full w-full" role="region" aria-label="Fire map. Click a province to analyse it, click a hotspot for details, or use the drawing tools." />
      {!ready && !failed && <p className="label absolute inset-0 grid place-items-center text-mute">Loading map…</p>}
      {failed && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-2">
          {failed} You can still choose a province in the panel.
        </p>
      )}
      {mode !== 'none' && (
        <p className="label absolute bottom-5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-accent/50 bg-[#0E1116]/90 px-4 py-2.5 text-ink shadow-[0_20px_50px_rgba(0,0,0,0.65)] backdrop-blur-xl lg:left-[calc(50%+210px)]" role="status">
          {mode === 'polygon' ? 'Click to add points · double-click or Enter to finish · Esc to cancel' : 'Press and drag to draw a box · Esc to cancel'}
        </p>
      )}
    </div>
  )
}
