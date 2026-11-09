'use client'

// The workbench (Phase 2): three-panel layout — Layer 1 | Layer 2 | Layer 3
// (the read-only map) — plus controls, live statistics, cycle detector,
// extinction flag, run log with JSON/PNG export.
//
// Architecture: the engine is an external mutable system that lives OUTSIDE
// React (module singleton). React renders a projection of it; re-renders are
// driven by the `tick` state (engine step index), and the canvases read the
// engine arrays in effects after each render. The parent remounts this
// component (key = load-request version) when the Results tab asks to open a
// configuration.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RecyclingCA, defaultConfig } from '@/lib/ca/engine'
import type { CAConfig } from '@/lib/ca/types'
import { Controls } from '@/components/ca/controls'
import {
  C_L1, C_L2, GridImage, OverlayImage, OverlaySpaceImage, RecordImage, RecordSpaceImage, SpaceImage,
  makeGridCanvas, makeOverlayCanvas, makeOverlaySpaceCanvas, makeSpaceCanvas,
  useCellPainter,
} from '@/components/ca/canvas-views'
import { StatsPanel } from '@/components/ca/stats-panel'
import { RunLog, type LogEntry } from '@/components/ca/run-log'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { decodeConfigFromSearch, syncConfigUrl } from '@/lib/ca/url'
import { cn } from '@/lib/utils'
import { Layers, Link2, Map as MapIcon, Pause, Play, RotateCcw, Shuffle, SkipForward, Zap } from 'lucide-react'

const LOG_KEY = 'recycling-ca-log-v1'
const SPACE_ROWS_CAP = 180

// ── External engine store (outside React) ────────────────────────────────────
// The engine singleton, the spacetime row buffers and the stamp guard live
// at MODULE scope on purpose — they must survive component unmounts and must
// NOT be re-created by React: the canvases read the engine's typed arrays
// directly in effects on every `tick` render, and React state is only a
// projection (a config copy + the tick counter). page.tsx keys the
// Workbench by load-request version, so at most one Workbench is mounted at
// any time — the single-engine / single-guard pattern is therefore safe,
// and remounts (e.g. "Open in workbench" from the Results tab) reuse the
// same engine rather than allocating new buffers.
let engineSingleton: RecyclingCA | null = null
function getEngine(): RecyclingCA {
  if (engineSingleton === null) engineSingleton = new RecyclingCA(defaultConfig())
  return engineSingleton
}
const spaceRows = { r1: [] as Uint8Array[], r2: [] as Uint8Array[] }
/** 1D record-view history: per-step snapshots of the recycled-birth counter. */
const recordRows: Uint32Array[] = []
const stampGuard = { stamped: false }

// ── Analysis-only Layer-1 trace (linear-complexity panel) ────────────────────
// The engine does not retain per-step STATES (engine.history is per-step
// statistics), so the Berlekamp–Massey panel records its own. Recording is
// guarded by `mode` — true only while the analysis card is open — so a
// normal run pays nothing. Rows are cleared on reinit/reset and on every
// (re)open of the panel; the rolling cap bounds both row count (≤ 2048) and
// bytes (≤ 8 MB) so a 512×512 turbo run cannot balloon memory.
const analysisTrace: { mode: boolean; rows: Uint8Array[] } = { mode: false, rows: [] }
const ANALYSIS_TRACE_MAX_ROWS = 2048
const ANALYSIS_TRACE_BYTE_BUDGET = 8 * 1024 * 1024

function analysisTraceCap(cellsPerLayer: number): number {
  return Math.min(
    ANALYSIS_TRACE_MAX_ROWS,
    Math.max(64, Math.floor(ANALYSIS_TRACE_BYTE_BUDGET / Math.max(1, cellsPerLayer))),
  )
}

/** One snapshot of Layer 1 per step — called from every step context. */
function pushAnalysisRow(eng: RecyclingCA): void {
  if (!analysisTrace.mode) return
  analysisTrace.rows.push(Uint8Array.from(eng.layer1))
  const cap = analysisTraceCap(eng.cellsPerLayer)
  if (analysisTrace.rows.length > cap) {
    analysisTrace.rows.splice(0, analysisTrace.rows.length - cap)
  }
}

