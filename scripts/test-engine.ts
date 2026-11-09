// ─────────────────────────────────────────────────────────────────────────────
// Engine test suite (Phase 1.4) — run with: bun scripts/test-engine.ts
//
//  1. Uncoupled baselines vs independent naive references (ECA + Life-like,
//     both boundaries, known patterns: glider / blinker / block / beacon).
//  2. Conservation accounting for the recycling transfer (drop & overwrite).
//  3. Determinism (same seed ⇒ bit-identical rollouts).
//  4. Boundary handling (fixed vs toroidal) — engine vs naive references.
//  5. Transfer unit tests (hand-computed, every topology × collision).
//  6. Cycle detection & extinction.
//  7. L1-invariance theorem: with forward coupling, Layer 1's trajectory is
//     bit-identical to Layer 1 run alone.
//  8. Bidirectional channel, live config updates, rule parsing.
//  9. New features: init modes, per-layer densities, recycled record,
//     σ distance kernel, rule reliability (p), replicate boundary, URL.
// 10. Analysis observables: Berlekamp–Massey linear complexity (item 1),
//     coverage / hidden fraction + the coexistence observable (item 2),
//     ANF degree growth for 1D rules (item 3).
// ─────────────────────────────────────────────────────────────────────────────

import { RecyclingCA, defaultConfig } from '../src/lib/ca/engine'
import { isQuiescent, parseRule, ruleToString } from '../src/lib/ca/rules'
import type { CAConfig } from '../src/lib/ca/types'
import { decodeConfigFromSearch, urlRoundTrip } from '../src/lib/ca/url'
import {
  anfGrowth, anfGrowthLevel, coverage, hiddenFraction, linearComplexityProfile,
} from '../src/lib/ca/analysis'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function eqGrids(name: string, a: Uint8Array, b: number[][]): void {
  const H = b.length, W = b[0].length
  let ok = a.length === W * H
  if (ok) {
    for (let y = 0; y < H && ok; y++)
      for (let x = 0; x < W && ok; x++)
        if (a[y * W + x] !== b[y][x]) ok = false
  }
  check(name, ok, ok ? '' : 'grids differ')
}

// ── Naive references (deliberately literal, independent of the engine) ──────

function naiveLife2D(grid: number[][], B: number[], S: number[], toroidal: boolean): number[][] {
  const H = grid.length, W = grid[0].length
  const out: number[][] = []
  for (let y = 0; y < H; y++) {
    out.push(new Array(W).fill(0))
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let live = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          let ny = y + dy, nx = x + dx
          if (toroidal) {
            ny = ((ny % H) + H) % H
            nx = ((nx % W) + W) % W
          } else if (ny < 0 || ny >= H || nx < 0 || nx >= W) {
            continue
          }
          live += grid[ny][nx]
        }
      }
      const table = grid[y][x] === 1 ? S : B
      out[y][x] = table.includes(live) ? 1 : 0
    }
  }
  return out
}

function naiveECA(row: number[], code: number, toroidal: boolean): number[] {
  const N = row.length
  const out = new Array<number>(N).fill(0)
  for (let i = 0; i < N; i++) {
    const l = toroidal ? row[(i - 1 + N) % N] : i > 0 ? row[i - 1] : 0
    const r = toroidal ? row[(i + 1) % N] : i < N - 1 ? row[i + 1] : 0
    out[i] = (code >> ((l << 2) | (row[i] << 1) | r)) & 1
  }
  return out
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function gridFromEngine(ca: RecyclingCA, layer: 1 | 2): number[][] {
  const g = layer === 1 ? ca.layer1 : ca.layer2
  const s = ca.config.size
  const out: number[][] = []
  for (let y = 0; y < s; y++) {
    const row: number[] = []
    for (let x = 0; x < s; x++) row.push(g[y * s + x])
    out.push(row)
  }
  return out
}

function paint(ca: RecyclingCA, layer: 1 | 2, cells: [number, number][]): void {
  const s = ca.config.size
  for (const [x, y] of cells) ca.setCell(layer, y * s + x, 1)
}

function base(over: Partial<ReturnType<typeof defaultConfig>> = {}) {
  return { ...defaultConfig(), ...over }
}

const LIFE_B = [3], LIFE_S = [2, 3]
const HLIFE_B = [3, 6], HLIFE_S = [2, 3]

// ══════════════════════════════════════════════════════════════════════════
// 1. Uncoupled baselines
// ══════════════════════════════════════════════════════════════════════════
console.log('1. Uncoupled baselines')

{
  // 2D random init, Life vs HighLife, both boundaries — engine must reproduce
  // the naive reference exactly with the transfer disabled.
  for (const boundary of ['toroidal', 'fixed'] as const) {
    const ca = new RecyclingCA(base({
      dimensionality: '2d', size: 16, boundary, rule1: 'B3/S23', rule2: 'B36/S23',
      direction: 'none', seed: 42, density1: 0.5, density2: 0.5, initMode: 'both', maxSteps: 1000,
    }))
    ca.setCycleDetectionEnabled(false) // compare full trajectories
    let g1 = gridFromEngine(ca, 1)
    let g2 = gridFromEngine(ca, 2)
    let ok = true
    for (let t = 0; t < 40; t++) {
      g1 = naiveLife2D(g1, LIFE_B, LIFE_S, boundary === 'toroidal')
      g2 = naiveLife2D(g2, HLIFE_B, HLIFE_S, boundary === 'toroidal')
      ca.step()
      if (JSON.stringify(gridFromEngine(ca, 1)) !== JSON.stringify(g1)) { ok = false; break }
      if (JSON.stringify(gridFromEngine(ca, 2)) !== JSON.stringify(g2)) { ok = false; break }
    }
    check(`2D random init, Life/HighLife, ${boundary}: matches naive for 40 steps`, ok)
  }
}

{
  // Glider: exact displacement (+1, +1) after 4 steps on a fixed boundary.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 20, boundary: 'fixed', rule1: 'B3/S23', rule2: 'B3/S23',
    direction: 'none', initMode: 'empty', maxSteps: 100,
  }))
  paint(ca, 1, [[2, 2], [3, 3], [4, 3], [2, 4], [3, 4]]) // SE glider
  for (let t = 0; t < 4; t++) ca.step()
  const g = gridFromEngine(ca, 1)
  const want: number[][] = Array.from({ length: 20 }, () => new Array(20).fill(0))
  const cells: [number, number][] = [[3, 3], [4, 4], [5, 4], [3, 5], [4, 5]]
  for (const [x, y] of cells) want[y][x] = 1
  check('glider moves (+1,+1) after 4 steps', JSON.stringify(g) === JSON.stringify(want))
  // 40 more steps vs naive on the same trajectory.
  let ref = g
  let ok = true
  for (let t = 0; t < 40; t++) {
    ref = naiveLife2D(ref, LIFE_B, LIFE_S, false)
    ca.step()
    if (JSON.stringify(gridFromEngine(ca, 1)) !== JSON.stringify(ref)) { ok = false; break }
  }
  check('glider trajectory matches naive for 40 more steps (fixed boundary)', ok)
}

{
  // Blinker period 2, block fixed point, beacon period 2 (uncoupled).
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'empty', maxSteps: 100,
  }))
  paint(ca, 1, [[4, 3], [4, 4], [4, 5]]) // vertical blinker
  const before = JSON.stringify(gridFromEngine(ca, 1))
  ca.step(); ca.step()
  check('blinker returns after 2 steps', JSON.stringify(gridFromEngine(ca, 1)) === before)

  const cb = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'empty', maxSteps: 100,
  }))
  paint(cb, 1, [[3, 3], [4, 3], [3, 4], [4, 4]]) // block
  cb.step()
  check('block is a fixed point', JSON.stringify(gridFromEngine(cb, 1)) === JSON.stringify(gridFromEngine(cb, 1)) && cb.lastStepStats!.count1 === 4)

  const cc = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'empty', maxSteps: 100,
  }))
  paint(cc, 1, [[2, 2], [3, 2], [2, 3], [3, 3], [4, 4], [5, 4], [4, 5], [5, 5]]) // beacon
  const b0 = JSON.stringify(gridFromEngine(cc, 1))
  cc.step()
  const b1 = JSON.stringify(gridFromEngine(cc, 1))
  cc.step()
  check('beacon has period 2', b0 !== b1 && JSON.stringify(gridFromEngine(cc, 1)) === b0)
}

