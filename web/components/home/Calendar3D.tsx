'use client'

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { MONTHS, fmt, type Month } from '@/lib/data'
import { countColor, type RampName } from '@/lib/ramps'

/**
 * The real Pakistan calendar as a field of instanced bars: 12 months across,
 * one row per year, height and colour from log1p(count). One draw call.
 * Intro: rows grow in year order. Afterwards the camera sways with the pointer.
 * Rendering stops when the canvas is off screen (frameloop "never").
 */
const GAP = 1.18
const H = 5.2

function Bars({ months, ramp, onHover }: { months: Month[]; ramp: RampName; onHover: (m: Month | null) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const years = useMemo(() => Array.from(new Set(months.map((m) => m.year))).sort((a, b) => a - b), [months])
  const max = useMemo(() => Math.max(...months.map((m) => m.value)), [months])
  const start = useRef<number | null>(null)
  const done = useRef(false)
  const hovered = useRef<number | null>(null)
  const tmp = useMemo(() => new THREE.Object3D(), [])
  const invalidate = useThree((s) => s.invalidate)

  const layout = useMemo(
    () =>
      months.map((m) => {
        const t = max > 0 ? Math.log1p(m.value) / Math.log1p(max) : 0
        return {
          x: (m.month - 6.5) * GAP,
          z: (years.indexOf(m.year) - (years.length - 1) / 2) * GAP,
          h: Math.max(0.06, t * H),
          color: new THREE.Color(countColor(ramp, m.value, max)),
          row: years.indexOf(m.year),
        }
      }),
    [months, years, max, ramp]
  )

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
    if (!mesh) return
    if (!done.current) {
      if (start.current === null) start.current = state.clock.elapsedTime
      const el = state.clock.elapsedTime - start.current
      let all = true
      layout.forEach((b, i) => {
        const p = Math.min(1, Math.max(0, (el - b.row * 0.045) / 1.1))
        if (p < 1) all = false
        const e = 1 - Math.pow(1 - p, 4)
        const lift = hovered.current === i ? 0.35 : 0
        tmp.position.set(b.x, (b.h * e) / 2 + lift, b.z)
        tmp.scale.set(1, Math.max(0.001, b.h * e), 1)
        tmp.updateMatrix()
        mesh.setMatrixAt(i, tmp.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (all) done.current = true
    }
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
      tmp.position.set(b.x, b.h / 2 + lift, b.z)
      tmp.scale.set(1, b.h, 1)
      tmp.updateMatrix()
      mesh.setMatrixAt(k, tmp.matrix)
      mesh.setColorAt(k, k === i ? new THREE.Color('#ffffff') : b.color)
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
      <boxGeometry args={[0.92, 1, 0.92]} />
      <meshStandardMaterial roughness={0.55} metalness={0.05} />
    </instancedMesh>
  )
}

function Rig() {
  const target = useMemo(() => new THREE.Vector3(0, 0.6, 0), [])
  useFrame((state, dt) => {
    const { camera, pointer } = state
    const t = state.clock.elapsedTime
    const ax = Math.sin(t * 0.12) * 0.18 + pointer.x * 0.35
    const ay = pointer.y * 0.12
    const r = 27
    const px = Math.sin(0.78 + ax) * r
    const pz = Math.cos(0.78 + ax) * r
    const py = 17 + ay * 6
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
  onHover: (label: string | null) => void
}) {
  useEffect(() => () => onHover(null), [onHover])
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 1.75]}
      camera={{ position: [19, 17, 19], fov: 32, near: 0.1, far: 200 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-hidden="true"
    >
      <fog attach="fog" args={['#0B0D10', 30, 62]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[-10, 22, 8]} intensity={1.6} color="#fff1e0" />
      <pointLight position={[8, 2, 14]} intensity={60} distance={40} color="#ff6a2b" />
      <Bars
        months={months}
        ramp={ramp}
        onHover={(m) => onHover(m ? `${MONTHS[m.month - 1]} ${m.year} · ${fmt(m.value)} MODIS-eq${m.provisional ? ' · provisional' : ''}` : null)}
      />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <planeGeometry args={[18, 36]} />
        <meshStandardMaterial color="#151311" roughness={1} />
      </mesh>
      <Rig />
    </Canvas>
  )
}
