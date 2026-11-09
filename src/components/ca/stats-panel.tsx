'use client'

// Live observables (Phase 0.3): counts, union, mean change per cell, joint
// entropy, transfer event counters, cycle detector and extinction flag,
// plus trajectory charts.

import { useMemo, useState } from 'react'
import type { CAConfig, StepStats } from '@/lib/ca/types'
import { anfGrowthLevel, type AnfLevel, coverage, hiddenFraction, linearComplexityProfile } from '@/lib/ca/analysis'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const OUTCOME_STYLE: Record<string, { label: string; className: string }> = {
  running: { label: 'RUNNING', className: 'border-amber-500/50 bg-amber-500/10 text-amber-300' },
  extinct: { label: 'EXTINCT', className: 'border-red-500/50 bg-red-500/10 text-red-400' },
  cycle: { label: 'LIMIT CYCLE', className: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
  censored: { label: 'ACTIVE @ CAP', className: 'border-zinc-500/50 bg-zinc-500/10 text-zinc-300' },
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="font-mono text-sm" style={accent ? { color: accent } : undefined}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-500">{sub}</p>}
    </div>
  )
}

/** Analysis-trace handle (workbench-owned module buffer, see workbench.tsx):
 *  `rows` are per-step Layer-1 snapshots recorded only while `open` is true. */
export interface AnalysisTrace {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: Uint8Array[]
}

// ── Linear complexity card (Berlekamp–Massey) ────────────────────────────────

function LinearComplexityCard({ open, onOpenChange, rows, config }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: Uint8Array[]
  config: CAConfig
}) {
  const [profile, setProfile] = useState<{ n: number; L: number }[] | null>(null)

  const twoD = config.dimensionality === '2d'
  const cells = twoD ? config.size * config.size : config.size
  // Centre column: for 1D the centre cell; for 2D the cell at the grid centre.
  const centre = twoD
    ? (config.size >> 1) * config.size + (config.size >> 1)
    : config.size >> 1

  const handleOpenChange = (next: boolean) => {
    // The trace restarts on every (re)open — drop any stale plot with it.
    if (next) setProfile(null)
    onOpenChange(next)
  }

  const analyze = () => {
    // Only rows matching the current grid shape are usable (a size change
    // reinitializes and clears the trace, but guard anyway).
    const seqRows = rows.filter((r) => r.length === cells)
    if (seqRows.length < 2) {
      setProfile(null)
      return
    }
    const seq = new Uint8Array(seqRows.length)
    for (let i = 0; i < seqRows.length; i++) seq[i] = seqRows[i][centre]
    const L = linearComplexityProfile(seq)
    setProfile(Array.from(L, (v, i) => ({ n: i, L: v })))
  }

  const finalL = profile && profile.length > 0 ? profile[profile.length - 1].L : null
  const slope = profile && profile.length > 1 && finalL !== null ? finalL / (profile.length - 1) : null

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            Linear complexity (Berlekamp–Massey)
          </p>
          <p className="text-[10px] text-zinc-600">
            L(n) of the center column — flat = linear/periodic rule, slope ≈ ½ = chaotic
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {open && (
            <span className="font-mono text-[10px] text-emerald-400/80" aria-live="polite">
              recording · {rows.length} step{rows.length === 1 ? '' : 's'}
            </span>
          )}
          <button
            type="button"
            onClick={() => handleOpenChange(!open)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition-colors',
              open
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
            aria-pressed={open}
          >
            {open ? 'Close trace' : 'Open trace'}
          </button>
          {open && (
            <button
              type="button"
              onClick={analyze}
              disabled={rows.length < 2}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Analyze
            </button>
          )}
        </div>
      </div>
      {open && (
        profile && profile.length >= 2 ? (
          <div className="mt-2">
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={profile} margin={{ top: 2, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis dataKey="n" tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" />
                  <YAxis tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 11 }}
                    labelStyle={{ color: '#a1a1aa' }}
                  />
                  <Line type="stepAfter" dataKey="L" stroke="#38bdf8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="px-1 font-mono text-[10px] text-zinc-500">
              layer 1 · centre column · final L = {finalL} over {profile.length} samples · slope ≈ {slope !== null ? slope.toFixed(3) : '—'}
            </p>
          </div>
        ) : (
          <p className="mt-2 px-1 text-[11px] text-zinc-500">
            Run the CA for at least a few steps, then click Analyze.
          </p>
        )
      )}
    </div>
  )
}

// ── ANF degree growth card (1D rules) ───────────────────────────────────────