{
  // Edge blinker on a torus wraps and keeps period 2.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'empty', maxSteps: 100,
  }))
  paint(ca, 1, [[0, 3], [0, 4], [0, 5]]) // blinker on the left edge column
  const before = JSON.stringify(gridFromEngine(ca, 1))
  ca.step()
  check('edge blinker wraps on torus (count stays 3)', ca.lastStepStats!.count1 === 3)
  ca.step()
  check('edge blinker period 2 on torus', JSON.stringify(gridFromEngine(ca, 1)) === before)
}

{
  // 1D ECA vs naive, several rules and both boundaries, random init.
  for (const boundary of ['toroidal', 'fixed'] as const) {
    for (const code of [0, 30, 51, 90, 110, 184, 204]) {
      const ca = new RecyclingCA(base({
        dimensionality: '1d', size: 61, boundary, rule1: `W${code}`, rule2: `W${code}`,
        direction: 'none', seed: 7, density1: 0.5, density2: 0.5, initMode: 'both', maxSteps: 1000,
      }))
      ca.setCycleDetectionEnabled(false) // compare full trajectories
      let r1 = Array.from(ca.layer1)
      let r2 = Array.from(ca.layer2)
      let ok = true
      for (let t = 0; t < 50; t++) {
        r1 = naiveECA(r1, code, boundary === 'toroidal')
        r2 = naiveECA(r2, code, boundary === 'toroidal')
        ca.step()
        if (JSON.stringify(Array.from(ca.layer1)) !== JSON.stringify(r1)) { ok = false; break }
        if (JSON.stringify(Array.from(ca.layer2)) !== JSON.stringify(r2)) { ok = false; break }
        if (ca.terminal) break
      }
      check(`ECA W${code}, ${boundary}: matches naive for 50 steps`, ok)
    }
  }
}

{
  // Canonical ECA facts.
  const mk = (code: number, cells: number[]) => {
    const ca = new RecyclingCA(base({
      dimensionality: '1d', size: 9, boundary: 'fixed', rule1: `W${code}`,
      rule2: `W${code}`, direction: 'none', initMode: 'empty', maxSteps: 10,
    }))
    for (const i of cells) ca.setCell(1, i, 1)
    return ca
  }
  const c90 = mk(90, [4]); c90.step()
  check('W90 single seed → cells at ±1 after 1 step',
    Array.from(c90.layer1).join('') === '000101000')
  const c51 = mk(51, [1, 3, 5])
  const init51 = Array.from({ length: 9 }, (_, i) => ([1, 3, 5].includes(i) ? 1 : 0))
  const wantComp = init51.map((v) => 1 - v).join('')
  c51.step()
  check('W51 complements every cell', Array.from(c51.layer1).join('') === wantComp)
  const c204 = mk(204, [0, 2, 5, 8]); c204.step()
  check('W204 is the identity', Array.from(c204.layer1).join('') === '101001001')
  const c0 = mk(0, [0, 1, 2, 3, 4, 5, 6, 7, 8]); c0.step()
  check('W0 kills everything in one step', c0.lastStepStats!.count1 === 0)
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Conservation accounting for the transfer
// ══════════════════════════════════════════════════════════════════════════
console.log('2. Conservation')

{
  // Overwrite (guaranteed delivery): every death yields exactly one birth
  // while Layer 2 has any empty cell; the transfer never destroys aliveness.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 12, boundary: 'toroidal', rule1: 'B3/S23', rule2: 'B3/S23',
    topology: 'same', collision: 'overwrite', direction: 'forward',
    seed: 99, density1: 0.4, density2: 0.4, initMode: 'both', maxSteps: 500,
  }))
  let okEvents = true, okAccounting = true, l2Full = false
  let prev = ca.lastStepStats!
  for (let t = 0; t < 60; t++) {
    const s = ca.step()
    if (s.count2 === 144) l2Full = true
    if (!l2Full) {
      if (s.dropped !== 0) { okEvents = false; break }
      if (s.recycled + s.redirected + s.merged !== s.deaths1) { okEvents = false; break }
    }
    // Total live cells change only via rule births/deaths + delivered births.
    // NOTE: `merged` is deliberately EXCLUDED from `want` — a merge only
    // fires when Layer 2 is entirely full (pickRandomEmpty returns −1
    // exactly then), so the origin is necessarily occupied and the birth is
    // absorbed into an already-live cell: a delivered event, but +0 cells.
    // The full-layer merge test in section 5 asserts this explicitly, and the
    // merge-regime check below asserts the identity while merges fire.
    const dTotal = (s.count1 + s.count2) - (prev.count1 + prev.count2)
    const want = (s.births1 - s.deaths1) + (s.births2 - s.deaths2) + s.recycled + s.redirected
    if (dTotal !== want) { okAccounting = false; break }
    prev = s
  }
  check('overwrite: dropped=0 and every death delivered (L2 never full here)', okEvents)
  check('overwrite: Δtotal = rule Δ + delivered births, every step', okAccounting)
}

{
  // Merge-regime conservation (audit 1.6, resolved correctly): force Layer 2
  // entirely full so that overwrite events MERGE, then assert the identity
  // while merges are observably firing.
  //
  // Why NOT `+ s.merged`: a merged event is a delivery into an already-live
  // cell — the engine writes nothing in that branch (see transfer(): the
  // merged path has no `target[...] = 1`), so it contributes +0 to dTotal.
  // Adding `merged` to `want` would make the identity WRONG by exactly the
  // number of merges: with one painted L1 cell per step, dTotal = −1 while
  // `want + merged` would compute 0. This block exists to keep the
  // accounting assertion honest in exactly the regime the audit worried
  // about — merges firing — instead of relying on them never firing.
  const liveCount = (ca: RecyclingCA, layer: 1 | 2) => {
    const g = layer === 1 ? ca.layer1 : ca.layer2
    let c = 0
    for (let i = 0; i < g.length; i++) c += g[i]
    return c
  }
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 6, boundary: 'toroidal',
    rule1: 'B/S', rule2: 'B/S012345678', // L1 all-die, L2 identity (stays full)
    topology: 'same', collision: 'overwrite', direction: 'forward',
    initMode: 'empty', maxSteps: 20,
  }))
  for (let i = 0; i < 36; i++) ca.setCell(2, i, 1) // Layer 2 entirely full
  let mergedSeen = 0
  let okAccounting = true
  for (let t = 0; t < 5; t++) {
    if (ca.terminal) break
    // One live L1 cell at a fresh position each step: it dies (all-die rule)
    // and, with L2 full, the birth merges at the occupied origin — nothing
    // is written, nothing is counted, delivery is absorbed.
    ca.setCell(1, t * 7 + 2, 1)
    const b1 = liveCount(ca, 1), b2 = liveCount(ca, 2)
    const s = ca.step()
    mergedSeen += s.merged
    const dTotal = (s.count1 + s.count2) - (b1 + b2)
    const want = (s.births1 - s.deaths1) + (s.births2 - s.deaths2) + s.recycled + s.redirected
    if (dTotal !== want) { okAccounting = false; break }
  }
  check('overwrite merge regime: Δtotal = rule Δ + recycled + redirected (merged = +0 cells)',
    okAccounting && mergedSeen >= 3)
}

