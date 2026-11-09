// ─────────────────────────────────────────────────────────────────────────────
// Batch experiment runner (Phase 3) — drives the SAME engine as the GUI.
//
//   bun scripts/run-experiments.ts --benchmark            timing estimate
//   bun scripts/run-experiments.ts --dim=2d [--shard=0/2]   run (resumable)
//   (space-separated forms — `--dim 2d`, `--shard 0/2` — are accepted too)
//
// Sweep (2D): rule pairs {Life/Life, Life/HighLife} × topology {same, nearest,
// random} × collision {drop, overwrite} × density {0.1, 0.3, 0.5, 0.7},
// unidirectional coupling, 100 seeds, 64×64 torus. Baselines: the same rule
// pairs with coupling OFF (each layer then evolves independently, giving the
// L1-alone and L2-alone reference trajectories with identical seeds/inits).
//
// 1D baseline sweep: rule pairs {W90/W90, W110/W90} on a 128-cell ring.
//
// Output: JSONL (one compact record per run) in scripts/results/partial/,
// resumable — completed (configId, seed) pairs are skipped on re-run.
// ─────────────────────────────────────────────────────────────────────────────

import { RecyclingCA } from '../src/lib/ca/engine'
import type { CAConfig, Collision, Dimensionality, Topology } from '../src/lib/ca/types'
import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs'

const DENSITIES = [0.1, 0.3, 0.5, 0.7]
const TOPOLOGIES: Topology[] = ['same', 'nearest_empty', 'random_empty']
const COLLISIONS: Collision[] = ['drop', 'overwrite']
const SEEDS = 100

const SWEEP: Record<Dimensionality, {
  size: number
  maxSteps: number
  rulePairs: [string, string][]
}> = {
  '2d': { size: 64, maxSteps: 1200, rulePairs: [['B3/S23', 'B3/S23'], ['B3/S23', 'B36/S23']] },
  '1d': { size: 128, maxSteps: 600, rulePairs: [['W90', 'W90'], ['W110', 'W90']] },
}

interface SweepConfig {
  id: string
  cfg: CAConfig
}

function buildSweep(dim: Dimensionality): SweepConfig[] {
  const spec = SWEEP[dim]
  const out: SweepConfig[] = []
  const baseCfg: CAConfig = {
    dimensionality: dim,
    size: spec.size,
    boundary: 'toroidal',
    rule1: 'B3/S23',
    rule2: 'B3/S23',
    topology: 'same',
    collision: 'drop',
    direction: 'forward',
    seed: 1,
    density1: 0.3,
    density2: 0.3,
    initMode: 'both',
    sigma: 0,
    stochasticP: 1,
    maxSteps: spec.maxSteps,
  }
  for (const [r1, r2] of spec.rulePairs) {
    for (const density of DENSITIES) {
      // Coupled configs (unidirectional recycling). density1 = density2 = the
      // swept value: with initMode 'both' and equal densities this reproduces
      // the original both-layers-random init bit-for-bit.
      for (const topology of TOPOLOGIES) {
        for (const collision of COLLISIONS) {
          const id = `${dim}|${r1}|${r2}|${topology}|${collision}|fwd|d${density}`
          out.push({
            id,
            cfg: { ...baseCfg, rule1: r1, rule2: r2, topology, collision, density1: density, density2: density },
          })
        }
      }
      // Uncoupled baseline (both layers independent — gives L1-alone AND
      // L2-alone with the same seeds and initial states).
      out.push({
        id: `${dim}|${r1}|${r2}|none|none|base|d${density}`,
        cfg: { ...baseCfg, rule1: r1, rule2: r2, direction: 'none', density1: density, density2: density },
      })
    }
  }
  return out
}

interface RunRecord {
  id: string
  seed: number
  steps: number
  // [outcome, extinctStep, extinct1Step, extinct2Step, cycleJLen, cycle1Len,
  //  cycle2Len, finalCount1, finalCount2, finalUnion, activityMean,
  //  activityLast100, recycled, dropped, redirected, merged, deaths1, deaths2]
  r: (number | null)[]
  // Coarse trajectory, ~30 samples of [count1, count2, union, meanChange].
  t: number[][]
}

