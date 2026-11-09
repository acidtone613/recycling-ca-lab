// ─────────────────────────────────────────────────────────────────────────────
// RecyclingCA — the headless engine (Phase 1).
//
// STEP ORDER (documented contract, Phase 1.3):
//   1. L1' = rule1(L1)                    — Layer 1 rule step
//   2. L2' = rule2(L2)                    — Layer 2 rule step
//   3. D1  = { i : L1(i)=1 ∧ L1'(i)=0 }   — Layer 1 death mask
//   4. L2'' = L2' + transfer(D1)          — recycled births into Layer 2
//      (bidirectional only)
//   5. D2  = { i : L2(i)=1 ∧ L2'(i)=0 }   — Layer 2 *rule* deaths (transfer
//      births never kill, so these are exactly the rule deaths)
//      L1'' = L1' + transfer(D2)          — reverse-channel births into L1
//   6. Commit; stats, hashes, cycle detection run on the joint state.
//
// Transfer events are processed in increasing linear index order (then via
// the seeded PRNG for random choices), so every rollout is reproducible.
//
// Structural theorem (asserted in the test suite): with `direction = 'forward'`,
// Layer 1's trajectory is bit-identical to Layer 1 run alone — the coupling
// affects only Layer 2 and the joint observables.
//
// Cycle detection: hashes of (state ‖ rng-state). Stochastic configs
// (`random_empty` topology, `overwrite` collision, a σ > 0 distance kernel,
// or rule reliability p < 1) consume runtime RNG, so a state hash alone
// would not imply a genuine cycle; including the RNG state makes every
// detected cycle genuine. For stochastic configs the process is a
// Markov chain rather than a deterministic CA, so cycles rarely (if ever)
// fire — extinction probability and sustained activity are then the
// meaningful observables.
// ─────────────────────────────────────────────────────────────────────────────

import { Rng } from './rng'
import {
  type BSRule,
  type CARule,
  type ECARule,
  buildNeighborTable,
  isQuiescent,
  parseRule,
  step1D,
  step2D,
} from './rules'
import { configFingerprint, hashGrids } from './hash'
import type { CAConfig, CycleInfo, Outcome, RunSummary, StepStats } from './types'

/** Hard sanity bounds applied to every config (direct callers can bypass the
 * GUI's own constrained controls; a size of 10,000 would allocate 10⁸ cells
 * and OOM, densities outside [0,1] are meaningless). */
const SIZE_MIN = 2
const SIZE_MAX = 512

function clampConfig(cfg: CAConfig): CAConfig {
  return {
    ...cfg,
    size: Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(cfg.size) || SIZE_MIN)),
    density1: Math.max(0, Math.min(1, cfg.density1)),
    density2: Math.max(0, Math.min(1, cfg.density2)),
    sigma: Math.max(0, Math.min(16, cfg.sigma)),
    stochasticP: Math.max(0, Math.min(1, cfg.stochasticP)),
  }
}

export function defaultConfig(): CAConfig {
  return {
    dimensionality: '2d',
    size: 16,
    boundary: 'toroidal',
    rule1: 'B3/S23',
    rule2: 'B3/S23',
    topology: 'same',
    collision: 'drop',
    direction: 'forward',
    seed: 1,
    density1: 0.3,
    density2: 0.3,
    initMode: 'seed1',
    sigma: 0,
    stochasticP: 1,
    maxSteps: 2000,
  }
}

interface EventCounters {
  recycled: number
  dropped: number
  redirected: number
  merged: number
}

const emptyCounters = (): EventCounters => ({ recycled: 0, dropped: 0, redirected: 0, merged: 0 })

export class RecyclingCA {
  config: CAConfig
  private rule1: CARule
  private rule2: CARule
  /** Cells per layer. */
  private n = 0
  private l1!: Uint8Array
  private l2!: Uint8Array
  private b1!: Uint8Array
  private b2!: Uint8Array
  private d1!: Uint8Array
  private d2!: Uint8Array
  /** Per-cell record of delivered recycled births (forward channel only). */
  private recCount!: Uint32Array
  /** σ-kernel sampling scratch: candidate empty-cell indices. */
  private wIdx!: Int32Array
  /** σ-kernel sampling scratch: cumulative weights. */
  private wCum!: Float64Array
  private nb: Int32Array | null = null
  private rng!: Rng
  /** Rule-noise stream (p < 1), derived from the seed but SEPARATE from the
   *  transfer stream — insulating it is what keeps L1-invariance true for
   *  p < 1: Layer 1's noise cannot see how much randomness the transfer
   *  consumed. */
  private noiseRng!: Rng