{
  // Drop policy: every event is delivered or dropped — nothing else.
  for (const topology of ['same', 'nearest_empty', 'random_empty'] as const) {
    const ca = new RecyclingCA(base({
      dimensionality: '2d', size: 12, boundary: 'toroidal', rule1: 'B3/S23', rule2: 'B3/S23',
      topology, collision: 'drop', direction: 'forward',
      seed: 5, density1: 0.5, density2: 0.5, initMode: 'both', maxSteps: 500,
    }))
    let ok = true
    for (let t = 0; t < 60; t++) {
      const s = ca.step()
      if (s.recycled + s.dropped !== s.deaths1) { ok = false; break }
    }
    check(`drop + ${topology}: recycled + dropped = deaths1 every step`, ok)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Determinism
// ══════════════════════════════════════════════════════════════════════════
console.log('3. Determinism')

{
  const cfg = base({
    dimensionality: '2d', size: 16, boundary: 'toroidal', rule1: 'B3/S23', rule2: 'B36/S23',
    topology: 'random_empty', collision: 'overwrite', direction: 'bidirectional',
    seed: 123, density1: 0.35, density2: 0.35, initMode: 'both', maxSteps: 500,
  })
  const a = new RecyclingCA(cfg)
  const b = new RecyclingCA({ ...cfg })
  let ok = true
  for (let t = 0; t < 80; t++) {
    const sa = a.step(), sb = b.step()
    if (sa.hashJ !== sb.hashJ || sa.count1 !== sb.count1 || sa.count2 !== sb.count2) { ok = false; break }
  }
  check('same seed + config ⇒ bit-identical rollout (max-RNG config)', ok)

  const c = new RecyclingCA({ ...cfg, seed: 124 })
  let diff = false
  for (let t = 0; t < 10; t++) {
    if (c.step().hashJ !== a.lastStepStats!.hashJ) { diff = true; break }
  }
  check('different seed ⇒ different trajectory', diff)
}

// ══════════════════════════════════════════════════════════════════════════
// 4. L1-invariance theorem (forward coupling leaves Layer 1 untouched)
// ══════════════════════════════════════════════════════════════════════════
console.log('4. L1 invariance')

{
  for (const [topology, collision] of [
    ['same', 'drop'], ['same', 'overwrite'], ['nearest_empty', 'drop'],
    ['random_empty', 'drop'], ['random_empty', 'overwrite'],
  ] as const) {
    const common = {
      dimensionality: '2d' as const, size: 16, boundary: 'toroidal' as const,
      rule1: 'B3/S23', rule2: 'B3/S23', seed: 77, density1: 0.3, density2: 0.3,
      initMode: 'both' as const, maxSteps: 500,
    }
    const coupled = new RecyclingCA(base({ ...common, topology, collision, direction: 'forward' }))
    const alone = new RecyclingCA(base({ ...common, direction: 'none' }))
    let ok = true
    for (let t = 0; t < 100; t++) {
      const s1 = coupled.step()
      const s2 = alone.step()
      if (s1.hash1 !== s2.hash1) { ok = false; break }
    }
    check(`forward coupling (${topology}+${collision}): L1 ≡ L1-alone`, ok)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 5. Transfer unit tests (hand-computed)
// ══════════════════════════════════════════════════════════════════════════
console.log('5. Transfer units')

function transferRig(over: Partial<ReturnType<typeof defaultConfig>>) {
  // rule1 = all-die (death mask = current L1), rule2 = identity (L2 unchanged
  // by its rule) — isolates the transfer operator completely.
  return new RecyclingCA(base({
    dimensionality: '2d', size: 5, boundary: 'toroidal',
    rule1: 'B/S', rule2: 'B/S012345678',
    topology: 'same', collision: 'drop', direction: 'forward',
    initMode: 'empty', maxSteps: 10, ...over,
  }))
}

{
  // same + drop, empty target
  const ca = transferRig({})
  paint(ca, 1, [[1, 1]])
  const s = ca.step()
  check('same+drop: birth at (1,1) when empty', ca.layer2[1 * 5 + 1] === 1)
  check('same+drop: recycled=1 dropped=0', s.recycled === 1 && s.dropped === 0)
}
{
  // same + drop, occupied target → collision dropped
  const ca = transferRig({})
  paint(ca, 1, [[1, 1]])
  paint(ca, 2, [[1, 1]])
  const s = ca.step()
  check('same+drop: occupied target → dropped', s.dropped === 1 && s.recycled === 0 && ca.lastStepStats!.count2 === 1)
}
{
  // same + overwrite, occupied target → redirected to the single empty cell
  const ca = transferRig({ collision: 'overwrite' })
  paint(ca, 1, [[2, 2]])
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) paint(ca, 2, [[x, y]]) // L2 full except…
  ca.setCell(2, 4 * 5 + 4, 0) // exactly one empty cell at (4,4)
  const s = ca.step()
  check('same+overwrite: redirected to the only empty cell',
    s.redirected === 1 && ca.layer2[4 * 5 + 4] === 1 && s.dropped === 0)
}
{
  // nearest_empty: origin occupied, N empty → lands North (scan order origin → N → NE → …)
  const ca = transferRig({ topology: 'nearest_empty' })
  paint(ca, 1, [[2, 2]])
  paint(ca, 2, [[2, 2]])
  const s = ca.step()
  check('nearest_empty: lands at North (first ring cell clockwise from N)',
    ca.layer2[1 * 5 + 2] === 1 && s.recycled === 1)
}
{
  // nearest_empty: origin + N occupied, NE empty → lands NE
  const ca = transferRig({ topology: 'nearest_empty' })
  paint(ca, 1, [[2, 2]])
  paint(ca, 2, [[2, 2], [2, 1]])
  const s = ca.step()
  check('nearest_empty: skips occupied N, lands NE',
    ca.layer2[1 * 5 + 3] === 1 && s.recycled === 1)
}
{
  // nearest_empty: no empty in ring → drop / redirect per collision policy
  const ca = transferRig({ topology: 'nearest_empty', collision: 'drop' })
  paint(ca, 1, [[2, 2]])
  for (const [x, y] of [[2, 2], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2], [1, 1]] as [number, number][])
    paint(ca, 2, [[x, y]])
  const s = ca.step()
  check('nearest_empty+drop: ring full → dropped', s.dropped === 1 && s.recycled === 0)
}
{
  // random_empty + drop: lands on an (empty) cell, exactly one birth
  const ca = transferRig({ topology: 'random_empty' })
  paint(ca, 1, [[0, 0]])
  const s = ca.step()
  check('random_empty: exactly one birth, delivered', s.recycled === 1 && ca.lastStepStats!.count2 === 1)
}
{
  // L2 entirely full + overwrite → merged at origin, no crash, nothing lost.
  // Accounting: a merged event is a delivery into an already-live cell —
  // it adds 0 to the total (Δtotal = rule Δ + recycled + redirected only).
  const ca = transferRig({ collision: 'overwrite' })
  paint(ca, 1, [[2, 2]])
  for (let i = 0; i < 25; i++) ca.setCell(2, i, 1)
  const beforeTotal = 1 + 25 // one L1 cell + a full 5×5 Layer 2
  const s = ca.step()
  check('overwrite with L2 full: merged, dropped=0', s.merged === 1 && s.dropped === 0 && ca.lastStepStats!.count2 === 25)
  const dTotal = (s.count1 + s.count2) - beforeTotal
  check('merged event adds 0 to the total (absorbed delivery)',
    dTotal === (s.births1 - s.deaths1) + (s.births2 - s.deaths2) + s.recycled + s.redirected)
}
{
  // L2 entirely full + drop → dropped
  const ca = transferRig({})
  paint(ca, 1, [[2, 2]])
  for (let i = 0; i < 25; i++) ca.setCell(2, i, 1)
  const s = ca.step()
  check('drop with L2 full: dropped', s.dropped === 1 && ca.lastStepStats!.count2 === 25)
}
{
  // 1D transfer: nearest_empty scans origin → left → right
  const ca = new RecyclingCA(base({
    dimensionality: '1d', size: 7, boundary: 'toroidal', rule1: 'W0', rule2: 'W204',
    topology: 'nearest_empty', collision: 'drop', direction: 'forward',
    initMode: 'empty', maxSteps: 10,
  }))
  ca.setCell(1, 3, 1)
  ca.setCell(2, 3, 1)
  ca.setCell(2, 2, 1) // left occupied → must land right (index 4)
  const s = ca.step()
  check('1D nearest_empty: origin & left occupied → lands right',
    ca.layer2[4] === 1 && s.recycled === 1)
}

// ══════════════════════════════════════════════════════════════════════════
// 6. Cycle detection & extinction
// ══════════════════════════════════════════════════════════════════════════
console.log('6. Cycles & extinction')

{
  // Uncoupled blinker → joint cycle of length 2.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'empty', maxSteps: 50,
  }))
  paint(ca, 1, [[4, 3], [4, 4], [4, 5]])
  while (ca.outcome === 'running' && ca.stepIndex < 50) ca.step()
  check('uncoupled blinker: joint cycle detected with length 2',
    ca.outcome === 'cycle' && ca.cycleJ !== null && ca.cycleJ.length === 2)
}
{
  // Coupled: blinker L1 + passive L2 rule (B/S012345678) + same/drop.
  // L2 accumulates the death positions, then the joint state settles into
  // the blinker's period-2 cycle.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', rule1: 'B3/S23',
    rule2: 'B/S012345678', topology: 'same', collision: 'drop',
    direction: 'forward', initMode: 'empty', maxSteps: 200,
  }))
  paint(ca, 1, [[4, 3], [4, 4], [4, 5]])
  while (ca.outcome === 'running' && ca.stepIndex < 200) ca.step()
  check('coupled blinker + passive L2: joint cycle of length 2',
    ca.outcome === 'cycle' && ca.cycleJ !== null && ca.cycleJ.length === 2,
    `outcome=${ca.outcome} cycle=${JSON.stringify(ca.cycleJ)}`)
}
{
  // Single cell, coupled: dies in L1 (seeds L2), L2 cell dies next step → extinct at step 2.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', rule1: 'B3/S23', rule2: 'B3/S23',
    topology: 'same', collision: 'drop', direction: 'forward',
    initMode: 'single1', maxSteps: 50,
  }))
  while (ca.outcome === 'running' && ca.stepIndex < 50) ca.step()
  check('coupled single cell: joint extinction at step 2',
    ca.outcome === 'extinct' && ca.extinctStep === 2,
    `outcome=${ca.outcome} extinctStep=${ca.extinctStep}`)
}
{
  // Uncoupled single cell → extinct at step 1; block → fixed point (cycle 1).
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'single1', maxSteps: 50,
  }))
  while (ca.outcome === 'running' && ca.stepIndex < 50) ca.step()
  check('uncoupled single cell: extinct at step 1', ca.outcome === 'extinct' && ca.extinctStep === 1)

  const cb = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'empty', maxSteps: 50,
  }))
  paint(cb, 1, [[3, 3], [4, 3], [3, 4], [4, 4]])
  while (cb.outcome === 'running' && cb.stepIndex < 50) cb.step()
  check('uncoupled block: fixed point (cycle length 1)',
    cb.outcome === 'cycle' && cb.cycleJ !== null && cb.cycleJ.length === 1)
}
{
  // Censoring at maxSteps.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 16, boundary: 'toroidal', rule1: 'B3/S23', rule2: 'B3/S23',
    topology: 'random_empty', collision: 'overwrite', direction: 'forward',
    seed: 3, density1: 0.4, density2: 0.4, initMode: 'both', maxSteps: 25,
  }))
  while (!ca.terminal && ca.outcome !== 'censored') ca.step()
  check('run censored at maxSteps', ca.outcome === 'censored' && ca.stepIndex === 25)
}