function runOne(sweep: SweepConfig, seed: number): RunRecord {
  const cfg: CAConfig = { ...sweep.cfg, seed }
  const ca = new RecyclingCA(cfg)
  ca.setHistoryEnabled(false)
  const stride = Math.max(1, Math.ceil(cfg.maxSteps / 30))
  const traj: number[][] = []
  let last: import('../src/lib/ca/types').StepStats | null = null
  while (!ca.terminal && ca.outcome !== 'censored') {
    last = ca.step()
    if (last.step % stride === 0) {
      traj.push([last.count1, last.count2, last.union, +last.meanChange.toFixed(4)])
    }
  }
  if (last && (traj.length === 0 || traj[traj.length - 1][0] !== last.count1 ||
      traj[traj.length - 1][1] !== last.count2)) {
    traj.push([last.count1, last.count2, last.union, +last.meanChange.toFixed(4)])
  }
  const s = ca.summary()
  const outcomeCode = { running: 0, extinct: 1, cycle: 2, censored: 3 }[s.outcome]
  return {
    id: sweep.id,
    seed,
    steps: s.stepsRun,
    r: [
      outcomeCode,
      s.extinctStep, s.extinct1Step, s.extinct2Step,
      s.cycleJ ? s.cycleJ.length : null,
      s.cycle1 ? s.cycle1.length : null,
      s.cycle2 ? s.cycle2.length : null,
      s.finalCount1, s.finalCount2, s.finalUnion,
      +s.activityMean.toFixed(4), +s.activityLast100.toFixed(4),
      s.totals.recycled, s.totals.dropped, s.totals.redirected, s.totals.merged,
      s.totals.deaths1, s.totals.deaths2,
    ],
    t: traj,
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const benchmark = args.includes('--benchmark')

/** Reads a flag value in either form: `--name=value` or `--name value`. */
function flagValue(name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

const dimArg = flagValue('--dim') ?? 'all'
if (dimArg !== '2d' && dimArg !== '1d' && dimArg !== 'all') {
  console.error(`Invalid --dim "${dimArg}" (expected 1d, 2d or all)`)
  process.exit(1)
}
const dim = dimArg as Dimensionality | 'all'
const shardArg = flagValue('--shard')
const shardMatch = shardArg ? /^(\d+)\/(\d+)$/.exec(shardArg) : null
if (shardArg && !shardMatch) {
  console.error(`Invalid --shard "${shardArg}" (expected k/n, e.g. 0/2)`)
  process.exit(1)
}
const shardIdx = shardMatch ? parseInt(shardMatch[1], 10) : 0
const shardCount = shardMatch ? parseInt(shardMatch[2], 10) : 1
if (shardIdx >= shardCount) {
  console.error(`Invalid --shard "${shardArg}" (k must be < n)`)
  process.exit(1)
}

const dims: Dimensionality[] = dim === 'all' ? ['2d', '1d'] : [dim]
const outDir = 'scripts/results/partial'
mkdirSync(outDir, { recursive: true })

if (benchmark) {
  console.log('Benchmarking (12 runs)…')
  const t0 = Date.now()
  let runs = 0
  let steps = 0
  for (const d of dims) {
    const sweep = buildSweep(d)
    const picks = [0, 7, 23, 31, Math.floor(sweep.length / 2), sweep.length - 1]
    for (const p of picks) {
      const s = sweep[p % sweep.length]
      const t1 = Date.now()
      const rec = runOne(s, 1)
      runs++
      steps += rec.steps
      console.log(`  ${s.id}: ${rec.steps} steps, outcome=${rec.r[0]} in ${Date.now() - t1}ms`)
    }
  }
  const totalMs = Date.now() - t0
  const perRun = totalMs / runs
  console.log(`\nAvg ${perRun.toFixed(0)} ms/run. Full sweep estimate:`)
  for (const d of dims) {
    const n = buildSweep(d).length * SEEDS
    console.log(`  ${d}: ${n} runs ≈ ${((n * perRun) / 1000 / 60).toFixed(1)} min single-thread`)
  }
  process.exit(0)
}

for (const d of dims) {
  const outFile = `${outDir}/${d}${shardCount > 1 ? `-shard${shardIdx}of${shardCount}` : ''}.jsonl`
  const done = new Set<string>()
  if (existsSync(outFile)) {
    for (const line of readFileSync(outFile, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as RunRecord
        done.add(`${rec.id}#${rec.seed}`)
      } catch { /* ignore torn lines */ }
    }
  }
  const sweep = buildSweep(d)
  const mine = sweep.filter((_, i) => i % shardCount === shardIdx)
  console.log(`[${d}] shard ${shardIdx}/${shardCount}: ${mine.length} configs, ` +
    `${done.size} runs already done → ${mine.length * SEEDS - done.size} to go`)

  const t0 = Date.now()
  let n = 0
  let buf: string[] = []
  for (const s of mine) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      if (done.has(`${s.id}#${seed}`)) continue
      const rec = runOne(s, seed)
      buf.push(JSON.stringify(rec))
      n++
      if (buf.length >= 25) {
        appendFileSync(outFile, buf.join('\n') + '\n')
        buf = []
      }
    }
    const mins = ((Date.now() - t0) / 60000).toFixed(1)
    console.log(`  ✓ ${s.id} (${mins} min elapsed)`)
  }
  if (buf.length) appendFileSync(outFile, buf.join('\n') + '\n')
  console.log(`[${d}] shard complete: ${n} runs written to ${outFile}`)
}