// ── Scenarios (one-click full configs) ─────────────────────────────────────

const SCENARIOS: { name: string; note: string; config: Partial<CAConfig> }[] = [
  {
    name: 'Life + empty L2 (record mode)',
    note: 'L2 starts empty; a passive L2 rule keeps every recycled birth',
    config: {
      dimensionality: '2d', size: 32, boundary: 'toroidal',
      rule1: 'B3/S23', rule2: 'B/S012345678',
      topology: 'same', collision: 'drop', direction: 'forward',
      initMode: 'seed1', density1: 0.3, density2: 0.3, seed: 1,
      sigma: 0, stochasticP: 1, maxSteps: 600,
    },
  },
  {
    name: 'Life + HighLife (asymmetric)',
    note: 'different rules per layer; guaranteed delivery',
    config: {
      dimensionality: '2d', size: 32, boundary: 'toroidal',
      rule1: 'B3/S23', rule2: 'B36/S23',
      topology: 'random_empty', collision: 'overwrite', direction: 'forward',
      initMode: 'both', density1: 0.3, density2: 0.3, seed: 7,
      sigma: 0, stochasticP: 1, maxSteps: 600,
    },
  },
  {
    name: 'W110 → W90 (1D)',
    note: 'W90 alone always dies; the W110 stream holds it up',
    config: {
      dimensionality: '1d', size: 128, boundary: 'toroidal',
      rule1: 'W110', rule2: 'W90',
      topology: 'random_empty', collision: 'drop', direction: 'forward',
      initMode: 'seed1', density1: 0.35, density2: 0.3, seed: 1,
      sigma: 0, stochasticP: 1, maxSteps: 600,
    },
  },
  {
    name: 'Single seed, watch it fill',
    note: 'Replicator rules; one centre cell, nearest+overwrite',
    config: {
      dimensionality: '2d', size: 32, boundary: 'toroidal',
      rule1: 'B1357/S1357', rule2: 'B1357/S1357',
      topology: 'nearest_empty', collision: 'overwrite', direction: 'forward',
      initMode: 'single1', density1: 0.3, density2: 0.3, seed: 1,
      sigma: 0, stochasticP: 1, maxSteps: 600,
    },
  },
]

export interface LoadRequest {
  config: CAConfig
  version: number
}

function outcomeLabel(engine: RecyclingCA): string {
  const s = engine.lastStepStats
  if (!s) return 'ready'
  if (s.outcome === 'extinct') return `extinct @ ${engine.extinctStep}`
  if (s.outcome === 'cycle') return `cycle (len ${engine.cycleJ?.length ?? '?'})`
  if (s.outcome === 'censored') return 'active @ cap'
  return `step ${engine.stepIndex}`
}

// ── Layer panel (top-level component) ────────────────────────────────────────

interface LayerPaneProps {
  layer: 1 | 2
  rule: string
  twoD: boolean
  size: number
  count: number
  grid: Uint8Array
  rows: Uint8Array[]
  painter: ReturnType<typeof useCellPainter>
  showGrid: boolean
}

function LayerPane({ layer, rule, twoD, size, count, grid, rows, painter, showGrid }: LayerPaneProps) {
  const color = layer === 1 ? C_L1 : C_L2
  return (
    <section className="flex-1 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
          <h3 className="text-sm font-semibold text-zinc-200">Layer {layer}</h3>
          <span className="font-mono text-[11px] text-zinc-500">{rule}</span>
        </div>
        <span className="font-mono text-xs text-zinc-400">{count} live</span>
      </header>
      <div
        className="relative touch-none select-none"
        style={{ cursor: 'crosshair' }}
        onPointerDown={painter.onPointerDown}
        onPointerMove={painter.onPointerMove}
        onPointerUp={painter.onPointerUp}
        onPointerLeave={painter.onPointerLeave}
        role="img"
        aria-label={`Layer ${layer} grid — click or drag to edit cells`}
      >
        {twoD ? (
          <GridImage grid={grid} size={size} color={color} showGrid={showGrid} />
        ) : (
          <SpaceImage rows={rows} width={size} color={color} />
        )}
      </div>
      <p className="text-[10px] text-zinc-600">
        {twoD
          ? 'Click / drag to draw (toggles the first cell; paints while dragging).'
          : 'Spacetime — newest row at the bottom. Click / drag to edit the current row.'}
      </p>
    </section>
  )
}

