'use client'

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { MONTHS, type Month } from '@/lib/data'
import { countColor, type RampName } from '@/lib/ramps'

/**
 * The real Pakistan calendar as a field of instanced bars: 12 months across,
 * one row per year, height and colour from log1p(count). One draw call.
 * Month initials run along the front edge and year labels down the right side.
 * The latest (current) month is drawn in the accent colour with a pulsing ring
 * and a floating "Now" tag. Intro: rows grow in year order. Afterwards the
 * camera sways with the pointer. Rendering stops when the canvas is off screen.
 */
const GAP = 1.18
const H = 5.2
const ACCENT = '#FF6A2B'

/** Camera-facing text label drawn to a canvas texture (no extra dependency). */
function useTextSprite(text: string, opts: { color?: string; bg?: string; border?: string; height?: number; weight?: number }) {
  const { color = '#9AA3AE', bg, border, height = 0.5, weight = 600 } = opts
  return useMemo(() => {
    const px = 64
    const pad = bg ? px * 0.45 : px * 0.1
    const font = `${weight} ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')!
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width + pad * 2)
    const h = Math.ceil(px * (bg ? 1.6 : 1.25))
    c.width = w
    c.height = h
    ctx.font = font
    if (bg) {
      const r = h / 2
      ctx.beginPath()
      ctx.roundRect(2, 2, w - 4, h - 4, r)
      ctx.fillStyle = bg
      ctx.fill()
      if (border) {
        ctx.lineWidth = 3
        ctx.strokeStyle = border
        ctx.stroke()
      }
    }
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, w / 2, h / 2 + px * 0.04)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
    return { mat, scale: [(height * w) / h, height, 1] as [number, number, number] }
  }, [text, color, bg, border, height, weight])
}

function Label({ text, position, ...opts }: { text: string; position: [number, number, number] } & Parameters<typeof useTextSprite>[1]) {
  const { mat, scale } = useTextSprite(text, opts)
  useEffect(() => () => (mat.map?.dispose(), mat.dispose()), [mat])
  return <sprite material={mat} position={position} scale={scale} />
}

type Bar = { x: number; z: number; h: number; color: THREE.Color; row: number }

function Bars({ layout, months, onHover, currentIdx }: { layout: Bar[]; months: Month[]; onHover: (m: Month | null) => void; currentIdx: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const start = useRef<number | null>(null)
  const done = useRef(false)
  const hovered = useRef<number | null>(null)
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const invalidate = useThree((s) => s.invalidate)
  const white = useMemo(() => new THREE.Color('#ffffff'), [])

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    layout.forEach((b, i) => {
      tmp.position.set(b.x, 0, b.z)
      tmp.scale.set(1, 0.001, 1)
      tmp.updateMatrix()
      mesh.setMatrixAt(i, tmp.matrix)
      mesh.setColorAt(i, b.color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    start.current = null
    done.current = false
    invalidate()
  }, [layout, tmp, invalidate])

  useFrame((state) => {
    const mesh = ref.current
    if (!mesh || done.current) return
    if (start.current === null) start.current = state.clock.elapsedTime
    const el = state.clock.elapsedTime - start.current
    let all = true
    layout.forEach((b, i) => {
      const p = Math.min(1, Math.max(0, (el - b.row * 0.045) / 1.1))
      if (p < 1) all = false
      const e = 1 - Math.pow(1 - p, 4)
      tmp.position.set(b.x, (b.h * e) / 2, b.z)
      tmp.scale.set(i === currentIdx ? 1.06 : 1, Math.max(0.001, b.h * e), i === currentIdx ? 1.06 : 1)
      tmp.updateMatrix()
      mesh.setMatrixAt(i, tmp.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (all) done.current = true
  })

  const setHover = (i: number | null) => {
    const mesh = ref.current
    if (!mesh || hovered.current === i) return
    const prev = hovered.current
    hovered.current = i
    for (const k of [prev, i]) {
      if (k === null || k === undefined) continue
      const b = layout[k]!
      const lift = k === i ? 0.35 : 0
      const wide = k === currentIdx ? 1.06 : 1
      tmp.position.set(b.x, b.h / 2 + lift, b.z)
      tmp.scale.set(wide, b.h, wide)
      tmp.updateMatrix()
      mesh.setMatrixAt(k, tmp.matrix)
      mesh.setColorAt(k, k === i ? white : b.color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    onHover(i === null ? null : months[i]!)
    invalidate()
  }

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, months.length]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        if (done.current && e.instanceId !== undefined) setHover(e.instanceId)
      }}
      onPointerOut={() => setHover(null)}
    >
      <boxGeometry args={[0.9, 1, 0.9]} />
      <meshStandardMaterial roughness={0.5} metalness={0.05} />
    </instancedMesh>
  )
}

/** Pulsing ring + leader line + "Now" tag above the latest month. */
function CurrentMarker({ bar, text }: { bar: Bar; text: string }) {
  const ring = useRef<THREE.Mesh>(null)
  const group = useRef<THREE.Group>(null)
  const top = bar.h + 0.25
  const tagY = Math.max(bar.h + 2.2, H * 0.62)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    // fade in after the intro has grown the last rows
    if (group.current) group.current.visible = t > 2.3
    if (ring.current) {
      const p = (t % 2) / 2
      ring.current.scale.setScalar(0.7 + p * 1.1)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - p)
    }
  })
  return (
    <group ref={group} position={[bar.x, 0, bar.z]} visible={false}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[0.62, 0.74, 48]} />
        <meshBasicMaterial color={ACCENT} transparent depthWrite={false} fog={false} />
      </mesh>
      <mesh position-y={(top + tagY) / 2 - 0.2}>
        <cylinderGeometry args={[0.025, 0.025, tagY - top - 0.4, 6]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.85} fog={false} />
      </mesh>
      <Label text={text} position={[0, tagY, 0]} color="#0B0D10" bg={ACCENT} height={1.05} weight={700} />
    </group>
  )
}

function Axes({ years }: { years: number[] }) {
  const front = ((years.length - 1) / 2) * GAP + 1.15
  const side = 6 * GAP + 0.15
  const shown = years.filter((y, i) => i === 0 || i === years.length - 1 || (y % 5 === 0 && years.length - 1 - i > 2))
  return (
    <group>
      {MONTHS.map((m, i) => (
        <Label key={m} text={m.slice(0, 1)} position={[(i + 1 - 6.5) * GAP, 0.3, front]} height={0.8} />
      ))}
      {shown.map((y) => (
        <Label key={y} text={String(y)} position={[side + 1.4, 0.3, (years.indexOf(y) - (years.length - 1) / 2) * GAP]} height={0.75} />
      ))}
    </group>
  )
}

function Rig() {
  const target = useMemo(() => new THREE.Vector3(-1.6, 1.2, 2.2), [])
  useFrame((state, dt) => {
    const { camera, pointer } = state
    const t = state.clock.elapsedTime
    const ax = Math.sin(t * 0.12) * 0.16 + pointer.x * 0.3
    const ay = pointer.y * 0.12
    const r = 50
    const px = Math.sin(0.72 + ax) * r
    const pz = Math.cos(0.72 + ax) * r
    const py = 27 + ay * 6
    const k = 1 - Math.exp(-dt * 2.5)
    camera.position.x += (px - camera.position.x) * k
    camera.position.y += (py - camera.position.y) * k
    camera.position.z += (pz - camera.position.z) * k
    camera.lookAt(target)
  })
  return null
}

export default function Calendar3D({
  months,
  ramp = 'cividis',
  active,
  onHover,
}: {
  months: Month[]
  ramp?: RampName
  active: boolean
  onHover: (m: Month | null) => void
}) {
  useEffect(() => () => onHover(null), [onHover])
  const years = useMemo(() => Array.from(new Set(months.map((m) => m.year))).sort((a, b) => a - b), [months])
  const currentIdx = months.length - 1
  const current = months[currentIdx]
  const layout = useMemo(() => {
    const max = Math.max(...months.map((m) => m.value))
    return months.map((m, i) => {
      const t = max > 0 ? Math.log1p(m.value) / Math.log1p(max) : 0
      return {
        x: (m.month - 6.5) * GAP,
        z: (years.indexOf(m.year) - (years.length - 1) / 2) * GAP,
        h: Math.max(0.06, t * H),
        color: new THREE.Color(i === months.length - 1 ? ACCENT : countColor(ramp, m.value, max)),
        row: years.indexOf(m.year),
      }
    })
  }, [months, years, ramp])
  const tag = current ? `NOW · ${MONTHS[current.month - 1]!.toUpperCase()} ${current.year}` : ''

  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 1.75]}
      camera={{ position: [27, 23, 30], fov: 32, near: 0.1, far: 200 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-hidden="true"
    >
      <fog attach="fog" args={['#0B0D10', 50, 88]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[-10, 22, 8]} intensity={1.6} color="#fff1e0" />
      <pointLight position={[8, 2, 14]} intensity={50} distance={40} color={ACCENT} />
      <Bars layout={layout} months={months} onHover={onHover} currentIdx={currentIdx} />
      {current && <CurrentMarker bar={layout[currentIdx]!} text={tag} />}
      <Axes years={years} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <planeGeometry args={[18, 36]} />
        <meshStandardMaterial color="#141210" roughness={1} />
      </mesh>
      <Rig />
    </Canvas>
  )
}
