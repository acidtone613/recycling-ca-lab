// ─────────────────────────────────────────────────────────────────────────────
// Recycling CA — shared type definitions (Phase 0 formalization)
//
// Two dynamical layers (Layer 1, Layer 2), each a standard binary CA:
//   • 1D mode: elementary CA rules (Wolfram code 0–255)
//   • 2D mode: Life-like rules (B*/S*, Moore neighbourhood, 8 neighbours)
// Layer 3 is NOT dynamical: it is a read-only viewport that renders the two
// layers (side-by-side, or as a 4-state analytical overlay).
//
// The coupling is a transfer operator: a death in Layer 1 (1 → 0) is recycled
// into Layer 2 as a birth, according to a topology (target selection) and a
// collision policy (resolution when the preferred target is unavailable).
// ─────────────────────────────────────────────────────────────────────────────

/** Simulation dimensionality (selects the rule family). */
export type Dimensionality = '1d' | '2d'

/** Grid boundary handling.
 *  - `fixed`     : outside the grid is dead (neighbour missing)
 *  - `toroidal`  : the grid wraps around
 *  - `replicate` : out-of-bounds neighbour coordinates are clamped into the
 *                  grid — the neighbour is replaced by the nearest edge cell
 */
export type Boundary = 'fixed' | 'toroidal' | 'replicate'

/**
 * Recycling topology — how the target cell for a recycled birth is selected.
 *  - `same`          : the death cell's own coordinate (i, j)
 *  - `nearest_empty` : origin first, then the Moore ring clockwise from North
 *                      (1D: origin, then left, then right)
 *  - `random_empty`  : a uniformly random empty cell anywhere in Layer 2
 *
 * With `sigma > 0` (see CAConfig), `nearest_empty` / `random_empty` switch to
 * a distance-weighted sample over all empty cells instead.
 */
export type Topology = 'same' | 'nearest_empty' | 'random_empty'

/**
 * Collision semantics — what happens to a recycling event whose preferred
 * target is occupied (or for search topologies, when no empty cell exists in
 * the search domain).
 *  - `drop`      : the event is lost (lossy; biases toward extinction)
 *  - `overwrite` : guaranteed delivery — the birth is redirected to a
 *                  uniformly random empty cell in Layer 2 (if Layer 2 is
 *                  entirely full, the event merges at the origin cell).
 *                  Every death yields exactly one birth while Layer 2 has any
 *                  empty cell, so the transfer never destroys aliveness.
 */
export type Collision = 'drop' | 'overwrite'

/**
 * Coupling direction.
 *  - `none`          : two independent layers (uncoupled baseline)
 *  - `forward`       : Layer 1 deaths → Layer 2 births (unidirectional)
 *  - `bidirectional` : + Layer 2 rule-deaths → Layer 1 births
 */
export type Direction = 'none' | 'forward' | 'bidirectional'

/**
 * Initial-state protocol.
 *  - `both`    : both layers random (L1 at `density1`, L2 at `density2`)
 *  - `seed1`   : L1 random, L2 empty — the *default*; L2 only receives cells
 *                via recycling, so the first steps show the transfer directly
 *  - `seed2`   : L1 empty, L2 random
 *  - `single1` : a single centre cell in L1, L2 empty
 *  - `single2` : a single centre cell in L2, L1 empty
 *  - `empty`   : both empty — draw your own
 */
export type InitMode = 'both' | 'seed1' | 'seed2' | 'single1' | 'single2' | 'empty'

/** Trajectory outcome on a finite grid (deterministic ⇒ eventually periodic). */
export type Outcome = 'running' | 'extinct' | 'cycle' | 'censored'