// ── Workbench ────────────────────────────────────────────────────────────────

export function Workbench({ loadRequest }: { loadRequest: LoadRequest | null }) {
  const engine = getEngine()
  const { toast } = useToast()
  const [config, setConfig] = useState<CAConfig>(() =>
    loadRequest ? { ...loadRequest.config } : { ...engine.config })
  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(12)
  const [turbo, setTurbo] = useState(false)
  const [mapMode, setMapMode] = useState<'split' | 'overlay' | 'record'>('split')
  const [showGrid, setShowGrid] = useState(false)
  const [scenario, setScenario] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])

  const twoD = config.dimensionality === '2d'

  const pushRow = useCallback(() => {
    spaceRows.r1.push(Uint8Array.from(engine.layer1))
    spaceRows.r2.push(Uint8Array.from(engine.layer2))
    recordRows.push(Uint32Array.from(engine.recycledCount))
    if (spaceRows.r1.length > SPACE_ROWS_CAP) {
      spaceRows.r1.splice(0, spaceRows.r1.length - SPACE_ROWS_CAP)
      spaceRows.r2.splice(0, spaceRows.r2.length - SPACE_ROWS_CAP)
      recordRows.splice(0, recordRows.length - SPACE_ROWS_CAP)
    }
  }, [engine])

  const resetAuxData = useCallback(() => {
    spaceRows.r1 = [Uint8Array.from(engine.layer1)]
    spaceRows.r2 = [Uint8Array.from(engine.layer2)]
    recordRows.length = 0
    recordRows.push(Uint32Array.from(engine.recycledCount))
    stampGuard.stamped = false
    // The analysis trace belongs to a single run — a reinit starts a new one.
    analysisTrace.rows.length = 0
  }, [engine])

  // Mount: apply a URL-encoded config if the link carries one (pasting a link
  // reconstructs that exact state); an explicit load request from the Results
  // tab is a newer in-app action and wins. setState here runs after hydration
  // (effects never run during hydration), so it re-renders without mismatch.
  useEffect(() => {
    const fromUrl = decodeConfigFromSearch(window.location.search)
    if (fromUrl.ok) {
      engine.updateConfig(fromUrl.config)
    } else if (fromUrl.reason === 'newer-version') {
      // Defer one tick: the Toaster subscribes its store listener later in
      // this same commit flush (it renders after {children} in the layout),
      // so dispatching synchronously here would update the store with nobody
      // listening — the toast would silently never render.
      setTimeout(() => {
        toast({
          title: 'Link not loaded',
          description:
            'This link uses a newer config format than this app supports — defaults were loaded instead.',
        })
      }, 0)
    }
    if (loadRequest) engine.updateConfig({ ...loadRequest.config })
    resetAuxData()
    // A fresh mount starts with the analysis card closed — re-sync the
    // module-scope guard (it survives remounts by design).
    analysisTrace.mode = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time application of the URL/load-request config on mount (a lazy initializer would read window during the SSR render and mismatch)
    setConfig({ ...engine.config })
    try {
      const raw = window.localStorage.getItem(LOG_KEY)
      if (raw) {
        setLog(JSON.parse(raw))
      }
    } catch { /* ignore */ }
  }, [engine, resetAuxData, loadRequest, toast])

  // Keep the URL in sync on mount and on every applied config change
  // (replaceState — configuring is not navigation; the back button stays
  // meaningful).
  useEffect(() => {
    syncConfigUrl(config)
  }, [config])

  // Stamp the run when it reaches a terminal/censored state (called from
  // step contexts, not from effects).
  const maybeStamp = useCallback((eng: RecyclingCA) => {
    const s = eng.lastStepStats
    if (!s) return
    if (s.outcome === 'running') {
      stampGuard.stamped = false
      return
    }
    if (stampGuard.stamped) return
    stampGuard.stamped = true
    const entry: LogEntry = { ...eng.summary(), stampedAt: new Date().toISOString() }
    setLog((prev) => [entry, ...prev].slice(0, 200))
  }, [])

  // ── Config changes ─────────────────────────────────────────────────────────
  const updateConfig = useCallback(
    (partial: Partial<CAConfig>) => {
      engine.updateConfig(partial)
      // Re-project React's config copy from the engine — the source of
      // truth. The engine may normalize beyond `partial`: switching
      // dimensionality without matching rules falls back to the family
      // default, and size/densities are clamped to sane bounds.
      setConfig({ ...engine.config })
      const reiniting =
        partial.dimensionality !== undefined || partial.size !== undefined ||
        partial.boundary !== undefined || partial.seed !== undefined ||
        partial.density1 !== undefined || partial.density2 !== undefined ||
        partial.initMode !== undefined
      if (reiniting) {
        resetAuxData()
        setRunning(false)
        setTick((t) => t + 1)
      } else {
        stampGuard.stamped = false
        setTick((t) => t + 1)
      }
    },
    [engine, resetAuxData],
  )

  const applyScenario = useCallback(
    (name: string) => {
      const s = SCENARIOS.find((x) => x.name === name)
      if (!s) return
      updateConfig(s.config)
    },
    [updateConfig],
  )

  const copyLink = useCallback(() => {
    const url = window.location.href
    const ok = () =>
      toast({
        title: 'Link copied',
        description: 'The URL now encodes this exact configuration — paste it anywhere to reopen this state.',
      })
    const fail = () => toast({ title: 'Copy this link', description: url })
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(ok).catch(fail)
    } else {
      fail()
    }
  }, [toast])

  const doStep = useCallback(
    (n = 1) => {
      for (let i = 0; i < n; i++) {
        if (engine.terminal || engine.outcome === 'censored') break
        engine.step()
        pushRow()
        pushAnalysisRow(engine)
      }
      maybeStamp(engine)
      setTick(engine.stepIndex)
    },
    [engine, pushRow, maybeStamp],
  )

  const doReset = useCallback(() => {
    engine.reinit()
    setRunning(false)
    resetAuxData()
    setTick((t) => t + 1)
  }, [engine, resetAuxData])

  // ── Analysis panel (linear complexity) ─────────────────────────────────────
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const onAnalysisOpenChange = useCallback((open: boolean) => {
    // Opening the panel starts a FRESH trace (past steps were not recorded);
    // closing stops recording. The engine itself is never touched.
    analysisTrace.mode = open
    analysisTrace.rows.length = 0
    setAnalysisOpen(open)
  }, [])

  const doRandomize = useCallback(() => {
    const seed = Math.floor(Math.random() * 100000) + 1
    setConfig((prev) => ({ ...prev, seed }))
    engine.reinit({ seed })
    setRunning(false)
    resetAuxData()
    setTick((t) => t + 1)
  }, [engine, resetAuxData])

  // ── Play loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const frame = (now: number) => {
      const eng = getEngine()
      if (turbo) {
        const t0 = performance.now()
        let n = 0
        while (
          !eng.terminal && eng.outcome !== 'censored' &&
          performance.now() - t0 < 12 && n < 600
        ) {
          eng.step()
          pushAnalysisRow(eng)
          n++
        }
        if (!twoD) {
          for (let i = 0; i < Math.min(n, SPACE_ROWS_CAP); i++) pushRow()
        }
      } else {
        acc += ((now - last) / 1000) * speed
        let n = Math.min(Math.floor(acc), 250)
        acc -= Math.floor(acc)
        while (n-- > 0 && !eng.terminal && eng.outcome !== 'censored') {
          eng.step()
          if (!twoD) pushRow()
          pushAnalysisRow(eng)
        }
      }
      last = now
      maybeStamp(eng)
      setTick(eng.stepIndex)
      if (eng.terminal || eng.outcome === 'censored') {
        setRunning(false)
      } else {
        raf = requestAnimationFrame(frame)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running, speed, turbo, twoD, pushRow, maybeStamp])

  // Persist the run log.
  useEffect(() => {
    try {
      window.localStorage.setItem(LOG_KEY, JSON.stringify(log))
    } catch { /* ignore */ }
  }, [log])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') {
        e.preventDefault()
        setRunning((r) => !r)
      } else if (e.key === 's') {
        doStep(1)
      } else if (e.key === 'r') {
        doReset()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doStep, doReset])

  // ── Exports ────────────────────────────────────────────────────────────────
  const exportJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      engine: 'RecyclingCA v1 (single source of truth)',
      entries: log,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `recycling-ca-runs-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [log])

  const exportPng = useCallback(() => {
    const eng = getEngine()
    const s = eng.config.size
    const scale = Math.max(3, Math.floor(360 / s))
    const headerH = 64
    const gap = 14
    const l1c = twoD ? makeGridCanvas(eng.layer1, s, C_L1) : makeSpaceCanvas(spaceRows.r1, s, C_L1)
    const l2c = twoD ? makeGridCanvas(eng.layer2, s, C_L2) : makeSpaceCanvas(spaceRows.r2, s, C_L2)
    const mapC = twoD
      ? makeOverlayCanvas(eng.layer1, eng.layer2, s)
      : makeOverlaySpaceCanvas(spaceRows.r1, spaceRows.r2, s)
    const drawH = Math.max(l1c.height, l2c.height, mapC.height)
    const out = document.createElement('canvas')
    out.width = 3 * s * scale + 2 * gap + 32
    out.height = headerH + drawH * scale + 110
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#09090b'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#f4f4f5'
    ctx.font = '600 20px system-ui, sans-serif'
    ctx.fillText('Recycling CA — three-layer workbench', 16, 30)
    ctx.fillStyle = '#a1a1aa'
    ctx.font = '12px ui-monospace, monospace'
    const line1 = `${eng.config.dimensionality.toUpperCase()} · L1 ${eng.config.rule1} · L2 ${eng.config.rule2} · ` +
      `${eng.config.direction === 'none' ? 'uncoupled' : `${eng.config.topology}/${eng.config.collision} ${eng.config.direction}`} · ` +
      `seed ${eng.config.seed} · ${outcomeLabel(eng)}`
    ctx.fillText(line1, 16, 50)
    const draw = (c: HTMLCanvasElement, x: number, label: string, color: string) => {
      ctx.fillStyle = color
      ctx.font = '600 12px system-ui, sans-serif'
      ctx.fillText(label, x, headerH + 4)
      ctx.drawImage(c, x, headerH + 12, c.width * scale, c.height * scale)
      ctx.strokeStyle = '#27272a'
      ctx.strokeRect(x, headerH + 12, c.width * scale, c.height * scale)
    }
    const x0 = 16
    const x1 = x0 + s * scale + gap
    const x2 = x1 + s * scale + gap
    draw(l1c, x0, 'Layer 1', C_L1)
    draw(l2c, x1, 'Layer 2', C_L2)
    draw(mapC, x2, 'Layer 3 — overlay map', '#a1a1aa')
    ctx.fillStyle = '#71717a'
    ctx.font = '11px ui-monospace, monospace'
    const st = eng.lastStepStats
    ctx.fillText(
      `L1 ${st?.count1 ?? 0} · L2 ${st?.count2 ?? 0} · union ${st?.union ?? 0} · ` +
      `meanΔ/cell ${(st?.meanChange ?? 0).toFixed(4)} · entropy ${(st?.entropy ?? 0).toFixed(3)} · ` +
      `recycled ${eng.totals.recycled} (dropped ${eng.totals.dropped}, redirected ${eng.totals.redirected}, merged ${eng.totals.merged})`,
      16, out.height - 34,
    )
    // Provenance footer: config hash · seed · step — any snapshot can be
    // replayed exactly from this line alone.
    ctx.fillStyle = '#52525b'
    ctx.fillText(
      `config ${eng.summary().configHash} · seed ${eng.config.seed} · step ${eng.stepIndex}`,
      16, out.height - 14,
    )
    const a = document.createElement('a')
    a.href = out.toDataURL('image/png')
    a.download = `recycling-ca-snapshot-${Date.now()}.png`
    a.click()
  }, [twoD])

  const stampNow = useCallback(() => {
    const entry: LogEntry = { ...engine.summary(), stampedAt: new Date().toISOString() }
    setLog((prev) => [entry, ...prev].slice(0, 200))
  }, [engine])

  // ── Panels ─────────────────────────────────────────────────────────────────
  const painter1 = useCellPainter(engine, 1, config.size, twoD, () => setTick((t) => t + 1))
  const painter2 = useCellPainter(engine, 2, config.size, twoD, () => setTick((t) => t + 1))
  const stats = engine.lastStepStats
  const totalsSnap = useMemo(() => ({
    recycled: engine.totals.recycled,
    dropped: engine.totals.dropped,
    redirected: engine.totals.redirected,
    merged: engine.totals.merged,
  }), [tick])

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full shrink-0 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 lg:w-80">
        <Controls config={config} onChange={updateConfig} />
      </aside>

      {/* Main column */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Transport */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
          <Button
            size="sm"
            onClick={() => setRunning((r) => !r)}
            className="h-8 gap-1.5 bg-amber-500 text-zinc-950 hover:bg-amber-400"
            aria-label={running ? 'Pause' : 'Play'}
          >
            {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {running ? 'Pause' : 'Play'}
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => doStep(1)} aria-label="Single step">
            <SkipForward className="h-3.5 w-3.5" /> Step
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={doReset} aria-label="Reset with same seed">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={doRandomize} aria-label="New random seed">
            <Shuffle className="h-3.5 w-3.5" /> Randomise
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={copyLink} aria-label="Copy a link to this configuration">
            <Link2 className="h-3.5 w-3.5" /> Copy link
          </Button>
          <div className="ml-2 flex items-center gap-1.5">
            <Select value={scenario} onValueChange={(v) => { setScenario(''); applyScenario(v) }}>
              <SelectTrigger className="h-8 w-56 text-xs" aria-label="Load a scenario">
                <SelectValue placeholder="Scenarios…" />
              </SelectTrigger>
              <SelectContent>
                {SCENARIOS.map((s) => (
                  <SelectItem key={s.name} value={s.name} className="text-xs">
                    {s.name} <span className="text-muted-foreground">— {s.note}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-2 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
            <Label htmlFor="turbo" className="text-xs text-zinc-400">Turbo</Label>
            <Switch id="turbo" checked={turbo} onCheckedChange={setTurbo} aria-label="Turbo mode" />
          </div>
          <div className="ml-auto flex w-44 items-center gap-2">
            <Label className="text-[11px] text-zinc-500">Speed</Label>
            <Slider
              value={[speed]} min={1} max={60} step={1}
              onValueChange={([v]) => setSpeed(v)}
              aria-label="Speed in steps per second"
              disabled={turbo}
            />
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-zinc-400">
              {turbo ? 'max' : `${speed}/s`}
            </span>
          </div>
          <p className="w-full text-[10px] text-zinc-600">
            Space = play/pause · S = step · R = reset · every config change is mirrored in the URL
            (Copy link shares it) · runs auto-pause at extinction, cycle detection, or the step cap.
          </p>
        </div>

        {/* Layers 1 & 2 */}
        <div className="flex flex-col gap-4 xl:flex-row">
          <LayerPane
            layer={1} rule={config.rule1} twoD={twoD} size={config.size}
            count={stats?.count1 ?? 0} grid={engine.layer1} rows={spaceRows.r1} painter={painter1}
            showGrid={showGrid && mapMode !== 'record'}
          />
          <LayerPane
            layer={2} rule={config.rule2} twoD={twoD} size={config.size}
            count={stats?.count2 ?? 0} grid={engine.layer2} rows={spaceRows.r2} painter={painter2}
            showGrid={showGrid && mapMode !== 'record'}
          />
        </div>

        {/* Layer 3 — the map (read-only viewport) */}
        <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <header className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <MapIcon className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
              <h3 className="text-sm font-semibold text-zinc-200">Layer 3 — the map</h3>
              <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                read-only viewport
              </span>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {(['split', 'overlay', 'record'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMapMode(m)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    mapMode === m
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
                  )}
                  aria-pressed={mapMode === m}
                >
                  {m === 'split' ? 'Side by side' : m === 'overlay' ? '4-state overlay' : 'Recycled record'}
                </button>
              ))}
              {twoD && (
                <button
                  onClick={() => setShowGrid((g) => !g)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    showGrid
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
                  )}
                  aria-pressed={showGrid}
                >
                  Grid lines
                </button>
              )}
            </div>
          </header>
          {mapMode === 'record' ? (
            <div aria-label="Recycled-birth record heatmap">
              {twoD ? (
                <RecordImage counts={engine.recycledCount} size={config.size} />
              ) : (
                <RecordSpaceImage rows={recordRows} width={config.size} />
              )}
            </div>
          ) : mapMode === 'split' ? (
            <div className="flex items-stretch gap-0" aria-label="Layer 1 and Layer 2 side by side">
              <div className="min-w-0 flex-1">
                {twoD
                  ? <GridImage grid={engine.layer1} size={config.size} color={C_L1} showGrid={showGrid} />
                  : <SpaceImage rows={spaceRows.r1} width={config.size} color={C_L1} />}
              </div>
              <div className="w-1 shrink-0 bg-gradient-to-b from-amber-500/70 via-zinc-600 to-teal-400/70" aria-hidden />
              <div className="min-w-0 flex-1">
                {twoD
                  ? <GridImage grid={engine.layer2} size={config.size} color={C_L2} showGrid={showGrid} />
                  : <SpaceImage rows={spaceRows.r2} width={config.size} color={C_L2} />}
              </div>
            </div>
          ) : (
            twoD
              ? <OverlayImage l1={engine.layer1} l2={engine.layer2} size={config.size} />
              : <OverlaySpaceImage rows1={spaceRows.r1} rows2={spaceRows.r2} width={config.size} />
          )}
          {mapMode === 'record' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
              <span>Recycled-birth record — per-cell count of delivered recycled births (recycled + redirected), log-scaled viridis heat, cumulative since init.</span>
              <span className="ml-auto">
                In seed1 mode with a passive Layer 2 rule this is a picture of Layer 1’s history: every cell that has ever died there, weighted by how many times.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: C_L1 }} /> L1 only</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: C_L2 }} /> L2 only</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: '#f4f4f5' }} /> both (coexistence)</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm border border-zinc-700" style={{ background: '#101014' }} /> empty</span>
              <span className="ml-auto">The overlay is the analytical 4-state view (s1, s2) — a projection, not a dynamical layer.</span>
            </div>
          )}
        </section>

        {/* Stats */}
        <StatsPanel
          stats={stats} config={config} tick={tick} totals={totalsSnap} history={engine.history}
          analysis={{ open: analysisOpen, onOpenChange: onAnalysisOpenChange, rows: analysisTrace.rows }}
        />

        {/* Run log */}
        <RunLog
          entries={log}
          onStamp={stampNow}
          onClear={() => setLog([])}
          onExportJson={exportJson}
          onExportPng={exportPng}
          canStamp={engine.stepIndex > 0}
        />

        <footer className="flex items-center gap-2 pb-6 text-[11px] text-zinc-600">
          <Layers className="h-3.5 w-3.5" aria-hidden />
          One tested TypeScript engine drives this GUI and the batch experiments —
          the workbench is a view, the engine is the experiment.
        </footer>
      </div>
    </div>
  )
}
