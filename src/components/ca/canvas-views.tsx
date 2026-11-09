'use client'

// Canvas rendering primitives for the workbench.
// All canvases render at native grid resolution and are scaled up with
// `image-rendering: pixelated` for a crisp CA look at any panel size.

import { useCallback, useEffect, useRef } from 'react'

export const C_L1 = '#fbbf24' // Layer 1 — amber
export const C_L2 = '#2dd4bf' // Layer 2 — teal
export const C_BOTH = '#f4f4f5' // both layers alive (overlay view)
export const C_DEAD = '#101014' // empty cell

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function paintGrid(
  canvas: HTMLCanvasElement,
  grid: Uint8Array,
  W: number,
  H: number,
  colors: { on: string; off: string },
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(W, H)
  const on = hexToRgb(colors.on)
  const off = hexToRgb(colors.off)
  const d = img.data
  for (let i = 0; i < W * H; i++) {
    const c = grid[i] ? on : off
    d[i * 4] = c[0]
    d[i * 4 + 1] = c[1]
    d[i * 4 + 2] = c[2]
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

/** One 2D layer rendered as a pixelated square canvas. `showGrid` draws a
 *  cell-boundary overlay (only at readable sizes, ≤ 48). */
export function GridImage({
  grid,
  size,
  color,
  className,
  showGrid,
}: {
  grid: Uint8Array
  size: number
  color: string
  className?: string
  showGrid?: boolean
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (ref.current) paintGrid(ref.current, grid, size, size, { on: color, off: C_DEAD })
  })
  const lines = showGrid === true && size <= 48
  return (
    <div className={`relative w-full ${className ?? ''}`}>
      <canvas
        ref={ref}
        width={size}
        height={size}
        className="block h-auto w-full"
        style={{ imageRendering: 'pixelated' }}
        aria-label="CA layer grid"
        role="img"
      />
      {lines && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${size} ${size}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          <g stroke="rgba(228,228,231,0.16)" strokeWidth={1}>
            {Array.from({ length: size - 1 }, (_, i) => i + 1).flatMap((i) => [
              <line key={`v${i}`} x1={i} y1={0} x2={i} y2={size} vectorEffect="non-scaling-stroke" />,
              <line key={`h${i}`} x1={0} y1={i} x2={size} y2={i} vectorEffect="non-scaling-stroke" />,
            ])}
          </g>
        </svg>
      )}
    </div>
  )
}

/** The 4-state analytical overlay (s1, s2) — the "collision view". */
export function OverlayImage({
  l1,
  l2,
  size,
  className,
}: {
  l1: Uint8Array
  l2: Uint8Array
  size: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(size, size)
    const c1 = hexToRgb(C_L1)
    const c2 = hexToRgb(C_L2)
    const cb = hexToRgb(C_BOTH)
    const cd = hexToRgb(C_DEAD)
    const d = img.data
    for (let i = 0; i < size * size; i++) {
      const a = l1[i]
      const b = l2[i]
      const c = a && b ? cb : a ? c1 : b ? c2 : cd
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  })
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className={className ?? 'w-full h-auto'}
      style={{ imageRendering: 'pixelated' }}
      aria-label="overlay of both layers"
      role="img"
    />
  )
}

/**
 * ── Recycled-record heatmap ────────────────────────────────────────────
 * Renders the engine's per-cell counter of delivered recycled births as a
 * viridis-style, log-scaled heatmap. In `seed1` mode with a passive Layer 2
 * rule this is a picture of Layer 1's history: every cell that has ever died
 * there, weighted by how many times.
 */

const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [72, 40, 120], [65, 68, 135], [54, 92, 141], [39, 127, 142],
  [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
]