  stepIndex = 0
  outcome: Outcome = 'running'
  cycleJ: CycleInfo | null = null
  cycle1: CycleInfo | null = null
  cycle2: CycleInfo | null = null
  extinctStep: number | null = null
  extinct1Step: number | null = null
  extinct2Step: number | null = null
  history: StepStats[] = []
  totals = {
    recycled: 0, dropped: 0, redirected: 0, merged: 0,
    recycledR: 0, droppedR: 0, redirectedR: 0, mergedR: 0,
    deaths1: 0, deaths2: 0,
  }

  private seenJ = new Map<string, number>()
  private seen1 = new Map<string, number>()
  private seen2 = new Map<string, number>()
  private lastStats: StepStats | null = null
  private detectCycles = true

  // Summary accumulators (work with history disabled for batch runs).
  private keepHistory = true
  private actSum = 0
  private actCount = 0
  private last100 = new Float64Array(100)
  private last100Idx = 0
  private last100Filled = 0

  constructor(config: CAConfig) {
    this.config = clampConfig(config)
    this.rule1 = parseRule(this.config.rule1)
    this.rule2 = parseRule(this.config.rule2)
    this.assertRuleFamily()
    this.build()
    this.initState()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Read-only view of Layer 1's current state (do not mutate). */
  get layer1(): Uint8Array {
    return this.l1
  }

  /** Read-only view of Layer 2's current state (do not mutate). */
  get layer2(): Uint8Array {
    return this.l2
  }

  /** Read-only view of the per-cell recycled-birth record: how many delivered
   *  recycled births (recycled + redirected, forward channel only) have
   *  landed in each cell since init. Reset by initState. */
  get recycledCount(): Uint32Array {
    return this.recCount
  }

  get cellsPerLayer(): number {
    return this.n
  }

  get lastStepStats(): StepStats | null {
    return this.lastStats
  }

  get terminal(): boolean {
    return this.outcome !== 'running' && this.outcome !== 'censored'
  }

  /** Disable per-step history objects (batch mode). Summary stats unaffected. */
  setHistoryEnabled(enabled: boolean): void {
    this.keepHistory = enabled
  }

  /** Toggle cycle detection (disabled for full-trajectory baseline tests). */
  setCycleDetectionEnabled(enabled: boolean): void {
    this.detectCycles = enabled
  }

  /** Advance one step. No-op (returns last stats) after a terminal outcome. */
  step(): StepStats {
    if (this.terminal) return this.lastStats ?? this.makeInitialStats()
    const cfg = this.config
    const N = this.n

    // (1)(2) Rule updates.
    if (cfg.dimensionality === '1d') {
      step1D(this.l1, this.b1, N, (this.rule1 as ECARule).code, cfg.boundary)
      step1D(this.l2, this.b2, N, (this.rule2 as ECARule).code, cfg.boundary)
    } else {
      step2D(this.l1, this.b1, cfg.size, cfg.size, this.rule1 as BSRule, this.nb!)
      step2D(this.l2, this.b2, cfg.size, cfg.size, this.rule2 as BSRule, this.nb!)
    }
    // (2½) Rule reliability (p < 1 only): each cell independently keeps its
    // current state — ignoring the computed rule output — with probability
    // 1 − p. Draws come from a dedicated noise stream; Layer 1's draws always
    // precede Layer 2's, so the L1-invariance theorem survives (the noise
    // can neither see the coupling nor the transfer's RNG consumption).
    if (cfg.stochasticP < 1) {
      const keep = 1 - cfg.stochasticP
      for (let i = 0; i < N; i++) if (this.noiseRng.next() < keep) this.b1[i] = this.l1[i]
      for (let i = 0; i < N; i++) if (this.noiseRng.next() < keep) this.b2[i] = this.l2[i]
    }

    // (3) Death masks + rule birth/death counts.
    let deaths1 = 0, births1 = 0, deaths2 = 0, births2 = 0
    for (let i = 0; i < N; i++) {
      const a0 = this.l1[i], a1 = this.b1[i]
      const c0 = this.l2[i], c1 = this.b2[i]
      const dd1 = a0 === 1 && a1 === 0 ? 1 : 0
      const db1 = a0 === 0 && a1 === 1 ? 1 : 0
      const dd2 = c0 === 1 && c1 === 0 ? 1 : 0
      const db2 = c0 === 0 && c1 === 1 ? 1 : 0
      this.d1[i] = dd1
      this.d2[i] = dd2
      deaths1 += dd1; births1 += db1; deaths2 += dd2; births2 += db2
    }

    // (4) Forward transfer: Layer 1 deaths → Layer 2 births.
    const ev = emptyCounters()
    if (cfg.direction === 'forward' || cfg.direction === 'bidirectional') {
      this.transfer(this.d1, this.b2, ev, this.recCount)
    }
    // (5) Reverse channel (bidirectional only): Layer 2 rule deaths → Layer 1.
    const evR = emptyCounters()
    if (cfg.direction === 'bidirectional') {
      this.transfer(this.d2, this.b1, evR, null)
    }

    // (6) Commit — buffers swap roles; b1/b2 now hold the previous states.
    const t1 = this.l1; this.l1 = this.b1; this.b1 = t1
    const t2 = this.l2; this.l2 = this.b2; this.b2 = t2
    this.stepIndex++

    // (7) Counts, union, entropy, mean change.
    let c1 = 0, c2 = 0, un = 0
    let p00 = 0, p01 = 0, p10 = 0, p11 = 0
    for (let i = 0; i < N; i++) {
      const a = this.l1[i], c = this.l2[i]
      c1 += a; c2 += c; un += a | c
      if (a === 0 && c === 0) p00++
      else if (a === 0 && c === 1) p01++
      else if (a === 1 && c === 0) p10++
      else p11++
    }
    let flipped = 0
    for (let i = 0; i < N; i++) {
      if (this.l1[i] !== this.b1[i]) flipped++
      if (this.l2[i] !== this.b2[i]) flipped++
    }
    const meanChange = flipped / (2 * N)
    const entropy = entropyBits(p00, p01, p10, p11, N)
    // Coexistence observable: cells live in both layers. Analysis-only —
    // never hashed, never serialized, never part of a fingerprint.
    let intersect = 0
    for (let i = 0; i < N; i++) if (this.l1[i] === 1 && this.l2[i] === 1) intersect++

    // (8) Hashes (RNG-tagged for stochastic configs) + cycle detection.
    const h1 = hashGrids(this.l1)
    const h2 = hashGrids(this.l2)
    const hJ = hashGrids(this.l1, this.l2)
    const rngTag = this.stochasticTag()
    if (this.detectCycles) {
      const key1 = h1 + rngTag
      const key2 = h2 + rngTag
      const keyJ = hJ + rngTag
      const prev1 = this.seen1.get(key1)
      if (prev1 === undefined) this.seen1.set(key1, this.stepIndex)
      else if (!this.cycle1) this.cycle1 = { foundAt: prev1, length: this.stepIndex - prev1 }
      const prev2 = this.seen2.get(key2)
      if (prev2 === undefined) this.seen2.set(key2, this.stepIndex)
      else if (!this.cycle2) this.cycle2 = { foundAt: prev2, length: this.stepIndex - prev2 }
      const prevJ = this.seenJ.get(keyJ)
      if (prevJ === undefined) this.seenJ.set(keyJ, this.stepIndex)
      else if (!this.cycleJ) this.cycleJ = { foundAt: prevJ, length: this.stepIndex - prevJ }
    }

    // Outcome: extinction (absorbing for quiescent rules) > cycle > censored.
    if (c1 === 0 && c2 === 0 && isQuiescent(this.rule1) && isQuiescent(this.rule2)) {
      if (this.outcome !== 'extinct') {
        this.outcome = 'extinct'
        this.extinctStep = this.stepIndex
      }
    } else if (this.cycleJ && this.outcome === 'running') {
      this.outcome = 'cycle'
    }
    if (this.outcome === 'running' && this.stepIndex >= cfg.maxSteps) {
      this.outcome = 'censored'
    }
    // Per-layer extinction steps (first time a layer hits all-0; for
    // quiescent rules and no reverse channel this is permanent).
    if (this.extinct1Step === null && c1 === 0 && isQuiescent(this.rule1)) {
      this.extinct1Step = this.stepIndex
    }
    if (this.extinct2Step === null && c2 === 0 && isQuiescent(this.rule2)) {
      this.extinct2Step = this.stepIndex
    }

    // Totals + accumulators.
    this.totals.recycled += ev.recycled; this.totals.dropped += ev.dropped
    this.totals.redirected += ev.redirected; this.totals.merged += ev.merged
    this.totals.recycledR += evR.recycled; this.totals.droppedR += evR.dropped
    this.totals.redirectedR += evR.redirected; this.totals.mergedR += evR.merged
    this.totals.deaths1 += deaths1; this.totals.deaths2 += deaths2
    this.actSum += meanChange; this.actCount++
    this.last100[this.last100Idx] = meanChange
    this.last100Idx = (this.last100Idx + 1) % 100
    if (this.last100Filled < 100) this.last100Filled++

    const stats: StepStats = {
      step: this.stepIndex,
      count1: c1, count2: c2, union: un, intersect,
      meanChange, entropy,
      deaths1, births1, deaths2, births2,
      recycled: ev.recycled, dropped: ev.dropped,
      redirected: ev.redirected, merged: ev.merged,
      recycledR: evR.recycled, droppedR: evR.dropped,
      redirectedR: evR.redirected, mergedR: evR.merged,
      hashJ: hJ, hash1: h1, hash2: h2,
      outcome: this.outcome,
      cycleJLen: this.cycleJ ? this.cycleJ.length : null,
      cycle1Len: this.cycle1 ? this.cycle1.length : null,
      cycle2Len: this.cycle2 ? this.cycle2.length : null,
    }
    this.lastStats = stats
    if (this.keepHistory) this.history.push(stats)
    return stats
  }

  /**
   * Live config update. Structural fields (dimensionality/size/boundary) and
   * init fields (seed/density1/density2/initMode) re-initialize the state;
   * dynamical fields (rules/topology/collision/direction/sigma/stochasticP)
   * apply from the next step and reset cycle detection (past hashes belong to
   * the old dynamics).
   */
  updateConfig(partial: Partial<CAConfig>): void {
    const structural =
      partial.dimensionality !== undefined || partial.size !== undefined ||
      partial.boundary !== undefined
    const reinity =
      partial.seed !== undefined || partial.density1 !== undefined ||
      partial.density2 !== undefined || partial.initMode !== undefined
    this.config = clampConfig({ ...this.config, ...partial })

    if (structural) {
      if (partial.dimensionality !== undefined) {
        // A dimensionality switch invalidates rules of the other family. If
        // the caller did not supply matching rules, fall back to the family
        // default rather than throw (the UI always sends rules; direct
        // callers get a sane, documented default).
        const twoD = this.config.dimensionality === '2d'
        const matches = (r: CARule) => r.kind === (twoD ? '2d' : '1d')
        if (partial.rule1 === undefined && !matches(this.rule1)) {
          this.config.rule1 = twoD ? 'B3/S23' : 'W90'
        }
        if (partial.rule2 === undefined && !matches(this.rule2)) {
          this.config.rule2 = twoD ? 'B3/S23' : 'W90'
        }
      }
      this.rule1 = parseRule(this.config.rule1)
      this.rule2 = parseRule(this.config.rule2)
      this.assertRuleFamily()
      this.build()
      this.initState()
      return
    }
    if (partial.rule1 !== undefined) this.rule1 = parseRule(this.config.rule1)
    if (partial.rule2 !== undefined) this.rule2 = parseRule(this.config.rule2)
    if (reinity) {
      this.initState()
      return
    }
    if (
      partial.rule1 !== undefined || partial.rule2 !== undefined ||
      partial.topology !== undefined || partial.collision !== undefined ||
      partial.direction !== undefined || partial.sigma !== undefined ||
      partial.stochasticP !== undefined
    ) {
      this.clearDetection()
    }
    if (partial.maxSteps !== undefined) {
      if (this.outcome === 'censored' && this.stepIndex < this.config.maxSteps) {
        this.outcome = 'running'
      } else if (this.outcome === 'running' && this.stepIndex >= this.config.maxSteps) {
        this.outcome = 'censored'
      }
    }
  }

  /**
   * Full re-initialization from the (possibly overridden) init fields —
   * Reset keeps the seed, Randomize overrides it.
   *
   * Accepts init fields (seed/density1/density2/initMode), dynamical fields
   * (topology/collision/direction/sigma/stochasticP) and maxSteps. Structural
   * fields (dimensionality/size/boundary) and rules are REJECTED: accepting
   * them here would silently desynchronize `config` from the allocated
   * buffers and parsed rules (initState alone reuses them). updateConfig()
   * is the structural path — it rebuilds buffers and re-parses rules.
   */
  reinit(overrides?: Partial<CAConfig>): void {
    if (overrides) {
      const rejected = (['dimensionality', 'size', 'boundary', 'rule1', 'rule2'] as const)
        .filter((k) => overrides[k] !== undefined)
      if (rejected.length > 0) {
        throw new Error(
          `reinit() rejects structural/rule overrides (${rejected.join(', ')}); ` +
          'call updateConfig() instead — it rebuilds buffers and re-parses rules.',
        )
      }
      this.config = clampConfig({ ...this.config, ...overrides })
    }
    this.initState()
  }

  /**
   * Manual cell edit (GUI drawing). Resets cycle detection — the edited state
   * is re-recorded as the detection base, and a terminal outcome revives so
   * stepping resumes. Extinction stamps are cleared *conditionally*: only the
   * layers (or joint state) that now have live cells. A layer that is still
   * all-0 keeps its stamp — redrawing the *other* layer after a per-layer
   * extinction must not erase this layer's record.
   */
  setCell(layer: 1 | 2, index: number, value: 0 | 1): void {
    const g = layer === 1 ? this.l1 : this.l2
    if (index < 0 || index >= this.n) return
    g[index] = value
    this.resetCycleDetection()
    if (this.extinctStep !== null && (this.count(this.l1) > 0 || this.count(this.l2) > 0)) {
      this.extinctStep = null
    }
    if (this.extinct1Step !== null && this.count(this.l1) > 0) this.extinct1Step = null
    if (this.extinct2Step !== null && this.count(this.l2) > 0) this.extinct2Step = null
  }

  /** Compact stamp of the run so far (JSON log / batch records). */
  summary(): RunSummary {
    const activityMean = this.actCount > 0 ? this.actSum / this.actCount : 0
    let last100Mean = 0
    if (this.last100Filled > 0) {
      let s = 0
      for (let i = 0; i < this.last100Filled; i++) s += this.last100[i]
      last100Mean = s / this.last100Filled
    }
    const c1 = this.count(this.l1)
    const c2 = this.count(this.l2)
    return {
      config: { ...this.config },
      configHash: configFingerprint(this.config),
      stepsRun: this.stepIndex,
      outcome: this.outcome,
      extinctStep: this.extinctStep,
      extinct1Step: this.extinct1Step,
      extinct2Step: this.extinct2Step,
      cycleJ: this.cycleJ ? { ...this.cycleJ } : null,
      cycle1: this.cycle1 ? { ...this.cycle1 } : null,
      cycle2: this.cycle2 ? { ...this.cycle2 } : null,
      finalCount1: c1,
      finalCount2: c2,
      finalUnion: this.countUnion(),
      activityMean,
      activityLast100: last100Mean,
      totals: { ...this.totals },
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private get rngState(): number {
    return this.rng.state
  }

  private assertRuleFamily(): void {
    const dim = this.config.dimensionality
    const bad = (r: CARule, which: string) =>
      new Error(
        `Rule ${which} is a ${r.kind === '1d' ? 'Wolfram-code (1D)' : 'B/S (2D)'} rule, ` +
        `which does not match dimensionality "${dim}" — pass matching rule1/rule2, ` +
        'or omit them to fall back to the family default.',
      )
    if (dim === '2d') {
      if (this.rule1.kind !== '2d') throw bad(this.rule1, 'rule1')
      if (this.rule2.kind !== '2d') throw bad(this.rule2, 'rule2')
    } else {
      if (this.rule1.kind !== '1d') throw bad(this.rule1, 'rule1')
      if (this.rule2.kind !== '1d') throw bad(this.rule2, 'rule2')
    }
  }

  private build(): void {
    const { dimensionality, size, boundary } = this.config
    this.n = dimensionality === '1d' ? size : size * size
    this.l1 = new Uint8Array(this.n)
    this.l2 = new Uint8Array(this.n)
    this.b1 = new Uint8Array(this.n)
    this.b2 = new Uint8Array(this.n)
    this.d1 = new Uint8Array(this.n)
    this.d2 = new Uint8Array(this.n)
    this.recCount = new Uint32Array(this.n)
    this.wIdx = new Int32Array(this.n)
    this.wCum = new Float64Array(this.n)
    this.nb = dimensionality === '2d' ? buildNeighborTable(size, size, boundary) : null
  }

  private initState(): void {
    const cfg = this.config
    this.rng = new Rng(cfg.seed)
    this.noiseRng = new Rng((cfg.seed ^ 0x5f356495) >>> 0)
    this.l1.fill(0)
    this.l2.fill(0)
    // Init modes: L1 is seeded in both/seed1/single1, L2 in both/seed2/
    // single2; single* place one centre cell instead of a random fill.
    // RNG order: Layer 1's fill first, then Layer 2's — same order as the
    // step contract, so 'both' with density1 = density2 reproduces the old
    // both-random init bit-for-bit.
    const mode = cfg.initMode
    if (mode === 'both' || mode === 'seed1') {
      for (let i = 0; i < this.n; i++) this.l1[i] = this.rng.next() < cfg.density1 ? 1 : 0
    }
    if (mode === 'both' || mode === 'seed2') {
      for (let i = 0; i < this.n; i++) this.l2[i] = this.rng.next() < cfg.density2 ? 1 : 0
    }
    if (mode === 'single1' || mode === 'single2') {
      const centre =
        cfg.dimensionality === '1d'
          ? cfg.size >> 1
          : (cfg.size >> 1) * cfg.size + (cfg.size >> 1)
      ;(mode === 'single1' ? this.l1 : this.l2)[centre] = 1
    }
    this.recCount.fill(0)
    this.stepIndex = 0
    this.outcome = 'running'
    this.clearDetection()
    this.history = []
    this.totals = {
      recycled: 0, dropped: 0, redirected: 0, merged: 0,
      recycledR: 0, droppedR: 0, redirectedR: 0, mergedR: 0,
      deaths1: 0, deaths2: 0,
    }
    this.actSum = 0; this.actCount = 0
    this.last100Idx = 0; this.last100Filled = 0
    this.lastStats = this.makeInitialStats()
  }

  private clearDetection(record = true): void {
    this.seenJ.clear(); this.seen1.clear(); this.seen2.clear()
    this.cycleJ = null; this.cycle1 = null; this.cycle2 = null
    this.extinctStep = null; this.extinct1Step = null; this.extinct2Step = null
    if (this.outcome !== 'censored') this.outcome = 'running'
    if (record) {
      // Re-seed detection with the current state so a return to it (e.g. the
      // initial state, or the state at a live edit) is caught immediately.
      this.recordCurrentState()
    }
  }

  /** Cycle-detection reset for live edits (setCell): clears the seen states
   *  and cycle records and revives the outcome — but leaves the extinction
   *  stamps alone; setCell clears those conditionally per layer instead. */
  private resetCycleDetection(): void {
    this.seenJ.clear(); this.seen1.clear(); this.seen2.clear()
    this.cycleJ = null; this.cycle1 = null; this.cycle2 = null
    if (this.outcome !== 'censored') this.outcome = 'running'
    this.recordCurrentState()
  }

  /** RNG tag for cycle keys — stochastic configs consume runtime randomness.
   *  Rule noise (p < 1) makes the process stochastic even uncoupled; the
   *  transfer adds randomness for random_empty, overwrite, or σ > 0. Both
   *  stream states participate in the key when either source is stochastic. */
  private stochasticTag(): string {
    const cfg = this.config
    const ruleNoise = cfg.stochasticP < 1
    const transferNoise =
      cfg.direction !== 'none' &&
      (cfg.topology === 'random_empty' || cfg.collision === 'overwrite' ||
        (cfg.sigma > 0 && cfg.topology !== 'same'))
    if (!ruleNoise && !transferNoise) return ''
    return `:r${this.rngState}${ruleNoise ? `n${this.noiseRng.state}` : ''}`
  }

  private recordCurrentState(): void {
    if (!this.detectCycles || this.n === 0) return
    const tag = this.stochasticTag()
    this.seen1.set(hashGrids(this.l1) + tag, this.stepIndex)
    this.seen2.set(hashGrids(this.l2) + tag, this.stepIndex)
    this.seenJ.set(hashGrids(this.l1, this.l2) + tag, this.stepIndex)
  }

  private makeInitialStats(): StepStats {
    const c1 = this.count(this.l1)
    const c2 = this.count(this.l2)
    let both = 0
    for (let i = 0; i < this.n; i++) if (this.l1[i] === 1 && this.l2[i] === 1) both++
    return {
      step: 0, count1: c1, count2: c2, union: this.countUnion(), intersect: both,
      meanChange: 0, entropy: entropy2Layers(c1, c2, this.countUnion(), this.n),
      deaths1: 0, births1: 0, deaths2: 0, births2: 0,
      recycled: 0, dropped: 0, redirected: 0, merged: 0,
      recycledR: 0, droppedR: 0, redirectedR: 0, mergedR: 0,
      hashJ: hashGrids(this.l1, this.l2), hash1: hashGrids(this.l1), hash2: hashGrids(this.l2),
      outcome: 'running', cycleJLen: null, cycle1Len: null, cycle2Len: null,
    }
  }

  private count(g: Uint8Array): number {
    let c = 0
    for (let i = 0; i < g.length; i++) c += g[i]
    return c
  }

  private countUnion(): number {
    let c = 0
    for (let i = 0; i < this.n; i++) c += this.l1[i] | this.l2[i]
    return c
  }

  /**
   * Apply the recycling transfer: every cell in `deaths` (linear index order)
   * seeds one birth into `target` per topology + collision policy. When
   * `record` is non-null, delivered births (recycled / redirected) are also
   * tallied per cell — the forward channel passes the recycled-birth record,
   * the reverse channel passes null.
   */
  private transfer(deaths: Uint8Array, target: Uint8Array, ev: EventCounters, record: Uint32Array | null): void {
    const cfg = this.config
    let empties = 0
    for (let i = 0; i < this.n; i++) if (target[i] === 0) empties++

    for (let origin = 0; origin < this.n; origin++) {
      if (deaths[origin] !== 1) continue

      // Preferred target selection.
      let pref = -1
      if (cfg.topology === 'same') {
        // σ never applies here: `same` has no distance to speak of.
        pref = target[origin] === 0 ? origin : -1
      } else if (cfg.sigma > 0) {
        // Distance kernel (nearest_empty / random_empty): a weighted sample
        // over all empty cells. It always lands on an *empty* cell, so with
        // σ > 0 the collision policy is unreachable while any empty exists.
        pref = this.pickWeightedEmpty(origin, target, empties)
      } else if (cfg.topology === 'nearest_empty') {
        pref = target[origin] === 0 ? origin : this.scanNearestEmpty(origin, target)
      } else {
        pref = this.pickRandomEmpty(target, empties)
      }

      if (pref >= 0) {
        target[pref] = 1
        empties--
        ev.recycled++
        if (record) record[pref]++
        continue
      }

      // Collision: preferred target unavailable.
      if (cfg.collision === 'drop') {
        ev.dropped++
        continue
      }
      // Overwrite: guaranteed delivery — redirect to a random empty cell.
      const alt = this.pickRandomEmpty(target, empties)
      if (alt >= 0) {
        target[alt] = 1
        empties--
        ev.redirected++
        if (record) record[alt]++
      } else {
        // Layer entirely full — and `same`/`nearest` got here only because
        // the origin itself is occupied — so the birth merges into the
        // already-live origin cell: a delivered-but-absorbed event, NOT a new
        // cell. Nothing is written and nothing is recorded (adds 0 to counts).
        ev.merged++
      }
    }
  }

  /** Moore ring, clockwise from North (1D: left, then right). Origin excluded. */
  private scanNearestEmpty(origin: number, target: Uint8Array): number {
    if (this.config.dimensionality === '1d') {
      const N = this.n
      const tor = this.config.boundary === 'toroidal'
      const left = origin > 0 ? origin - 1 : tor ? N - 1 : -1
      const right = origin < N - 1 ? origin + 1 : tor ? 0 : -1
      if (left >= 0 && target[left] === 0) return left
      if (right >= 0 && target[right] === 0) return right
      return -1
    }
    const base = origin * 8
    for (let k = 0; k < 8; k++) {
      const j = this.nb![base + k]
      if (j >= 0 && target[j] === 0) return j
    }
    return -1
  }

  /**
   * Uniformly random empty cell via rejection sampling (expected tries =
   * N/empties, capped at 4× that, fallback = random-start scan; the fallback
   * is gap-biased but fires with probability ≲ 2%). −1 if no empty exists.
   */
  private pickRandomEmpty(target: Uint8Array, empties: number): number {
    if (empties <= 0) return -1
    const N = this.n
    const maxTries = Math.min(N, Math.max(8, Math.ceil((4 * N) / empties)))
    for (let t = 0; t < maxTries; t++) {
      const i = this.rng.int(N)
      if (target[i] === 0) return i
    }
    const start = this.rng.int(N)
    for (let k = 0; k < N; k++) {
      const i = (start + k) % N
      if (target[i] === 0) return i
    }
    return -1
  }

  /**
   * σ-kernel target: sample an empty cell with probability ∝ exp(−d²/(2σ²)),
   * d = Euclidean distance from the death site (toroidal-aware on a torus).
   * Exact inverse-CDF sampling over the tabulated weights. The tabulation is
   * O(n) per event — fine for GUI-scale grids; batch sweeps use σ = 0 and
   * never reach this path. Degenerate case (σ → 0 with only far-away empties:
   * every weight underflows to 0): falls back to a uniform pick among the
   * empty cells so delivery is still guaranteed.
   */
  private pickWeightedEmpty(origin: number, target: Uint8Array, empties: number): number {
    if (empties <= 0) return -1
    const cfg = this.config
    const N = this.n
    const S = cfg.size
    const twoD = cfg.dimensionality === '2d'
    const tor = cfg.boundary === 'toroidal'
    const inv2s2 = 1 / (2 * cfg.sigma * cfg.sigma)
    const ox = twoD ? origin % S : origin
    const oy = twoD ? Math.floor(origin / S) : 0
    const idx = this.wIdx
    const cum = this.wCum
    let total = 0
    let k = 0
    for (let i = 0; i < N; i++) {
      if (target[i] !== 0) continue
      let d2: number
      if (twoD) {
        let dx = Math.abs((i % S) - ox)
        let dy = Math.abs(Math.floor(i / S) - oy)
        if (tor) { dx = Math.min(dx, S - dx); dy = Math.min(dy, S - dy) }
        d2 = dx * dx + dy * dy
      } else {
        let dd = Math.abs(i - ox)
        if (tor) dd = Math.min(dd, S - dd)
        d2 = dd * dd
      }
      total += Math.exp(-d2 * inv2s2)
      idx[k] = i
      cum[k] = total
      k++
    }
    if (total <= 0) return this.pickRandomEmpty(target, empties)
    // Inverse-CDF draw: find the first cumulative weight ≥ u.
    const u = this.rng.next() * total
    let lo = 0
    let hi = k - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < u) lo = mid + 1
      else hi = mid
    }
    return idx[lo]
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function entropyBits(p00: number, p01: number, p10: number, p11: number, total: number): number {
  if (total === 0) return 0
  let h = 0
  for (const c of [p00, p01, p10, p11]) {
    if (c > 0) {
      const p = c / total
      h -= p * Math.log2(p)
    }
  }
  return h
}

function entropy2Layers(c1: number, c2: number, union: number, n: number): number {
  const both = c1 + c2 - union
  return entropyBits(n - union, c2 - both, c1 - both, both, n)
}
