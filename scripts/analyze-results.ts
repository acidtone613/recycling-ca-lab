// ─────────────────────────────────────────────────────────────────────────────
// Analysis (Phase 3b): merge the JSONL run records into aggregates, mean
// trajectories, and the final experiments.json consumed by the Results tab.
//
//   bun scripts/analyze-results.ts            # writes public/data/experiments.json
//                                             // + results/experiment_results.json
//
// If scripts/results/findings.txt exists, its text is embedded as the honest
// findings statement.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import type { ConfigResult, ExperimentsFile } from '../src/lib/ca/experiments'
import type { Collision, Dimensionality, Topology } from '../src/lib/ca/types'

interface RunRecord {
  id: string
  seed: number
  steps: number
  // [outcome, extinctStep, extinct1Step, extinct2Step, cycleJLen, cycle1Len,
  //  cycle2Len, finalCount1, finalCount2, finalUnion, activityMean,
  //  activityLast100, recycled, dropped, redirected, merged, deaths1, deaths2]
  r: (number | null)[]
  t: number[][]
}

const IDX = {
  outcome: 0, extinctStep: 1, extinct1Step: 2, extinct2Step: 3,
  cycleJLen: 4, cycle1Len: 5, cycle2Len: 6, finalCount1: 7, finalCount2: 8,
  finalUnion: 9, activityMean: 10, activityLast100: 11, recycled: 12,
  dropped: 13, redirected: 14, merged: 15, deaths1: 16, deaths2: 17,
} as const

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(2)
}

function mean(nums: number[]): number {
  if (!nums.length) return 0
  return +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4)
}

// ── Load all run records ─────────────────────────────────────────────────────
// Every *.jsonl in scripts/results/partial is a shard written by
// run-experiments.ts; globbing (instead of hardcoding 2-shard filenames)
// means any shard count (e.g. --shard=0/3 … 2/3) is picked up too.
const partialDir = 'scripts/results/partial'
const files = existsSync(partialDir)
  ? readdirSync(partialDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => `${partialDir}/${f}`)
      .sort()
  : []
const records: RunRecord[] = []
let torn = 0
for (const f of files) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line) as RunRecord)
    } catch {
      torn++
    }
  }
}
console.log(`Loaded ${records.length} runs (${torn} torn lines skipped)`)

// ── Group by config id ───────────────────────────────────────────────────────
const byId = new Map<string, RunRecord[]>()
for (const rec of records) {
  const list = byId.get(rec.id) ?? []
  list.push(rec)
  byId.set(rec.id, list)
}

const SWEEP_SIZES: Record<Dimensionality, { size: number; maxSteps: number }> = {
  '2d': { size: 64, maxSteps: 1200 },
  '1d': { size: 128, maxSteps: 600 },
}

function cellsPerLayer(dim: Dimensionality, size: number): number {
  return dim === '2d' ? size * size : size
}