function viridis(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1)
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x))
  const f = x - i
  const a = VIRIDIS[i]
  const b = VIRIDIS[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** Log-scaled heat in [0, 1]. The counters are heavy-tailed (a few very hot
 *  cells, many cold ones) — linear scaling would crush everything but the
 *  hottest cell to near-black. Zero stays zero (renders as dead). */
function recordHeat(v: number, max: number): number {
  if (max <= 0 || v === 0) return 0
  return Math.log(1 + v) / Math.log(1 + max)
}

/** 2D record view: the cumulative per-cell counter, one square heatmap. */
export function RecordImage({
  counts,
  size,
  className,
}: {
  counts: Uint32Array
  size: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let max = 0
    for (let i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i]
    const img = ctx.createImageData(size, size)
    const cd = hexToRgb(C_DEAD)
    const d = img.data
    for (let i = 0; i < size * size; i++) {
      const v = counts[i]
      const c = v === 0 ? cd : viridis(recordHeat(v, max))
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  })
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className={className ?? 'w-full h-auto'}
      style={{ imageRendering: 'pixelated' }}
      aria-label="recycled-birth record heatmap"
      role="img"
    />
  )
}

/** 1D record view: a spacetime heatmap — each row is a snapshot of the
 *  cumulative counter at that step (newest at the bottom), so you can see
 *  the record accumulate. */
