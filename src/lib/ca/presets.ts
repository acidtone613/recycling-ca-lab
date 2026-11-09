// Named rule presets for the GUI selectors (standard rules only).

export interface RulePreset2D {
  name: string
  rule: string
  note: string
}

export interface RulePreset1D {
  name: string
  code: number
  note: string
}

export const PRESETS_2D: RulePreset2D[] = [
  { name: 'Life', rule: 'B3/S23', note: 'Conway 1970 — the classic' },
  { name: 'HighLife', rule: 'B36/S23', note: 'Life + replicator' },
  { name: 'Passive (record mode)', rule: 'B/S012345678', note: 'survives everything, never births — L2 becomes a record of L1 deaths' },
  { name: 'Seeds', rule: 'B2/S', note: 'explosive; everything dies each gen' },
  { name: 'Day & Night', rule: 'B3678/S34678', note: 'self-complementary' },
  { name: 'Maze', rule: 'B3/S12345', note: 'grows maze walls' },
  { name: 'Mazectric', rule: 'B3/S1234', note: 'long straight corridors' },
  { name: 'Replicator', rule: 'B1357/S1357', note: 'odd counts copy patterns' },
  { name: '2×2', rule: 'B36/S125', note: 'preserves 2×2 blocks' },
  { name: 'Diamoeba', rule: 'B35678/S5678', note: 'grows diamond amoebas' },
  { name: 'Anneal', rule: 'B4678/S35678', note: 'annealing-like coarsening' },
  { name: 'Coral', rule: 'B3/S45678', note: 'slow coral growth' },
  { name: 'Assimilation', rule: 'B345/S4567', note: 'assimilating growth' },
]

export const PRESETS_1D: RulePreset1D[] = [
  { name: 'Rule 0', code: 0, note: 'uniform death' },
  { name: 'Rule 22', code: 22, note: 'complex fractals' },
  { name: 'Rule 30', code: 30, note: 'chaotic (randomizer)' },
  { name: 'Rule 51', code: 51, note: 'complement — period 2' },
  { name: 'Rule 54', code: 54, note: 'class-2 blobs' },
  { name: 'Rule 60', code: 60, note: 'additive' },
  { name: 'Rule 90', code: 90, note: 'Sierpinski — additive' },
  { name: 'Rule 105', code: 105, note: 'complement of 90' },
  { name: 'Rule 110', code: 110, note: 'Turing-complete' },
  { name: 'Rule 122', code: 122, note: 'chaotic stripes' },
  { name: 'Rule 126', code: 126, note: 'chaotic with structure' },
  { name: 'Rule 150', code: 150, note: 'additive (XOR of 3)' },
  { name: 'Rule 184', code: 184, note: 'traffic flow' },
  { name: 'Rule 204', code: 204, note: 'identity — L2 records L1 deaths (1D record mode)' },
]