// ══════════════════════════════════════════════════════════════════════════
// 7. Bidirectional channel
// ══════════════════════════════════════════════════════════════════════════
console.log('7. Bidirectional')

{
  // L1 passive/empty, L2 single cell with all-die rule: the L2 death must be
  // recycled into L1 via the reverse channel.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 6, boundary: 'toroidal',
    rule1: 'B/S012345678', rule2: 'B/S', // L1 identity, L2 all-die
    topology: 'same', collision: 'drop', direction: 'bidirectional',
    initMode: 'empty', maxSteps: 10,
  }))
  ca.setCell(2, 2 * 6 + 2, 1)
  const s = ca.step()
  check('reverse channel: L2 death births into L1',
    ca.layer1[2 * 6 + 2] === 1 && s.recycledR === 1 && s.recycled === 0)
  const s2 = ca.step()
  check('reverse channel: settled (no further events)', s2.recycledR === 0 && s2.recycled === 0 && ca.lastStepStats!.count1 === 1)
}

// ══════════════════════════════════════════════════════════════════════════
// 8. Live config updates, reinit, rule parsing
// ══════════════════════════════════════════════════════════════════════════
console.log('8. Config & parsing')

{
  // Live rule change: state preserved, cycle detection reset.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', direction: 'none',
    initMode: 'empty', maxSteps: 100,
  }))
  paint(ca, 1, [[4, 3], [4, 4], [4, 5]])
  ca.step(); ca.step()
  check('blinker cycles before rule change', ca.cycleJ !== null)
  ca.updateConfig({ rule2: 'B36/S23' })
  check('live rule change keeps state & step index, clears detection',
    ca.stepIndex === 2 && ca.cycleJ === null && ca.lastStepStats!.count1 === 3)
  // Structural change resets.
  ca.updateConfig({ size: 12 })
  check('structural change resets the run', ca.stepIndex === 0 && ca.config.size === 12)
  // Reinit with the same seed reproduces the initial state.
  const ca2 = new RecyclingCA(base({
    dimensionality: '2d', size: 10, boundary: 'toroidal', seed: 55, density1: 0.4, density2: 0.4,
    initMode: 'both', maxSteps: 50,
  }))
  const initHash = ca2.lastStepStats!.hashJ
  ca2.step(); ca2.step(); ca2.reinit()
  check('reinit with same seed reproduces the initial state', ca2.lastStepStats!.hashJ === initHash)
}

{
  // Rule parsing round-trips and validation.
  const cases: [string, string][] = [
    ['B3/S23', 'B3/S23'], ['b36/s23', 'B36/S23'], ['B2/S', 'B2/S'],
    ['B3678/S34678', 'B3678/S34678'], ['W110', 'W110'], ['110', 'W110'],
    ['B/S012345678', 'B/S012345678'],
  ]
  for (const [input, want] of cases) {
    check(`parse "${input}" → "${want}"`, ruleToString(parseRule(input)) === want)
  }
  for (const bad of ['B9/S', 'W256', 'B3/S2a', 'xyz', 'B3', 'W']) {
    let threw = false
    try { parseRule(bad) } catch { threw = true }
    check(`invalid rule "${bad}" throws`, threw)
  }
  check('isQuiescent: B3/S23 yes', isQuiescent(parseRule('B3/S23')) === true)
  check('isQuiescent: B0/S no', isQuiescent(parseRule('B0/S')) === false)
  check('isQuiescent: W90 yes', isQuiescent(parseRule('W90')) === true)
  check('isQuiescent: W51 no (births from emptiness)', isQuiescent(parseRule('W51')) === false)
}

{
  // Stats sanity: union, entropy bounds, mean change bounds.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 10, boundary: 'toroidal', rule1: 'B3/S23', rule2: 'B3/S23',
    topology: 'random_empty', collision: 'overwrite', direction: 'forward',
    seed: 11, density1: 0.5, density2: 0.5, initMode: 'both', maxSteps: 100,
  }))
  let ok = true
  for (let t = 0; t < 30; t++) {
    const s = ca.step()
    const union = s.count1 + s.count2 - countBoth(ca)
    if (s.union !== union) { ok = false; break }
    if (s.entropy < 0 || s.entropy > 2.0000001) { ok = false; break }
    if (s.meanChange < 0 || s.meanChange > 1) { ok = false; break }
  }
  check('stats sanity: union consistency, entropy ∈ [0,2], meanChange ∈ [0,1]', ok)
}

function countBoth(ca: RecyclingCA): number {
  let both = 0
  for (let i = 0; i < ca.cellsPerLayer; i++) if (ca.layer1[i] === 1 && ca.layer2[i] === 1) both++
  return both
}