export interface CAConfig {
  dimensionality: Dimensionality
  /** 2D: size × size grid. 1D: row of `size` cells. */
  size: number
  boundary: Boundary
  /** Layer 1 rule — 'B3/S23' (2D) or 'W110' (1D). */
  rule1: string
  /** Layer 2 rule. */
  rule2: string
  topology: Topology
  collision: Collision
  direction: Direction
  /** PRNG seed. Every stochastic choice (init, random targets) derives from it. */
  seed: number
  /** Initial live density of Layer 1 (`both` / `seed1` modes). */
  density1: number
  /** Initial live density of Layer 2 (`both` / `seed2` modes). */
  density2: number
  initMode: InitMode
  /**
   * Distance-kernel scale for recycled births (σ). 0 = the topology's default
   * behaviour. When σ > 0 and topology is `nearest_empty` / `random_empty`, the
   * candidate empty cells are weighted by exp(−d²/(2σ²)) — d = Euclidean
   * distance from the death site (toroidal-aware on a torus) — and the target
   * is sampled from that distribution: small σ keeps births near the death
   * site (approaching `nearest_empty`), large σ approaches uniform
   * (`random_empty`). Clamped to [0, 16].
   */
  sigma: number
  /**
   * Rule reliability p ∈ (0, 1]. After the rule step, each cell independently
   * keeps its *current* state (ignoring the computed rule output) with
   * probability 1 − p. p = 1 (default) is fully deterministic and consumes no
   * randomness; p < 1 turns the process into a Markov chain (cycle detection
   * is RNG-tagged, so reported cycles remain genuine).
   */
  stochasticP: number
  /** Hard step cap — a run still active beyond this is `censored`. */
  maxSteps: number
}

export interface CycleInfo {
  /** Step at which the repeating state was first seen. */
  foundAt: number
  /** Period of the limit cycle. */
  length: number
}

/** Per-step statistics (the observables of Phase 0.3). */
export interface StepStats {
  /** 1-based step number. */
  step: number
  count1: number
  count2: number
  /** Cells alive in Layer 1 OR Layer 2. */
  union: number
  /** Cells alive in BOTH layers (|L1 ∩ L2|) — the coexistence observable.
   *  Analysis-only: not part of any hash, fingerprint or serialized output
   *  (excluded from configFingerprint, RunSummary and the URL encoding). */
  intersect: number
  /** Fraction of cells (across both layers) that changed state this step. */
  meanChange: number
  /** Shannon entropy (bits) of the joint 4-state distribution (s1, s2). */
  entropy: number
  /** Rule births/deaths per layer (excluding transfer events). */
  deaths1: number
  births1: number
  deaths2: number
  births2: number
  /** Transfer event counters for this step (Layer 1 → Layer 2 direction). */
  recycled: number
  dropped: number
  redirected: number
  merged: number
  /** Reverse-direction counters (only non-zero when bidirectional). */
  recycledR: number
  droppedR: number
  redirectedR: number
  mergedR: number
  hashJ: string
  hash1: string
  hash2: string
  outcome: Outcome
  cycleJLen: number | null
  cycle1Len: number | null
  cycle2Len: number | null
}

/** Summary of one experimental run (used by the batch runner and the run log). */
export interface RunSummary {
  config: CAConfig
  configHash: string
  stepsRun: number
  outcome: Outcome
  /** Step at which both layers reached all-0 (joint extinction). */
  extinctStep: number | null
  /** Step at which Layer 1 (resp. 2) first reached all-0. */
  extinct1Step: number | null
  extinct2Step: number | null
  cycleJ: CycleInfo | null
  cycle1: CycleInfo | null
  cycle2: CycleInfo | null
  finalCount1: number
  finalCount2: number
  finalUnion: number
  /** Mean of meanChange over the whole run. */
  activityMean: number
  /** Mean of meanChange over the final 100 steps (steady-state activity). */
  activityLast100: number
  totals: {
    recycled: number
    dropped: number
    redirected: number
    merged: number
    recycledR: number
    droppedR: number
    redirectedR: number
    mergedR: number
    deaths1: number
    deaths2: number
  }
}