const configs: ConfigResult[] = []
for (const [id, runs] of [...byId.entries()].sort()) {
  // id: dim|r1|r2|topology|collision|fwd-or-base|dX
  const [dimS, r1, r2, topoS, collS, dirS, dS] = id.split('|')
  const dim = dimS as Dimensionality
  const spec = SWEEP_SIZES[dim]
  const cells = cellsPerLayer(dim, spec.size)
  const density = parseFloat(dS.slice(1))
  const baseline = dirS === 'base'

  const outcomeOf = (r: RunRecord) => r.r[IDX.outcome] as number
  const extinctRuns = runs.filter((r) => outcomeOf(r) === 1)
  const cycleRuns = runs.filter((r) => outcomeOf(r) === 2)
  const activeRuns = runs.filter((r) => outcomeOf(r) === 3)
  const l1Dead = runs.filter((r) => r.r[IDX.extinct1Step] !== null && r.r[IDX.extinct1Step] !== undefined)
  const l2Dead = runs.filter((r) => r.r[IDX.extinct2Step] !== null && r.r[IDX.extinct2Step] !== undefined)

  // Time-aligned mean trajectory. The runner samples every
  // stride = ceil(maxSteps/30) steps (plus a final catch-up sample), so a
  // run's k-th entry is NOT the same step across runs of different lengths
  // (the 1D extinction sweep ends anywhere between ~64 and 600 steps).
  // Instead, average per step-slot: slot k means step (k+1)·stride for every
  // run. Runs that ended before a slot are padded with their final value —
  // all-zeros for extinct runs (extinction is absorbing), the final sample
  // for cycled runs (the cycle repeats) — so each slot averages over ALL
  // runs of the configuration.
  const stride = Math.max(1, Math.ceil(spec.maxSteps / 30))
  const slots = Math.max(1, Math.min(30, Math.floor(spec.maxSteps / stride)))
  const meanTraj: number[][] = []
  for (let k = 0; k < slots; k++) {
    const step = (k + 1) * stride
    const pts = runs.map((r) => {
      const samples = r.t
      if (!samples.length) return null
      if (step <= r.steps && samples[k]) return samples[k]
      return outcomeOf(r) === 1 ? [0, 0, 0, 0] : samples[samples.length - 1]
    }).filter((p): p is number[] => !!p)
    if (!pts.length) continue
    meanTraj.push([
      Math.round(mean(pts.map((p) => p[0]))),
      Math.round(mean(pts.map((p) => p[1]))),
      Math.round(mean(pts.map((p) => p[2]))),
      mean(pts.map((p) => p[3])),
    ])
  }

  const unionDensity = (r: RunRecord) => +(((r.r[IDX.finalUnion] as number) ?? 0) / cells).toFixed(4)

  configs.push({
    id,
    dim,
    rule1: r1,
    rule2: r2,
    topology: baseline ? 'none' : (topoS as Topology),
    collision: baseline ? 'none' : (collS as Collision),
    direction: baseline ? 'none' : 'forward',
    density,
    seeds: runs.length,
    agg: {
      extinctFrac: +(extinctRuns.length / runs.length).toFixed(3),
      cycleFrac: +(cycleRuns.length / runs.length).toFixed(3),
      activeFrac: +(activeRuns.length / runs.length).toFixed(3),
      medianExtinctStep: median(extinctRuns.map((r) => r.r[IDX.extinctStep] as number)),
      medianCycleLen: median(cycleRuns.map((r) => r.r[IDX.cycleJLen] as number)),
      medianActivity: median(runs.map((r) => (r.r[IDX.activityLast100] as number) ?? 0)) ?? 0,
      medianUnionDensity: median(runs.map(unionDensity)) ?? 0,
      layer1ExtinctFrac: +(l1Dead.length / runs.length).toFixed(3),
      layer2ExtinctFrac: +(l2Dead.length / runs.length).toFixed(3),
      medianLayer1ExtinctStep: median(l1Dead.map((r) => r.r[IDX.extinct1Step] as number)),
      medianLayer2ExtinctStep: median(l2Dead.map((r) => r.r[IDX.extinct2Step] as number)),
      medianRecycledPerStep: baseline ? null : median(runs.map((r) => +(((r.r[IDX.recycled] as number) ?? 0) / Math.max(1, r.steps)).toFixed(3))),
      medianDroppedPerStep: baseline ? null : median(runs.map((r) => +(((r.r[IDX.dropped] as number) ?? 0) / Math.max(1, r.steps)).toFixed(3))),
    },
    runs: runs.map((r) => [
      r.seed, r.r[IDX.outcome] as number, r.steps,
      r.r[IDX.extinctStep] ?? -1, r.r[IDX.extinct1Step] ?? -1, r.r[IDX.extinct2Step] ?? -1,
      r.r[IDX.cycleJLen] ?? -1, r.r[IDX.cycle1Len] ?? -1, r.r[IDX.cycle2Len] ?? -1,
      r.r[IDX.activityLast100] ?? 0, unionDensity(r),
    ]),
    meanTraj,
  })
}