{
  // reinit() rejects structural/rule overrides — accepting them would
  // silently desynchronize config from buffers/parsed rules; updateConfig()
  // is the structural path.
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal', initMode: 'empty', maxSteps: 50,
  }))
  let threwSize = false
  try { ca.reinit({ size: 64 }) } catch { threwSize = true }
  check('reinit rejects structural override { size }', threwSize)
  let threwRule = false
  try { ca.reinit({ rule1: 'B36/S23' }) } catch { threwRule = true }
  check('reinit rejects rule override { rule1 }', threwRule)
  ca.reinit({ seed: 7, density1: 0.5, density2: 0.5 }) // init fields are accepted
  check('reinit accepts init-field overrides', ca.config.seed === 7 && ca.stepIndex === 0)

  // updateConfig({ dimensionality }) without matching rules falls back to
  // the family default instead of throwing.
  const cd = new RecyclingCA(base({
    dimensionality: '2d', size: 16, boundary: 'toroidal', rule1: 'B3/S23', rule2: 'B36/S23',
    initMode: 'empty', maxSteps: 50,
  }))
  cd.updateConfig({ dimensionality: '1d' })
  check('dimensionality switch without rules resets them to the family default',
    cd.config.dimensionality === '1d' && cd.config.rule1 === 'W90' && cd.config.rule2 === 'W90' &&
    cd.cellsPerLayer === cd.config.size)
  cd.updateConfig({ dimensionality: '2d' })
  check('switching back restores the 2D family default',
    cd.config.rule1 === 'B3/S23' && cd.config.rule2 === 'B3/S23' &&
    cd.cellsPerLayer === cd.config.size * cd.config.size)
  let threwMismatch = false
  try { cd.updateConfig({ dimensionality: '1d', rule1: 'B3/S23' }) } catch { threwMismatch = true }
  check('explicitly mismatched rules still throw a clear error', threwMismatch)

  // Config bounds: size and density are clamped for direct callers who
  // bypass the GUI's constrained controls.
  const ce = new RecyclingCA(base({
    dimensionality: '2d', size: 10000, density1: 2, density2: 2, initMode: 'both', maxSteps: 5,
  }))
  check('constructor clamps size to [2, 512] and densities to [0, 1]',
    ce.config.size === 512 && ce.config.density1 === 1 && ce.config.density2 === 1 && ce.cellsPerLayer === 512 * 512)
  ce.updateConfig({ size: 1, density1: -1, density2: -1 })
  check('updateConfig clamps too (size ≥ 2, densities ≥ 0)',
    ce.config.size === 2 && ce.config.density1 === 0 && ce.config.density2 === 0)
}

{
  // setCell clears extinction stamps conditionally: only the layers that
  // now have live cells. A layer that is still all-0 keeps its stamp —
  // redrawing the *other* layer after a per-layer extinction must not
  // erase this layer's record (audit 1.4).
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal',
    rule1: 'B/S', rule2: 'B/S012345678', // L1 all-die, L2 identity
    direction: 'none', seed: 9, density1: 0.5, density2: 0.5, initMode: 'both', maxSteps: 20,
  }))
  ca.step()
  check('per-layer extinction recorded (L1 all-die rule)', ca.summary().extinct1Step === 1)
  ca.setCell(1, 5, 1)
  const s = ca.summary()
  check('redraw in L1 clears the L1 stamp (joint was never extinct here)',
    s.extinct1Step === null && s.extinctStep === null)

  // Both layers all-die → joint + per-layer extinction. Redraw L1 ONLY:
  // the L1 and joint stamps must clear; L2's stamp must SURVIVE — L2 is
  // still all-0, so it is still extinct, and the record must say so.
  const cb = new RecyclingCA(base({
    dimensionality: '2d', size: 8, boundary: 'toroidal',
    rule1: 'B/S', rule2: 'B/S', direction: 'none',
    seed: 9, density1: 0.5, density2: 0.5, initMode: 'both', maxSteps: 20,
  }))
  cb.step()
  const sb0 = cb.summary()
  check('both layers die → joint and per-layer extinction recorded',
    sb0.extinctStep === 1 && sb0.extinct1Step === 1 && sb0.extinct2Step === 1)
  cb.setCell(1, 3, 1) // redraw in Layer 1 only — Layer 2 stays all-0
  const sb1 = cb.summary()
  check('redraw in L1: L1 + joint stamps clear, L2 stamp survives',
    sb1.extinct1Step === null && sb1.extinctStep === null && sb1.extinct2Step === 1)
  cb.step()
  check('after the redraw the run steps again (terminal outcome revived)',
    cb.stepIndex === 2)
}

// ══════════════════════════════════════════════════════════════════════════
// 9. New features: init modes, per-layer densities, recycled record,
//    σ distance kernel, rule reliability, replicate boundary, URL encoding
// ══════════════════════════════════════════════════════════════════════════
console.log('9. New features')

{
  // Init modes: exact layer coverage + per-layer densities.
  const counts = (ca: RecyclingCA) => [ca.lastStepStats!.count1, ca.lastStepStats!.count2] as const
  const mk = (initMode: CAConfig['initMode']) =>
    new RecyclingCA(base({
      dimensionality: '2d', size: 32, boundary: 'toroidal', direction: 'none',
      seed: 21, density1: 0.8, density2: 0.2, initMode, maxSteps: 10,
    }))
  const [c1b, c2b] = counts(mk('both'))
  const [c1s, c2s] = counts(mk('seed1'))
  const [c1S, c2S] = counts(mk('seed2'))
  check('init both: both layers seeded at their own densities',
    c1b > 1024 * 0.5 && c2b < 1024 * 0.4)
  check('init seed1: L1 seeded identically to both-mode, L2 empty',
    c1s === c1b && c2s === 0)
  // NB: seed2's L2 is seeded from the START of the RNG stream (no L1 draws
  // precede it), so it differs from both-mode's L2 — only its density matches.
  check('init seed2: L1 empty, L2 seeded at density2',
    c1S === 0 && c2S > 1024 * 0.1 && c2S < 1024 * 0.32)
  const c51 = mk('single1')
  check('init single1: exactly one centre cell in L1, L2 empty',
    c51.lastStepStats!.count1 === 1 && c51.lastStepStats!.count2 === 0 &&
    c51.layer1[16 * 32 + 16] === 1)
  const c52 = mk('single2')
  check('init single2: exactly one centre cell in L2, L1 empty',
    c52.lastStepStats!.count2 === 1 && c52.lastStepStats!.count1 === 0)
  const cE = mk('empty')
  check('init empty: both layers blank',
    cE.lastStepStats!.count1 === 0 && cE.lastStepStats!.count2 === 0)
}

{
  // Recycled record: per-cell counter of delivered recycled births —
  // recycled + redirected tallied, merged NOT, reverse channel NOT.
  const mkRecord = (over: Partial<CAConfig>) =>
    new RecyclingCA(base({
      dimensionality: '2d', size: 6, boundary: 'toroidal',
      rule1: 'B/S', rule2: 'B/S012345678', // L1 all-die, L2 identity
      topology: 'same', collision: 'overwrite', direction: 'forward',
      initMode: 'empty', maxSteps: 10, ...over,
    }))
  const caA = mkRecord({ collision: 'drop' })
  caA.setCell(1, 3 * 6 + 3, 1)
  const beforeA = caA.recycledCount[3 * 6 + 3]
  const sA = caA.step()
  check('record: recycled delivery tallied at the landing cell',
    sA.recycled === 1 && caA.recycledCount[3 * 6 + 3] === beforeA + 1)
  caA.reinit()
  check('record: reset by reinit', caA.recycledCount[3 * 6 + 3] === 0)

  const caB = mkRecord({})
  caB.setCell(1, 2 * 6 + 2, 1)
  for (let i = 0; i < 36; i++) caB.setCell(2, i, 1)
  caB.setCell(2, 0, 0) // exactly one empty cell at (0,0)
  const beforeB = caB.recycledCount[0]
  const sB = caB.step()
  check('record: redirected delivery tallied at the landing cell',
    sB.redirected === 1 && caB.layer2[0] === 1 && caB.recycledCount[0] === beforeB + 1)

  const caC = mkRecord({})
  caC.setCell(1, 2 * 6 + 2, 1)
  for (let i = 0; i < 36; i++) caC.setCell(2, i, 1) // L2 entirely full
  const beforeC = caC.recycledCount[2 * 6 + 2]
  const sC = caC.step()
  check('record: merged event writes nothing and tallies nothing',
    sC.merged === 1 && caC.recycledCount[2 * 6 + 2] === beforeC &&
    caC.lastStepStats!.count2 === 36)

  const caD = mkRecord({ rule1: 'B/S012345678', rule2: 'B/S', direction: 'bidirectional' })
  caD.setCell(2, 2 * 6 + 2, 1)
  const beforeD = caD.recycledCount[2 * 6 + 2]
  const sD = caD.step()
  check('record: reverse-channel births are NOT tallied (forward-only record)',
    sD.recycledR === 1 && sD.recycled === 0 && caD.layer1[2 * 6 + 2] === 1 &&
    caD.recycledCount[2 * 6 + 2] === beforeD)
}

