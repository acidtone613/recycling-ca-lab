// ─────────────────────────────────────────────────────────────────────────────
// Rule families (Phase 0.1) — standard binary CA rules only.
//
//   1D elementary CA: a Wolfram code 0–255 is an 8-bit lookup table over the
//   three-cell neighbourhood (left, centre, right), indexed by
//   4·left + 2·centre + 1·right.
//
//   2D Life-like CA: B*/S* — B lists the live-neighbour counts (Moore, 8
//   neighbours) that cause a birth (dead → alive), S the counts that allow
//   survival (alive → alive). Conway's Life is B3/S23.
// ─────────────────────────────────────────────────────────────────────────────

import type { Boundary } from './types'

export interface BSRule {
  kind: '2d'
  /** birth[n] = a dead cell with n live neighbours becomes alive. */
  birth: boolean[]
  /** survival[n] = an alive cell with n live neighbours stays alive. */
  survival: boolean[]
}

export interface ECARule {
  kind: '1d'
  /** Wolfram code 0–255. */
  code: number
}

export type CARule = BSRule | ECARule

class RuleParseError extends Error {}

function parseBS(s: string): BSRule {
  const m = /^B?(\d*)\/S?(\d*)$/i.exec(s.trim())
  if (!m) throw new RuleParseError(`Invalid B/S rule: "${s}"`)
  const read = (digits: string): boolean[] => {
    const table = new Array(9).fill(false)
    for (const ch of digits) {
      const n = ch.charCodeAt(0) - 48
      if (n < 0 || n > 8) throw new RuleParseError(`Neighbour count out of range 0–8: "${ch}"`)
      table[n] = true
    }
    return table
  }
  return { kind: '2d', birth: read(m[1]), survival: read(m[2]) }
}

function parseECA(s: string): ECARule {
  const m = /^(?:W|w)?(\d{1,3})$/.exec(s.trim())
  if (!m) throw new RuleParseError(`Invalid Wolfram code: "${s}"`)
  const code = parseInt(m[1], 10)
  if (code < 0 || code > 255) throw new RuleParseError(`Wolfram code out of range 0–255: ${code}`)
  return { kind: '1d', code }
}

/**
 * Parse a rule string. 'B3/S23' → Life-like; 'W110' (or bare '110') →
 * elementary. Strings containing '/' are always B/S; bare digits are Wolfram.
 */
export function parseRule(s: string): CARule {
  return s.includes('/') ? parseBS(s) : parseECA(s)
}

/** Canonical serialization ('B3/S23' / 'W110') — also serves as config key. */
export function ruleToString(r: CARule): string {
  if (r.kind === '1d') return `W${r.code}`
  const list = (t: boolean[]) => t.map((v, i) => (v ? String(i) : '')).join('')
  return `B${list(r.birth)}/S${list(r.survival)}`
}

export function rulesEqual(a: CARule, b: CARule): boolean {
  return ruleToString(a) === ruleToString(b)
}

/**
 * True iff the all-0 grid is a fixed point: no B0 for Life-like rules, and an
 * even Wolfram code for ECA (odd codes birth from the empty neighbourhood
 * (0,0,0) → 1, e.g. W51).
 */
export function isQuiescent(r: CARule): boolean {
  return r.kind === '1d' ? (r.code & 1) === 0 : !r.birth[0]
}

// ── Neighbour table (2D) ─────────────────────────────────────────────────────
// nbTable[i*8 + k] = index of neighbour k of cell i, or −1 if outside a fixed
// boundary. Order: clockwise from North — N, NE, E, SE, S, SW, W, NW.
// (The same table doubles as the `nearest_empty` scan order.)

const NB_DX = [0, 1, 1, 1, 0, -1, -1, -1]
const NB_DY = [-1, -1, 0, 1, 1, 1, 0, -1]

export function buildNeighborTable(W: number, H: number, boundary: Boundary): Int32Array {
  const nb = new Int32Array(W * H * 8)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const base = (y * W + x) * 8
      for (let k = 0; k < 8; k++) {
        let nx = x + NB_DX[k]
        let ny = y + NB_DY[k]
        if (boundary === 'toroidal') {
          nx = (nx + W) % W
          ny = (ny + H) % H
          nb[base + k] = ny * W + nx
        } else if (nx < 0 || nx >= W || ny < 0 || ny >= H) {
          // Out of bounds: `replicate` clamps the coordinates into the grid —
          // the out-of-bounds neighbour is replaced by the nearest edge cell
          // (an edge cell can end up being its own neighbour). `fixed` maps
          // it to dead instead.
          if (boundary === 'replicate') {
            nx = Math.min(W - 1, Math.max(0, nx))
            ny = Math.min(H - 1, Math.max(0, ny))
            nb[base + k] = ny * W + nx
          } else {
            nb[base + k] = -1
          }
        } else {
          nb[base + k] = ny * W + nx
        }
      }
    }
  }
  return nb
}

// ── Rule application (pure, in-place into `next`) ────────────────────────────

/** 2D Life-like step over a W×H grid. */
export function step2D(
  cur: Uint8Array,
  next: Uint8Array,
  W: number,
  H: number,
  rule: BSRule,
  nb: Int32Array,
): void {
  const B = rule.birth
  const S = rule.survival
  const n = W * H
  for (let i = 0; i < n; i++) {
    let c = 0
    const base = i * 8
    for (let k = 0; k < 8; k++) {
      const j = nb[base + k]
      if (j >= 0 && cur[j] === 1) c++
    }
    next[i] = cur[i] === 1 ? (S[c] ? 1 : 0) : (B[c] ? 1 : 0)
  }
}

/** 1D elementary step over a row of N cells. */
export function step1D(
  cur: Uint8Array,
  next: Uint8Array,
  N: number,
  code: number,
  boundary: Boundary,
): void {
  for (let i = 0; i < N; i++) {
    const l =
      i > 0 ? cur[i - 1]
      : boundary === 'toroidal' ? cur[N - 1]
      : boundary === 'replicate' ? cur[i]
      : 0
    const r =
      i < N - 1 ? cur[i + 1]
      : boundary === 'toroidal' ? cur[0]
      : boundary === 'replicate' ? cur[i]
      : 0
    const idx = ((l << 2) | (cur[i] << 1) | r) & 7
    next[i] = (code >> idx) & 1
  }
}
