'use client'

// Phase 3 results: the phase diagram (extinction vs cycling as a function of
// recycling topology and initial density), outcome mixes, the three-way
// coupled-vs-uncoupled comparison, and the honest findings text.

import { useEffect, useMemo, useState } from 'react'
import {
  comboLabel, loadExperiments, type ConfigResult, type ExperimentsFile,
} from '@/lib/ca/experiments'
import type { CAConfig } from '@/lib/ca/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ArrowUpRight, FlaskConical } from 'lucide-react'

const SERIES_COLORS = [
  '#fbbf24', '#2dd4bf', '#f472b6', '#a3e635', '#c084fc', '#fb923c',
]
const BASE_COLORS = { l1: '#a1a1aa', l2: '#e879f9' }
/** Baseline series on the activity chart. The engine reports activity
 * jointly (meanChange = flips across BOTH layers / 2N), so the uncoupled
 * baseline there is the joint activity of the two independent layers —
 * NOT "L1 alone" (per-layer extinction fractions remain per-layer on the
 * extinction chart, where the labels are accurate). */
const BASE_JOINT = 'uncoupled layers (joint)'

function ChartCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      {sub && <p className="mb-2 text-[11px] text-zinc-500">{sub}</p>}
      <div className="h-64">{children}</div>
    </div>
  )
}

const tooltipStyle = {
  contentStyle: { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 11 },
  labelStyle: { color: '#a1a1aa' },
}