{
  // σ distance kernel: determinism, clustering vs uniform, L1-invariance,
  // and delivery guarantees.
  const clusterStats = (sigma: number) => {
    const dists: number[] = []
    for (let seed = 1; seed <= 48; seed++) {
      const ca = new RecyclingCA(base({
        dimensionality: '2d', size: 24, boundary: 'toroidal',
        rule1: 'B/S', rule2: 'B/S012345678', // L1 all-die, L2 identity
        topology: 'random_empty', collision: 'drop', direction: 'forward',
        initMode: 'empty', seed, sigma, maxSteps: 5,
      }))
      ca.setCell(1, 12 * 24 + 12, 1) // single death at the centre
      ca.step()
      let landed = -1
      for (let i = 0; i < 24 * 24; i++) if (ca.layer2[i] === 1) { landed = i; break }
      if (landed < 0) continue
      const dx = Math.abs((landed % 24) - 12)
      const dy = Math.abs(Math.floor(landed / 24) - 12)
      dists.push(Math.hypot(Math.min(dx, 24 - dx), Math.min(dy, 24 - dy)))
    }
    return dists
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  const d2 = clusterStats(2)
  const d16 = clusterStats(16)
  check('σ = 2: recycled births cluster near the death site (mean dist < 6)',
    d2.length === 48 && mean(d2) < 6)
  check('σ = 16: approaches random_empty (mean ≫ σ=2, some landing beyond 8)',
    d16.length === 48 && mean(d16) > 2 * mean(d2) && Math.max(...d16) > 8)

  const mkSigma = (sigma: number, seed = 5) =>
    new RecyclingCA(base({
      dimensionality: '2d', size: 24, boundary: 'toroidal',
      rule1: 'B3/S23', rule2: 'B36/S23',
      topology: 'random_empty', collision: 'overwrite', direction: 'forward',
      initMode: 'seed1', seed, density1: 0.3, density2: 0.3, sigma, maxSteps: 100,
    }))
  const a = mkSigma(0)
  const b = mkSigma(0)
  let identical = true
  for (let t = 0; t < 20; t++) if (a.step().hashJ !== b.step().hashJ) { identical = false; break }
  check('σ = 0: deterministic (same seed ⇒ identical rollout)', identical)

  const invC = mkSigma(4, 77)
  const invA = new RecyclingCA(base({
    dimensionality: '2d', size: 24, boundary: 'toroidal',
    rule1: 'B3/S23', rule2: 'B36/S23', direction: 'none',
    initMode: 'seed1', seed: 77, density1: 0.3, density2: 0.3, maxSteps: 100,
  }))
  let okInv = true
  for (let t = 0; t < 30; t++) {
    if (invC.step().hash1 !== invA.step().hash1) { okInv = false; break }
  }
  check('σ > 0 with forward coupling: L1 still ≡ L1-alone (invariance survives)', okInv)

  const caG = new RecyclingCA(base({
    dimensionality: '2d', size: 24, boundary: 'toroidal',
    rule1: 'B3/S23', rule2: 'B/S012345678',
    topology: 'random_empty', collision: 'drop', direction: 'forward',
    initMode: 'seed1', seed: 11, density1: 0.3, density2: 0.3, sigma: 2, maxSteps: 60,
  }))
  let okDelivery = true
  let sawDeath = 0
  for (let t = 0; t < 60; t++) {
    const s = caG.step()
    sawDeath += s.deaths1
    if (s.dropped !== 0 && caG.lastStepStats!.count2 < 24 * 24) { okDelivery = false; break }
  }
  check('σ > 0 with drop: delivery guaranteed while any empty cell exists',
    okDelivery && sawDeath > 0)
}

{
  // Rule reliability p: determinism per seed, divergence from p = 1,
  // exact accounting, L1-invariance with noise.
  const common = {
    dimensionality: '2d' as const, size: 16, boundary: 'toroidal' as const,
    rule1: 'B3/S23', rule2: 'B36/S23', direction: 'none' as const,
    initMode: 'both' as const, seed: 77, density1: 0.3, density2: 0.3, maxSteps: 100,
  }
  const det = new RecyclingCA(base({ ...common, stochasticP: 1 }))
  const detAgain = new RecyclingCA(base({ ...common, stochasticP: 1 }))
  let same = true
  for (let t = 0; t < 30; t++) if (det.step().hashJ !== detAgain.step().hashJ) { same = false; break }
  check('p = 1: deterministic', same)

  const noisy = new RecyclingCA(base({ ...common, stochasticP: 0.75, seed: 5 }))
  const noisy2 = new RecyclingCA(base({ ...common, stochasticP: 0.75, seed: 5 }))
  let sameNoisy = true
  for (let t = 0; t < 30; t++) if (noisy.step().hashJ !== noisy2.step().hashJ) { sameNoisy = false; break }
  check('p < 1: deterministic per seed (a reproducible Markov chain)', sameNoisy)

  const clean = new RecyclingCA(base({ ...common, stochasticP: 1, seed: 5 }))
  let diverged = false
  for (let t = 0; t < 30; t++) {
    if (noisy.step().hashJ !== clean.step().hashJ) { diverged = true; break }
  }
  check('p < 1: trajectory diverges from the deterministic run', diverged)

  const caN = new RecyclingCA(base({
    dimensionality: '2d', size: 16, boundary: 'toroidal',
    rule1: 'B3/S23', rule2: 'B36/S23', topology: 'random_empty', collision: 'overwrite',
    direction: 'forward', initMode: 'both', seed: 13, density1: 0.3, density2: 0.3,
    stochasticP: 0.8, maxSteps: 100,
  }))
  let okId = true
  let prevN = caN.lastStepStats!
  for (let t = 0; t < 40; t++) {
    const s = caN.step()
    const dTotal = (s.count1 + s.count2) - (prevN.count1 + prevN.count2)
    const want = (s.births1 - s.deaths1) + (s.births2 - s.deaths2) + s.recycled + s.redirected
    if (dTotal !== want) { okId = false; break }
    prevN = s
  }
  check('p < 1: Δtotal accounting still exact', okId)

  const invN = new RecyclingCA(base({
    ...common, direction: 'forward' as const, topology: 'random_empty',
    collision: 'overwrite', stochasticP: 0.8, seed: 31,
  }))
  const invNAlone = new RecyclingCA(base({ ...common, stochasticP: 0.8, seed: 31 }))
  let okInvN = true
  for (let t = 0; t < 30; t++) {
    if (invN.step().hash1 !== invNAlone.step().hash1) { okInvN = false; break }
  }
  check('p < 1 with forward coupling: L1 still ≡ L1-alone (noise cannot see the coupling)', okInvN)
}

{
  // Replicate boundary: 2D vs a naive clamped reference; 1D edge self-neighbour.
  const naiveReplicateLife = (grid: number[][], B: number[], S: number[]) => {
    const H = grid.length, W = grid[0].length
    const out: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let live = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = Math.min(W - 1, Math.max(0, x + dx))
            const ny = Math.min(H - 1, Math.max(0, y + dy))
            live += grid[ny][nx]
          }
        }
        const table = grid[y][x] === 1 ? S : B
        out[y][x] = table.includes(live) ? 1 : 0
      }
    }
    return out
  }
  const ca = new RecyclingCA(base({
    dimensionality: '2d', size: 12, boundary: 'replicate', rule1: 'B3/S23', rule2: 'B36/S23',
    direction: 'none', seed: 42, density1: 0.5, density2: 0.5, initMode: 'both', maxSteps: 200,
  }))
  ca.setCycleDetectionEnabled(false)
  let g1 = gridFromEngine(ca, 1)
  let g2 = gridFromEngine(ca, 2)
  let ok = true
  for (let t = 0; t < 30; t++) {
    g1 = naiveReplicateLife(g1, LIFE_B, LIFE_S)
    g2 = naiveReplicateLife(g2, HLIFE_B, HLIFE_S)
    ca.step()
    if (JSON.stringify(gridFromEngine(ca, 1)) !== JSON.stringify(g1)) { ok = false; break }
    if (JSON.stringify(gridFromEngine(ca, 2)) !== JSON.stringify(g2)) { ok = false; break }
  }
  check('2D replicate boundary: engine matches the naive clamped reference (30 steps)', ok)

  const c1d = new RecyclingCA(base({
    dimensionality: '1d', size: 9, boundary: 'replicate', rule1: 'W90', rule2: 'W90',
    direction: 'none', initMode: 'empty', maxSteps: 10,
  }))
  c1d.setCell(1, 0, 1) // single cell at the left edge
  const s1d = c1d.step()
  // W90 = left XOR right; at i=0 replicate makes l = cur[0] = 1 (itself), r = cur[1] = 0 → stays live;
  // at i=1: l = cur[0] = 1, r = 0 → birth. Cells 0 and 1 live, nothing else.
  check('1D replicate: the edge cell is its own neighbour (W90 at the edge)',
    s1d.count1 === 2 && c1d.layer1[0] === 1 && c1d.layer1[1] === 1)
}

