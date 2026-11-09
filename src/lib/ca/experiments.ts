// Types for the precomputed batch-experiment results (public/data/experiments.json),
// produced by scripts/run-experiments.ts + scripts/analyze-results.ts.

export interface ConfigAgg {
  /** Fraction of runs with joint extinction (both layers all-0). */
  extinctFrac: number
  /** Fraction of runs where a joint limit cycle was detected. */
  cycleFrac: number
  /** Fraction still active at the step cap (censored). */
  activeFrac: number
  medianExtinctStep: number | null
  medianCycleLen: number | null
  /** Median of activityLast100 (steady-state mean change per cell). */
  medianActivity: number
  /** Median final union density (live cells in L1∪L2 / cells per layer). */
  medianUnionDensity: number
  layer1ExtinctFrac: number
  layer2ExtinctFrac: number
  medianLayer1ExtinctStep: number | null
  medianLayer2ExtinctStep: number | null
  /** Median recycled events per step (coupled configs only). */
  medianRecycledPerStep: number | null
  medianDroppedPerStep: number | null
}

export interface ConfigResult {
  id: string
  dim: '1d' | '2d'
  rule1: string
  rule2: string
  topology: 'same' | 'nearest_empty' | 'random_empty' | 'none'
  collision: 'drop' | 'overwrite' | 'none'
  /** The runner currently records 'forward' (coupled) and 'none' (baseline);
   * 'bidirectional' is supported by the engine and allowed here so future
   * sweeps can record it without a type change. */
  direction: 'forward' | 'bidirectional' | 'none'
  density: number
  seeds: number
  agg: ConfigAgg
  /** Compact per-run records: [seed, outcome(0 run/1 extinct/2 cycle/3 active), steps, extStep, ext1Step, ext2Step, cycleJLen, cycle1Len, cycle2Len, activityLast100, unionDensity]. Present in the full archive; stripped from the app payload. */
  runs?: number[][]
  /** Time-aligned mean trajectory across runs: slot k is step (k+1)·stride
   * (the runner's sampling stride), ~30 samples of [count1, count2, union,
   * meanChange]. Runs that ended before a slot are padded with their final
   * value (extinct runs pad with all-zeros — extinction is absorbing), so
   * every slot averages over all runs of the configuration. */
  meanTraj: number[][]
}

export interface ExperimentsFile {
  meta: {
    generatedAt: string
    seeds: number
    densities: number[]
    byDim: Record<'1d' | '2d', { size: number; maxSteps: number; rulePairs: [string, string][] }>
    findings: string
    note: string
  }
  configs: ConfigResult[]
}

export async function loadExperiments(): Promise<ExperimentsFile | null> {
  try {
    const res = await fetch('/data/experiments.json')
    if (!res.ok) return null
    return (await res.json()) as ExperimentsFile
  } catch {
    return null
  }
}

export const TOPOLOGY_LABEL: Record<string, string> = {
  same: 'same-coordinate',
  nearest_empty: 'nearest empty',
  random_empty: 'random empty',
  none: '—',
}

export const COLLISION_LABEL: Record<string, string> = {
  drop: 'drop (lossy)',
  overwrite: 'overwrite (guaranteed)',
  none: '—',
}

/** Human label for a coupled combo or baseline. */
export function comboLabel(c: ConfigResult): string {
  if (c.direction === 'none') return 'uncoupled layers'
  return `${TOPOLOGY_LABEL[c.topology]} + ${c.collision}`
}