export function RecordSpaceImage({
  rows,
  width,
  className,
  height,
}: {
  rows: Uint32Array[]
  width: number
  className?: string
  height?: number
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const H = height ?? Math.max(64, rows.length)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = width
    canvas.height = H
    let max = 0
    for (const row of rows) for (let i = 0; i < row.length; i++) if (row[i] > max) max = row[i]
    const img = ctx.createImageData(width, H)
    const cd = hexToRgb(C_DEAD)
    const d = img.data
    const start = Math.max(0, rows.length - H)
    for (let r = 0; r < H; r++) {
      const row = rows[start + r]
      for (let x = 0; x < width; x++) {
        const v = row ? row[x] : 0
        const c = v === 0 ? cd : viridis(recordHeat(v, max))
        const i = (r * width + x) * 4
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
  return (
    <canvas
      ref={ref}
      className={className ?? 'w-full h-auto'}
      style={{ imageRendering: 'pixelated' }}
      aria-label="recycled-record spacetime heatmap"
      role="img"
    />
  )
}

/** 1D spacetime diagram: history rows, newest at the bottom. */
export function SpaceImage({
  rows,
  width,
  color,
  className,
  height,
}: {
  rows: Uint8Array[]
  width: number
  color: string
  className?: string
  height?: number
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const H = height ?? Math.max(64, rows.length)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = width
    canvas.height = H
    const img = ctx.createImageData(width, H)
    const on = hexToRgb(color)
    const off = hexToRgb(C_DEAD)
    const d = img.data
    const start = Math.max(0, rows.length - H)
    for (let r = 0; r < H; r++) {
      const row = rows[start + r]
      for (let x = 0; x < width; x++) {
        const c = row && row[x] ? on : off
        const i = (r * width + x) * 4
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
  return (
    <canvas
      ref={ref}
      className={className ?? 'w-full h-auto'}
      style={{ imageRendering: 'pixelated' }}
      aria-label="spacetime diagram"
      role="img"
    />
  )
}

/** 1D overlay spacetime (4-state joint history). */
export function OverlaySpaceImage({
  rows1,
  rows2,
  width,
  className,
  height,
}: {
  rows1: Uint8Array[]
  rows2: Uint8Array[]
  width: number
  className?: string
  height?: number
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const H = height ?? Math.max(64, rows1.length)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = width
    canvas.height = H
    const img = ctx.createImageData(width, H)
    const c1 = hexToRgb(C_L1)
    const c2 = hexToRgb(C_L2)
    const cb = hexToRgb(C_BOTH)
    const cd = hexToRgb(C_DEAD)
    const d = img.data
    const start = Math.max(0, rows1.length - H)
    for (let r = 0; r < H; r++) {
      const r1 = rows1[start + r]
      const r2 = rows2[start + r]
      for (let x = 0; x < width; x++) {
        const a = r1 ? r1[x] : 0
        const b = r2 ? r2[x] : 0
        const c = a && b ? cb : a ? c1 : b ? c2 : cd
        const i = (r * width + x) * 4
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  })
  return (
    <canvas
      ref={ref}
      className={className ?? 'w-full h-auto'}
      style={{ imageRendering: 'pixelated' }}
      aria-label="overlay spacetime diagram"
      role="img"
    />
  )
}

/**
 * Shared pointer-paint handler for layer canvases (click/drag to edit cells).
 *
 * `twoD` selects the index mapping: on a 2D layer the pointer maps to
 * `y * cellsAcross + x` (both axes of the square grid); on the 1D spacetime
 * view it maps to `x` only — intentionally, because there you edit the
 * current (newest) row, not a point in the diagram's history.
 */
export function useCellPainter(
  engine: {
    setCell(layer: 1 | 2, index: number, value: 0 | 1): void
    layer1: Uint8Array
    layer2: Uint8Array
  },
  layer: 1 | 2,
  cellsAcross: number,
  twoD: boolean,
  onEdit: () => void,
) {
  const paintValue = useRef<0 | 1>(1)
  const dragging = useRef(false)

  const cellFromEvent = useCallback(
    (e: React.PointerEvent<HTMLElement>): number => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = Math.max(
        0,
        Math.min(cellsAcross - 1, Math.floor(((e.clientX - rect.left) / rect.width) * cellsAcross)),
      )
      if (!twoD) return x
      const y = Math.max(
        0,
        Math.min(cellsAcross - 1, Math.floor(((e.clientY - rect.top) / rect.height) * cellsAcross)),
      )
      return y * cellsAcross + x
    },
    [cellsAcross, twoD],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragging.current = true
      const idx = cellFromEvent(e)
      const current = (layer === 1 ? engine.layer1 : engine.layer2)[idx]
      paintValue.current = current ? 0 : 1
      engine.setCell(layer, idx, paintValue.current)
      onEdit()
    },
    [cellFromEvent, engine, layer, onEdit],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!dragging.current) return
      engine.setCell(layer, cellFromEvent(e), paintValue.current)
      onEdit()
    },
    [cellFromEvent, engine, layer, onEdit],
  )

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp }
}

// ── Offscreen canvas factories (PNG snapshot export) ────────────────────────

function newCanvas(W: number, H: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  return c
}

export function makeGridCanvas(grid: Uint8Array, size: number, color: string): HTMLCanvasElement {
  const c = newCanvas(size, size)
  paintGrid(c, grid, size, size, { on: color, off: C_DEAD })
  return c
}

export function makeOverlayCanvas(l1: Uint8Array, l2: Uint8Array, size: number): HTMLCanvasElement {
  const c = newCanvas(size, size)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const c1 = hexToRgb(C_L1), c2 = hexToRgb(C_L2), cb = hexToRgb(C_BOTH), cd = hexToRgb(C_DEAD)
  const d = img.data
  for (let i = 0; i < size * size; i++) {
    const a = l1[i], b = l2[i]
    const col = a && b ? cb : a ? c1 : b ? c2 : cd
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export function makeSpaceCanvas(rows: Uint8Array[], width: number, color: string): HTMLCanvasElement {
  const H = Math.max(1, rows.length)
  const c = newCanvas(width, H)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(width, H)
  const on = hexToRgb(color), off = hexToRgb(C_DEAD)
  const d = img.data
  for (let r = 0; r < H; r++) {
    const row = rows[r]
    for (let x = 0; x < width; x++) {
      const col = row && row[x] ? on : off
      const i = (r * width + x) * 4
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export function makeOverlaySpaceCanvas(
  rows1: Uint8Array[], rows2: Uint8Array[], width: number,
): HTMLCanvasElement {
  const H = Math.max(1, rows1.length)
  const c = newCanvas(width, H)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(width, H)
  const c1 = hexToRgb(C_L1), c2 = hexToRgb(C_L2), cb = hexToRgb(C_BOTH), cd = hexToRgb(C_DEAD)
  const d = img.data
  for (let r = 0; r < H; r++) {
    const r1 = rows1[r], r2 = rows2[r]
    for (let x = 0; x < width; x++) {
      const a = r1 ? r1[x] : 0
      const b = r2 ? r2[x] : 0
      const col = a && b ? cb : a ? c1 : b ? c2 : cd
      const i = (r * width + x) * 4
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}