{
  // URL encoding: round-trips, version guard, junk tolerance.
  check('url: round-trip of the default config', urlRoundTrip(defaultConfig()))
  const cfgB: CAConfig = {
    ...defaultConfig(),
    dimensionality: '1d', size: 128, boundary: 'replicate', rule1: 'W110', rule2: 'W204',
    topology: 'nearest_empty', collision: 'overwrite', direction: 'bidirectional',
    seed: 999, density1: 0.42, density2: 0.07, initMode: 'single2',
    sigma: 3.5, stochasticP: 0.55, maxSteps: 4321,
  }
  check('url: round-trip of an exotic config', urlRoundTrip(cfgB))
  const newer = decodeConfigFromSearch('?v=99&d=2d&n=16')
  check('url: newer version refuses with newer-version',
    !newer.ok && newer.reason === 'newer-version')
  const empty = decodeConfigFromSearch('')
  check('url: no payload decodes as empty', !empty.ok && empty.reason === 'empty')
  const junk = decodeConfigFromSearch('?v=1&d=9d&n=potato&r1=@@@&i=nonsense&b=zzz&den1=5')
  check('url: junk values fall back to defaults, never throw', junk.ok === true)
  const legacy = decodeConfigFromSearch('?d=1d&n=64&r1=W110&r2=W90&i=seed1&b=tor')
  check('url: v omitted is treated as v1',
    legacy.ok === true && legacy.config?.dimensionality === '1d' &&
    legacy.config?.rule1 === 'W110' && legacy.config?.initMode === 'seed1')
}

// ── 10. Analysis: Berlekamp–Massey linear complexity ────────────────────────
{
  // Expected values are verified two ways: by hand, and against a
  // brute-force minimal-recurrence search — for increasing L, try every
  // connection polynomial of degree ≤ L; the first L that reproduces the
  // whole finite sequence is its linear complexity by definition.
  const bruteForceLC = (seq: Uint8Array): number => {
    const n = seq.length
    for (let L = 0; L <= n; L++) {
      for (let mask = 0; mask < 1 << L; mask++) {
        let ok = true
        for (let i = L; i < n; i++) {
          let d = seq[i]
          for (let j = 1; j <= L; j++) if ((mask >> (j - 1)) & 1) d ^= seq[i - j]
          if (d !== 0) { ok = false; break }
        }
        if (ok) return L
      }
    }
    return n
  }
  const finalL = (seq: number[]): number => {
    const p = linearComplexityProfile(new Uint8Array(seq))
    return p[p.length - 1]
  }

  // Pure impulse 1,0,0,…: the minimal recurrence is s_n = 0 → L = 1.
  // (The proposal's sanity list expected 4 for this literal input; the
  // correct value is 1 — 1,0,0,… satisfies the length-1 recurrence
  // s_n = 0·s_{n−1}. The intended complexity-4 worked example is the
  // degree-4 m-sequence two checks below.)
  check('BM: pure impulse 1,0,0,… has final L = 1',
    finalL([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]) === 1)

  // m-sequence from x⁴+x+1 with initial state 1000 (period 15), first 10
  // terms — the canonical "linear complexity 4" sequence.
  const mseq = new Uint8Array([1, 0, 0, 0, 1, 0, 0, 1, 1, 0])
  check('BM: m-sequence from x⁴+x+1 has final L = 4', finalL([1, 0, 0, 0, 1, 0, 0, 1, 1, 0]) === 4)
  check('BM: brute-force cross-check (m-sequence minimal L = 4)', bruteForceLC(mseq) === 4)
  check('BM: impulse train of period 4 has final L = 4', finalL([1, 0, 0, 0, 1, 0, 0, 0, 1, 0]) === 4)

  // All-zero sequence: L = 0 throughout.
  const zero = linearComplexityProfile(new Uint8Array([0, 0, 0, 0, 0]))
  check('BM: all-zero sequence returns 0 throughout', zero.every((v) => v === 0))

  // Delayed impulse 0,0,0,1,0,…: complexity jumps AT the impulse (to 4 —
  // no shorter recurrence can place the 1) and stays small (4 < n/2).
  const delayed = linearComplexityProfile(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 0]))
  check('BM: delayed impulse — L jumps at index 3 and stays small',
    delayed[2] === 0 && delayed[3] === 4 && delayed[8] === 4 && 4 < 9 / 2)

  // Deterministic pseudo-random 31-bit sequence: monotonicity (a property
  // of the algorithm) and agreement with the brute-force reference.
  let x = 123456789
  const rnd: number[] = []
  for (let i = 0; i < 31; i++) {
    x = (1103515245 * x + 12345) % 2147483648
    rnd.push((x >> 10) & 1)
  }
  const rndU = new Uint8Array(rnd)
  const rndProf = linearComplexityProfile(rndU)
  let mono = true
  for (let i = 1; i < rndProf.length; i++) if (rndProf[i] < rndProf[i - 1]) mono = false
  check('BM: L(n) is monotonically non-decreasing', mono)
  check('BM: pseudo-random 31-bit sequence matches the brute-force minimal recurrence',
    rndProf[rndProf.length - 1] === bruteForceLC(rndU))

  // Rule 90 (linear rule): centre column from a single seed, fixed boundary,
  // 64 steps. W90's centre column is annihilated by a tiny recurrence (it is
  // 1,0,0,… here, L = 1) — far below the n/4 bound. Size 129 keeps the
  // light cone off both walls for the whole window.
  {
    const ca = new RecyclingCA(base({
      dimensionality: '1d', size: 129, boundary: 'fixed',
      rule1: 'W90', rule2: 'W90', direction: 'none',
      initMode: 'single1', maxSteps: 200,
    }))
    const centre = 129 >> 1
    const seq: number[] = [ca.layer1[centre]]
    for (let t = 0; t < 64; t++) { ca.step(); seq.push(ca.layer1[centre]) }
    const p = linearComplexityProfile(new Uint8Array(seq))
    check('BM: Rule 90 centre column (single seed, fixed, 64 steps) — final L < n/4',
      p[p.length - 1] < seq.length / 4, `L = ${p[p.length - 1]}, n = ${seq.length}`)
  }

  // Rule 30 (chaotic rule): same setup, 128 steps — the centre column has no
  // short recurrence: complexity grows past n/3 (it tracks the n/2 line of a
  // random sequence; empirically L = 65 at n = 129). No exact value is
  // asserted — only the lower bound.
  {
    const ca = new RecyclingCA(base({
      dimensionality: '1d', size: 301, boundary: 'fixed',
      rule1: 'W30', rule2: 'W90', direction: 'none',
      initMode: 'single1', maxSteps: 400,
    }))
    const centre = 301 >> 1
    const seq: number[] = [ca.layer1[centre]]
    for (let t = 0; t < 128; t++) { ca.step(); seq.push(ca.layer1[centre]) }
    const p = linearComplexityProfile(new Uint8Array(seq))
    check('BM: Rule 30 centre column (single seed, fixed, 128 steps) — final L > n/3',
      p[p.length - 1] > seq.length / 3, `L = ${p[p.length - 1]}, n = ${seq.length}`)
  }
}