export function ResultsTab({ onOpenInWorkbench }: { onOpenInWorkbench: (config: CAConfig) => void }) {
  const [data, setData] = useState<ExperimentsFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [dim, setDim] = useState<'2d' | '1d'>('2d')
  const [pairIdx, setPairIdx] = useState(0)
  const [densityState, setDensity] = useState(0.3)

  useEffect(() => {
    let alive = true
    loadExperiments().then((d) => {
      if (alive) {
        setData(d)
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [])

  const dimConfigs = useMemo(
    () => (data ? data.configs.filter((c) => c.dim === dim) : []),
    [data, dim],
  )

  // Rule pairs and density grids differ per dimension — switching dimension
  // resets both selections instead of relying on the clamped fallbacks.
  const switchDim = (d: '2d' | '1d') => {
    if (d === dim) return
    setDim(d)
    setPairIdx(0)
    setDensity(0.3)
  }

  const pairs = useMemo(() => {
    const seen: string[] = []
    for (const c of dimConfigs) {
      const key = `${c.rule1}|${c.rule2}`
      if (!seen.includes(key)) seen.push(key)
    }
    return seen
  }, [dimConfigs])

  const activePair = pairs[Math.min(pairIdx, Math.max(0, pairs.length - 1))] ?? ''
  const [r1, r2] = activePair.split('|')

  const pairConfigs = useMemo(
    () => dimConfigs.filter((c) => c.rule1 === r1 && c.rule2 === r2),
    [dimConfigs, r1, r2],
  )

  const coupled = useMemo(
    () => pairConfigs.filter((c) => c.direction === 'forward'),
    [pairConfigs],
  )
  const densities = useMemo(
    () => [...new Set(pairConfigs.map((c) => c.density))].sort((a, b) => a - b),
    [pairConfigs],
  )

  // Effective density: keep the selected one when valid, else pick a default.
  const density = densities.includes(densityState)
    ? densityState
    : (densities[1] ?? densities[0] ?? 0.3)

  const baseline = useMemo(
    () => pairConfigs.find((c) => c.direction === 'none' && Math.abs(c.density - density) < 1e-9),
    [pairConfigs, density],
  )

  // Chart 1 + 2 data: one point per density per series.
  const extinctionData = useMemo(() => {
    return densities.map((d) => {
      const row: Record<string, number | string> = { density: d }
      for (const c of coupled.filter((x) => Math.abs(x.density - d) < 1e-9)) {
        row[comboLabel(c)] = +(c.agg.extinctFrac * 100).toFixed(1)
      }
      const base = pairConfigs.find(
        (x) => x.direction === 'none' && Math.abs(x.density - d) < 1e-9)
      if (base) {
        row['L1 alone'] = +(base.agg.layer1ExtinctFrac * 100).toFixed(1)
        row['L2 alone'] = +(base.agg.layer2ExtinctFrac * 100).toFixed(1)
      }
      return row
    })
  }, [coupled, densities, pairConfigs])

  const activityData = useMemo(() => {
    return densities.map((d) => {
      const row: Record<string, number | string> = { density: d }
      for (const c of coupled.filter((x) => Math.abs(x.density - d) < 1e-9)) {
        row[comboLabel(c)] = +(c.agg.medianActivity * 1000).toFixed(2)
      }
      const base = pairConfigs.find(
        (x) => x.direction === 'none' && Math.abs(x.density - d) < 1e-9)
      if (base) {
        // Joint activity of the two uncoupled layers (see BASE_JOINT above).
        row[BASE_JOINT] = +(base.agg.medianActivity * 1000).toFixed(2)
      }
      return row
    })
  }, [coupled, densities, pairConfigs])

  const extinctionKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of extinctionData) {
      for (const k of Object.keys(row)) if (k !== 'density') keys.add(k)
    }
    return [...keys]
  }, [extinctionData])

  const activityKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of activityData) {
      for (const k of Object.keys(row)) if (k !== 'density') keys.add(k)
    }
    return [...keys]
  }, [activityData])

  const outcomeRows = useMemo(
    () => coupled.filter((c) => Math.abs(c.density - density) < 1e-9),
    [coupled, density],
  )

  const openConfig = (c: ConfigResult) => {
    if (!data) return
    const p = data.meta.byDim[c.dim]
    const cfg: CAConfig = {
      dimensionality: c.dim,
      size: p.size,
      boundary: 'toroidal',
      rule1: c.rule1,
      rule2: c.rule2,
      topology: c.topology === 'none' ? 'same' : c.topology,
      collision: c.collision === 'none' ? 'drop' : c.collision,
      direction: c.direction,
      seed: 1,
      density1: c.density,
      density2: c.density,
      initMode: 'both',
      sigma: 0,
      stochasticP: 1,
      maxSteps: Math.min(p.maxSteps, 3000),
    }
    onOpenInWorkbench(cfg)
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!data || data.configs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-10 text-center">
        <FlaskConical className="mx-auto h-10 w-10 text-zinc-700" aria-hidden />
        <h2 className="text-lg font-semibold text-zinc-200">Results are being computed</h2>
        <p className="text-sm leading-relaxed text-zinc-400">
          The batch sweep (two rule pairs × six recycling configurations × four densities ×
          100 seeds per configuration, plus uncoupled baselines) runs against the same engine
          as this workbench. Results appear here as soon as the analysis is written to{' '}
          <code className="font-mono text-xs text-teal-300">public/data/experiments.json</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Does recycling change the dynamics?</h2>
          <p className="text-sm text-zinc-400">
            {data.meta.seeds} seeds per configuration · grid {data.meta.byDim[dim].size}
            {dim === '2d' ? '×' + data.meta.byDim[dim].size : ''} toroidal · step cap{' '}
            {data.meta.byDim[dim].maxSteps} · seed protocol: both layers random at density.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {(['2d', '1d'] as const).map((d) => (
              <button
                key={d}
                onClick={() => switchDim(d)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  dim === d
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
                aria-pressed={dim === d}
              >
                {d === '2d' ? '2D Life-like' : '1D Elementary'}
              </button>
            ))}
          </div>
          {pairs.length > 1 && (
            <div className="flex items-center gap-1.5">
              {pairs.map((p, i) => (
                <button
                  key={p}
                  onClick={() => setPairIdx(i)}
                  className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                    i === pairIdx
                      ? 'border-teal-500/60 bg-teal-500/10 text-teal-300'
                      : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                  aria-pressed={i === pairIdx}
                >
                  {p.replace('|', ' → ')}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-zinc-500">density</Label>
            {densities.map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                  Math.abs(d - density) < 1e-9
                    ? 'border-zinc-400 bg-zinc-800 text-zinc-200'
                    : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                }`}
                aria-pressed={Math.abs(d - density) < 1e-9}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Findings */}
      {data.meta.findings && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
            Findings — stated honestly
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-200">
            {data.meta.findings}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Phase diagram — joint extinction probability"
          sub="% of runs where BOTH layers reach all-0, by initial density (baselines: each layer dying alone)"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={extinctionData} margin={{ top: 4, right: 8, bottom: 4, left: -14 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="density" tick={{ fill: '#71717a', fontSize: 10 }} stroke="#3f3f46" />
              <YAxis tick={{ fill: '#71717a', fontSize: 10 }} stroke="#3f3f46" unit="%" />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              {extinctionKeys.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={k === 'L1 alone' ? BASE_COLORS.l1 : k === 'L2 alone' ? BASE_COLORS.l2 : SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={k.includes('alone') ? 1.25 : 2}
                  strokeDasharray={k.includes('alone') ? '4 3' : undefined}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Steady-state activity"
          sub="median mean-change-per-cell over the final 100 steps (×10⁻³), averaged over both layers — 0 means frozen; baseline = the two uncoupled layers' joint activity"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={activityData} margin={{ top: 4, right: 8, bottom: 4, left: -14 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
              <XAxis dataKey="density" tick={{ fill: '#71717a', fontSize: 10 }} stroke="#3f3f46" />
              <YAxis tick={{ fill: '#71717a', fontSize: 10 }} stroke="#3f3f46" />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              {activityKeys.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={k === BASE_JOINT ? BASE_COLORS.l1 : SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={k === BASE_JOINT ? 1.25 : 2}
                  strokeDasharray={k === BASE_JOINT ? '4 3' : undefined}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Outcome mix at selected density */}
      <ChartCard
        title={`Outcome mix at initial density ${density}`}
        sub="fraction of runs ending extinct / in a detected limit cycle / still active at the step cap"
      >
        <div className="flex h-full flex-col justify-center gap-2">
          {outcomeRows.map((c) => {
            const ext = c.agg.extinctFrac * 100
            const cyc = c.agg.cycleFrac * 100
            const act = c.agg.activeFrac * 100
            return (
              <div key={c.id} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-zinc-300">{comboLabel(c)}</span>
                  <span className="font-mono text-zinc-500">
                    ext {ext.toFixed(0)}% · cycle {cyc.toFixed(0)}% · active {act.toFixed(0)}%
                  </span>
                </div>
                <div className="flex h-4 w-full overflow-hidden rounded border border-zinc-800">
                  <div className="bg-red-500/80" style={{ width: `${ext}%` }} title={`extinct ${ext}%`} />
                  <div className="bg-emerald-500/80" style={{ width: `${cyc}%` }} title={`cycle ${cyc}%`} />
                  <div className="bg-zinc-600/80" style={{ width: `${act}%` }} title={`active ${act}%`} />
                </div>
              </div>
            )
          })}
        </div>
      </ChartCard>

      {/* Three-way comparison */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-zinc-200">
            Three-way comparison at density {density}
          </p>
          <p className="text-[11px] text-zinc-500">
            Coupled systems must differ from BOTH uncoupled layers for the coupling to be
            non-decorative.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="py-2 pr-3 font-medium">System</th>
                <th className="py-2 pr-3 font-medium">Extinct</th>
                <th className="py-2 pr-3 font-medium">Median extinction step</th>
                <th className="py-2 pr-3 font-medium">Cycle detected</th>
                <th className="py-2 pr-3 font-medium">Median cycle length</th>
                <th className="py-2 pr-3 font-medium">Active @ cap</th>
                <th className="py-2 pr-3 font-medium">Median activity (×10⁻³)</th>
                <th className="py-2 pr-3 font-medium">Median final union density</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-zinc-300">
              {baseline && (
                <>
                  <tr>
                    <td className="py-2 pr-3 font-sans text-zinc-400">Layer 1 alone ({baseline.rule1})</td>
                    <td className="py-2 pr-3">{(baseline.agg.layer1ExtinctFrac * 100).toFixed(0)}%</td>
                    <td className="py-2 pr-3">{baseline.agg.medianLayer1ExtinctStep ?? '—'}</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 pr-3">{(baseline.agg.medianActivity * 1000).toFixed(2)}</td>
                    <td className="py-2 pr-3">—</td>
                    <td />
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 font-sans text-zinc-400">Layer 2 alone ({baseline.rule2})</td>
                    <td className="py-2 pr-3">{(baseline.agg.layer2ExtinctFrac * 100).toFixed(0)}%</td>
                    <td className="py-2 pr-3">{baseline.agg.medianLayer2ExtinctStep ?? '—'}</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 pr-3">—</td>
                    <td className="py-2 pr-3">{(baseline.agg.medianActivity * 1000).toFixed(2)}</td>
                    <td className="py-2 pr-3">—</td>
                    <td />
                  </tr>
                </>
              )}
              {outcomeRows.map((c, i) => (
                <tr key={c.id} className={i % 2 ? 'bg-zinc-950/30' : undefined}>
                  <td className="py-2 pr-3 font-sans">{comboLabel(c)} (coupled)</td>
                  <td className="py-2 pr-3">{(c.agg.extinctFrac * 100).toFixed(0)}%</td>
                  <td className="py-2 pr-3">{c.agg.medianExtinctStep ?? '—'}</td>
                  <td className="py-2 pr-3">{(c.agg.cycleFrac * 100).toFixed(0)}%</td>
                  <td className="py-2 pr-3">{c.agg.medianCycleLen ?? '—'}</td>
                  <td className="py-2 pr-3">{(c.agg.activeFrac * 100).toFixed(0)}%</td>
                  <td className="py-2 pr-3">{(c.agg.medianActivity * 1000).toFixed(2)}</td>
                  <td className="py-2 pr-3">{c.agg.medianUnionDensity.toFixed(3)}</td>
                  <td className="py-2">
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 gap-1 px-2 text-[11px] text-teal-300 hover:text-teal-200"
                      onClick={() => openConfig(c)}
                    >
                      <ArrowUpRight className="h-3 w-3" /> Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-zinc-600">
          Joint extinction of the coupled system requires both layers to hit all-0 — Layer 1
          keeps re-seeding Layer 2 while it still has deaths, so joint extinction is typically
          rarer than either layer dying alone. &ldquo;Active @ cap&rdquo; with stochastic recycling
          (random-empty topology or overwrite) means sustained non-equilibrium activity, not a
          failed measurement.
        </p>
      </div>

      <p className="pb-6 text-[11px] leading-relaxed text-zinc-600">
        Methodology: for every rule pair, topology, collision policy and density, the coupled
        system runs with unidirectional recycling; the uncoupled baseline runs the same two
        rules with the coupling off, from identical seeds and initial states. Under
        unidirectional coupling Layer 1&apos;s trajectory is provably identical to Layer 1 alone
        (asserted in the test suite), so the coupling contrast is carried by Layer 2 and the
        joint observables. {data.meta.note}
      </p>
    </div>
  )
}