// ── Findings text (embedded if present) ─────────────────────────────────────
const findingsPath = 'scripts/results/findings.txt'
const findings = existsSync(findingsPath)
  ? readFileSync(findingsPath, 'utf8').trim()
  : '(Findings will be written after the numbers are inspected.)'

const out: ExperimentsFile = {
  meta: {
    generatedAt: new Date().toISOString(),
    seeds: 100,
    densities: [0.1, 0.3, 0.5, 0.7],
    byDim: {
      '2d': { size: 64, maxSteps: 1200, rulePairs: [['B3/S23', 'B3/S23'], ['B3/S23', 'B36/S23']] },
      '1d': { size: 128, maxSteps: 600, rulePairs: [['W90', 'W90'], ['W110', 'W90']] },
    },
    findings,
    note: 'Both layers start independently random at the given density (same seeds across coupled and baseline runs). All runs use toroidal boundaries; the engine is the same tested TypeScript module that powers the workbench.',
  },
  configs,
}

mkdirSync('public/data', { recursive: true })
// App payload: aggregates + mean trajectories (per-run arrays stripped).
const lean = {
  ...out,
  configs: configs.map(({ runs: _runs, ...rest }) => rest),
}
writeFileSync('public/data/experiments.json', JSON.stringify(lean))
// Full archive for the results/ folder.
mkdirSync('results', { recursive: true })
writeFileSync('results/experiment_results.json', JSON.stringify(out, null, 1))
console.log(`Wrote public/data/experiments.json (${configs.length} configs, lean) and results/experiment_results.json (full)`)

// ── Console summary for inspection ───────────────────────────────────────────
console.log('\n=== 2D summary (joint outcome %, by density) ===')
for (const pair of [['B3/S23', 'B3/S23'], ['B3/S23', 'B36/S23']] as [string, string][]) {
  console.log(`\n-- ${pair[0]} → ${pair[1]}`)
  for (const d of [0.1, 0.3, 0.5, 0.7]) {
    const rows = configs.filter((c) => c.dim === '2d' && c.rule1 === pair[0] && c.rule2 === pair[1] && c.density === d)
    for (const c of rows) {
      const label = c.direction === 'none'
        ? 'BASE  (L1-alone / L2-alone)'
        : `${c.topology.padEnd(13)} ${c.collision.padEnd(9)}`
      const ext = (c.agg.extinctFrac * 100).toFixed(0).padStart(3)
      const l1e = (c.agg.layer1ExtinctFrac * 100).toFixed(0).padStart(3)
      const l2e = (c.agg.layer2ExtinctFrac * 100).toFixed(0).padStart(3)
      const cyc = (c.agg.cycleFrac * 100).toFixed(0).padStart(3)
      const act = (c.agg.activeFrac * 100).toFixed(0).padStart(3)
      const actv = (c.agg.medianActivity * 1000).toFixed(1).padStart(6)
      const ud = c.agg.medianUnionDensity.toFixed(3)
      console.log(`  d=${d}  ${label}  joint-ext ${ext}%  L1dead ${l1e}%  L2dead ${l2e}%  cycle ${cyc}%  active ${act}%  act×10⁻³ ${actv}  unionρ ${ud}`)
    }
  }
}

console.log('\n=== 1D summary ===')
for (const d of [0.1, 0.3, 0.5, 0.7]) {
  const rows = configs.filter((c) => c.dim === '1d' && c.density === d && c.rule1 === 'W90' && c.rule2 === 'W90')
  for (const c of rows) {
    const label = c.direction === 'none' ? 'BASE' : `${c.topology.padEnd(13)} ${c.collision.padEnd(9)}`
    console.log(`  d=${d}  ${label}  joint-ext ${(c.agg.extinctFrac * 100).toFixed(0)}%  active ${(c.agg.activeFrac * 100).toFixed(0)}%  act×10⁻³ ${(c.agg.medianActivity * 1000).toFixed(1)}`)
  }
}