// ── 11. Analysis: coexistence observable, coverage & hidden fraction ────────
{
  // Pure-function edge cases (design choices documented in analysis.ts).
  check('coverage: disjoint layers → 0', coverage({ count1: 10, count2: 10, intersect: 0 }) === 0)
  check('hiddenFraction: both layers empty → 1 (vacuous)',
    hiddenFraction({ count1: 0, count2: 0, intersect: 0 }) === 1)
  check('coverage: both layers empty → 1, one empty → 0',
    coverage({ count1: 0, count2: 0, intersect: 0 }) === 1 &&
    coverage({ count1: 5, count2: 0, intersect: 0 }) === 0)
  check('coverage/hidden: identical layers → 1/1; half-overlap → ½/⅓',
    coverage({ count1: 10, count2: 10, intersect: 10 }) === 1 &&
    hiddenFraction({ count1: 10, count2: 10, intersect: 10 }) === 1 &&
    coverage({ count1: 10, count2: 10, intersect: 5 }) === 0.5 &&
    hiddenFraction({ count1: 10, count2: 10, intersect: 5 }) === 5 / 15)

  // Engine: disjoint layers. W204 (identity) keeps both hand-placed cells
  // alive and unmoved, so the run stays genuinely disjoint after stepping.
  {
    const ca = new RecyclingCA(base({
      dimensionality: '1d', size: 8, boundary: 'fixed',
      rule1: 'W204', rule2: 'W204', direction: 'none',
      initMode: 'empty', maxSteps: 10,
    }))
    ca.setCell(1, 2, 1)
    ca.setCell(2, 5, 1)
    const s = ca.step()
    check('engine: coexistence count = 0 while layers are disjoint (after a step)',
      s.intersect === 0 && s.count1 === 1 && s.count2 === 1)
  }

  // Engine: L1 a strict subset of L2 → coexistence = |L1|.
  {
    const ca = new RecyclingCA(base({
      dimensionality: '1d', size: 8, boundary: 'fixed',
      rule1: 'W204', rule2: 'W204', direction: 'none',
      initMode: 'empty', maxSteps: 10,
    }))
    ca.setCell(1, 3, 1)
    ca.setCell(2, 3, 1)
    ca.setCell(2, 6, 1)
    const s = ca.step()
    check('engine: coexistence = count1 when L1 ⊂ L2',
      s.intersect === 1 && s.count1 === 1 && s.count2 === 2 && s.intersect === s.count1)
  }

  // Engine: initial stats (step 0) report the coexistence of the init state.
  {
    const ca = new RecyclingCA(base({
      dimensionality: '2d', size: 16, boundary: 'toroidal',
      rule1: 'B3/S23', rule2: 'B36/S23', direction: 'bidirectional',
      topology: 'random_empty', collision: 'overwrite',
      initMode: 'both', seed: 13, density1: 0.3, density2: 0.3, maxSteps: 100,
    }))
    let both = 0
    for (let i = 0; i < ca.cellsPerLayer; i++) {
      if (ca.layer1[i] === 1 && ca.layer2[i] === 1) both++
    }
    check('engine: initial stats report the coexistence of the init state',
      ca.lastStepStats!.intersect === both)

    // Conservation: coexistence ≤ min(count1, count2), and the set identity
    // union = count1 + count2 − coexistence holds, for 50 steps of a random
    // bidirectional run.
    let ok = true
    for (let t = 0; t < 50; t++) {
      const s = ca.step()
      if (s.intersect > Math.min(s.count1, s.count2)) { ok = false; break }
      if (s.union !== s.count1 + s.count2 - s.intersect) { ok = false; break }
    }
    check('engine: coexistence ≤ min(count1,count2) and union = c1 + c2 − coexistence (50 steps)', ok)
  }
}

// ── 12. Analysis: ANF degree growth (1D Wolfram rules) ──────────────────────
{
  // W90 is linear: the centre cell stays a XOR of single initial cells —
  // degree 1 at every t. By Lucas' theorem the surviving cells are the k ⊆ t
  // bit-subsets, so monomials(t) = 2^popcount(t) (verified: 1,2,2,4,2,4 for
  // t = 0..5).
  const g90 = anfGrowth('W90', 4)
  const pc = (v: number): number => { let c = 0; while (v > 0) { v &= v - 1; c++ } return c }
  check('ANF: W90 has degree 1 at every t (linear rule)',
    g90.length === 5 && g90.every((r) => r.degree === 1))
  check('ANF: W90 monomials(t) = 2^popcount(t) (Lucas / Sierpinski row)',
    g90.every((r) => r.monomials === 1 << pc(r.t)))

  // W30 one-step update: centre = l ⊕ (c ∨ r) = l ⊕ c ⊕ r ⊕ c·r — degree 2,
  // four monomials (hand-verified).
  const g30a = anfGrowth('W30', 1)
  check('ANF: W30 t=0 → degree 1 / 1 monomial; t=1 → degree 2 / 4 monomials',
    g30a.length === 2 &&
    g30a[0].t === 0 && g30a[0].degree === 1 && g30a[0].monomials === 1 &&
    g30a[1].t === 1 && g30a[1].degree === 2 && g30a[1].monomials === 4)

  // Beyond t = 1 no exact degrees are asserted (only bounds): degree is
  // non-decreasing and climbs past 2 (empirically 1,2,3,5 at t ≤ 3).
  const g30b = anfGrowth('W30', 3)
  let nondecreasing = true
  for (let i = 1; i < g30b.length; i++) if (g30b[i].degree < g30b[i - 1].degree) nondecreasing = false
  check('ANF: W30 degree is non-decreasing, degree(1) = 2, and grows beyond',
    nondecreasing && g30b[1].degree === 2 && g30b[3].degree > 2)

  // W204 (identity): the centre cell is exactly its initial value — degree 1,
  // one monomial, at every t.
  const g204 = anfGrowth('W204', 3)
  check('ANF: W204 (identity) — degree 1 / 1 monomial at every t',
    g204.every((r) => r.degree === 1 && r.monomials === 1))

  // Caps and guards.
  let threwCap = false
  try { anfGrowth('W30', 11) } catch { threwCap = true }
  check('ANF: tMax > 10 throws', threwCap)
  let threw2d = false
  try { anfGrowth('B3/S23', 3) } catch { threw2d = true }
  check('ANF: a B/S (2D) rule string throws a clear error', threw2d)
  check('ANF: single-level entry matches the curve entry',
    JSON.stringify(anfGrowthLevel('W30', 2)) === JSON.stringify(anfGrowth('W30', 2)[2]))
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('─'.repeat(60))
console.log(`PASSED ${passed}  FAILED ${failed}`)
if (failures.length) {
  console.log('Failures:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