function AnfGrowthCard({ config }: { config: CAConfig }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<AnfLevel[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const oneD = config.dimensionality === '1d'

  // One level per frame slot: the t=10 level dominates the cost (~2 s in a
  // desktop JS engine), and yielding between levels keeps the button and
  // the table visibly alive instead of freezing for the whole run.
  const compute = async () => {
    if (!oneD || busy) return
    setBusy(true)
    setError(null)
    setRows([])
    const out: AnfLevel[] = []
    try {
      for (let t = 0; t <= 10; t++) {
        await new Promise((r) => setTimeout(r, 0))
        out.push(anfGrowthLevel(config.rule1, t))
        setRows([...out])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            ANF degree growth (Rule 30 analysis)
          </p>
          <p className="text-[10px] text-zinc-600">
            Algebraic normal form of Layer 1's centre cell ({config.rule1}) in its 2t+1-cell light cone — degree 1 ∀t = linear rule (W90), climbing degree = chaotic (W30)
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition-colors',
              open
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
            )}
            aria-pressed={open}
          >
            {open ? 'Hide' : 'Show'}
          </button>
          {open && (
            <button
              type="button"
              onClick={compute}
              disabled={!oneD || busy}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? `computing… t=${rows?.length ?? 0}/10` : 'Compute up to t=10 (takes ~10s)'}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-2">
          {!oneD ? (
            <p className="px-1 text-[11px] text-zinc-500">
              ANF growth is defined for 1D Wolfram rules — switch the dimensionality to 1D to use it.
            </p>
          ) : error ? (
            <p className="px-1 font-mono text-[11px] text-red-400">{error}</p>
          ) : rows && rows.length > 0 ? (
            <table className="w-full max-w-md border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="border-b border-zinc-800 px-2 py-1 font-normal">t</th>
                  <th className="border-b border-zinc-800 px-2 py-1 font-normal">degree</th>
                  <th className="border-b border-zinc-800 px-2 py-1 font-normal">monomials</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.t} className="text-zinc-300">
                    <td className="border-b border-zinc-900 px-2 py-0.5">{r.t}</td>
                    <td className="border-b border-zinc-900 px-2 py-0.5">{r.degree}</td>
                    <td className="border-b border-zinc-900 px-2 py-0.5">{r.monomials}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-1 text-[11px] text-zinc-500">
              Computes the centre cell's polynomial degree for every t up to 10 (2²¹ truth-table
              evaluations at t = 10). Pure analysis — the run is not touched.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function StatsPanel({
  stats, config, tick, totals, history, analysis,
}: {
  stats: StepStats | null
  config: CAConfig
  tick: number
  totals: { recycled: number; dropped: number; redirected: number; merged: number }
  history: StepStats[]
  analysis: AnalysisTrace
}) {
  const outcome = stats?.outcome ?? 'running'
  const style = OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.running
  const chartKey = Math.floor(tick / 3)

  const chartData = useMemo(() => {
    void chartKey
    const from = Math.max(0, history.length - 300)
    return history.slice(from).map((s) => ({
      step: s.step, L1: s.count1, L2: s.count2, union: s.union,
      change: +(s.meanChange * 100).toFixed(2),
    }))
  }, [chartKey, history])

  // Coverage & hidden fraction over the same window as the other charts.
  const covData = useMemo(() => {
    void chartKey
    const from = Math.max(0, history.length - 300)
    return history.slice(from).map((s) => ({
      step: s.step,
      cov: +(coverage(s) * 100).toFixed(1),
      hid: +(hiddenFraction(s) * 100).toFixed(1),
    }))
  }, [chartKey, history])

  const perLayer = config.dimensionality === '2d'
    ? `${config.size}×${config.size}` : `${config.size}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn('font-mono text-[11px]', style.className)}>
          {style.label}
        </Badge>
        <span className="font-mono text-xs text-zinc-400">
          step {stats?.step ?? 0} / {config.maxSteps}
        </span>
        {stats?.cycleJLen ? (
          <span className="font-mono text-[11px] text-emerald-300">
            ↻ cycle length {stats.cycleJLen}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-zinc-600">
          {config.dimensionality === '1d' ? '1D' : '2D'} · {perLayer} · {config.boundary}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Tile label="Layer 1" value={String(stats?.count1 ?? 0)} accent="#fbbf24" />
        <Tile label="Layer 2" value={String(stats?.count2 ?? 0)} accent="#2dd4bf" />
        <Tile label="Union" value={String(stats?.union ?? 0)} />
        <Tile label="Mean Δ/cell" value={(stats?.meanChange ?? 0).toFixed(4)} sub="both layers" />
        <Tile label="Entropy" value={(stats?.entropy ?? 0).toFixed(3)} sub="joint 4-state, bits" />
        <Tile
          label="Recycled"
          value={String(totals.recycled)}
          sub={`dropped ${totals.dropped} · redir ${totals.redirected} · merged ${totals.merged}`}
          accent="#a3e635"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Live cells over time
          </p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="step" tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" />
                <YAxis tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 11 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="L1" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="L2" stroke="#2dd4bf" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="union" stroke="#a1a1aa" strokeWidth={1} strokeDasharray="4 2" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Layer-overlap observables (analysis item 2) — live readouts */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 font-mono text-[11px] text-zinc-500">
            <span>
              Coverage:{' '}
              <span className="text-zinc-200">{stats ? coverage(stats).toFixed(2) : '—'}</span>
              <span className="ml-1 text-[9px] text-zinc-600">|L1 ∩ L2| / min</span>
            </span>
            <span>
              Hidden:{' '}
              <span className="text-zinc-200">{stats ? hiddenFraction(stats).toFixed(2) : '—'}</span>
              <span className="ml-1 text-[9px] text-zinc-600">|L1 ∩ L2| / union</span>
            </span>
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Mean change per cell (×100)
          </p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="step" tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" />
                <YAxis tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 11 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Line type="monotone" dataKey="change" stroke="#c084fc" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2">
          <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Coverage &amp; hidden fraction (%)
          </p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={covData} margin={{ top: 2, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                <XAxis dataKey="step" tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" />
                <YAxis domain={[0, 100]} tick={{ fill: '#71717a', fontSize: 9 }} stroke="#3f3f46" />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 11 }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="cov" name="coverage" stroke="#34d399" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="hid" name="hidden" stroke="#f472b6" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Analysis: Berlekamp–Massey linear complexity of the centre column */}
      <LinearComplexityCard
        open={analysis.open}
        onOpenChange={analysis.onOpenChange}
        rows={analysis.rows}
        config={config}
      />

      {/* Analysis: ANF degree growth (1D Wolfram rules, collapsed by default) */}
      <AnfGrowthCard config={config} />
    </div>
  )
}
