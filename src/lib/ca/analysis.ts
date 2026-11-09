// ─────────────────────────────────────────────────────────────────────────────
// Analysis observables — pure functions over engine outputs.
//
// Nothing in this file touches engine state: every function takes plain data
// (a bit sequence, a stats snapshot, a rule string) and returns new values.
// The workbench calls these from its (optional) analysis panels; the engine
// test suite cross-checks them against independent references.
//
// Contents:
//   • linearComplexityProfile — incremental Berlekamp–Massey over GF(2)
//     (linear complexity L(n) of a bit sequence: flat = short linear
//     recurrence / periodic, slope ≈ ½ = random-looking / chaotic)
//   • coverage / hiddenFraction — layer-overlap observables derived from a
//     StepStats snapshot (|L1 ∩ L2| relative to the sparser layer / the union)
//   • anfGrowth — algebraic-normal-form degree growth of a 1D Wolfram rule's
//     centre cell (W90 stays degree 1; W30's degree climbs toward t)
// ─────────────────────────────────────────────────────────────────────────────

import { type ECARule, parseRule, step1D } from './rules'

// ── Berlekamp–Massey (GF(2)) ─────────────────────────────────────────────────

/**
 * Incremental Berlekamp–Massey over GF(2).
 *
 * Returns L[n] = linear complexity of seq[0..n] for each n — the length of
 * the shortest binary linear recurrence that generates the first n+1 terms:
 *   seq[n] = c₁·seq[n−1] ⊕ c₂·seq[n−2] ⊕ … ⊕ c_L·seq[n−L].
 *
 * Reading the profile:
 *   • L(n) flat and small → the sequence satisfies a short linear recurrence
 *     (a linear rule such as W90, or a low-period limit cycle).
 *   • L(n) ≈ n/2 → no short recurrence exists; the sequence looks random
 *     (chaotic rules such as W30 track this line).
 *
 * seq must be a Uint8Array with values 0 or 1. The all-zero sequence returns
 * all zeros. L(n) is monotonically non-decreasing (a property of the
 * algorithm — asserted in the test suite).
 *
 * Pure: allocates only the output array; no module state, no side effects.
 */
export function linearComplexityProfile(seq: Uint8Array): Uint16Array {
  const n = seq.length
  const L = new Uint16Array(n)
  if (n === 0) return L

  // Connection polynomial C (coefficients over GF(2)); C[0] = 1, C[j] is the
  // coefficient of x^j. B is the copy of C saved at the last length change.
  // The general-field algorithm carries a scalar b (the previous
  // discrepancy); over GF(2) b is provably always 1 — it is only assigned d,
  // and d = 1 in every branch that assigns it — so d/b = 1 and b is elided.
  const C: number[] = [1]
  let B: number[] = [1]
  let Lcur = 0
  let m = 1

  for (let i = 0; i < n; i++) {
    // Discrepancy: d = seq[i] ⊕ Σ_{j=1..Lcur} C[j]·seq[i−j]  (over GF(2)).
    // The invariant Lcur ≤ i holds at loop entry (the algorithm maintains
    // it), so seq[i−j] is always in range; the `j <= i` bound is defensive.
    let d = seq[i]
    for (let j = 1; j <= Lcur && j <= i; j++) {
      if (j < C.length && C[j] === 1) d ^= seq[i - j]
    }

    if (d === 0) {
      // The current LFSR already explains the new term.
      m += 1
    } else {
      // C ← C − (d/b)·x^m·B ; with b = 1 over GF(2) this is C ^= x^m·B.
      const T = C.slice()
      const need = B.length + m
      while (C.length < need) C.push(0)
      for (let j = 0; j < B.length; j++) C[j + m] ^= B[j]

      if (2 * Lcur <= i) {
        // Length change: the discrepancy forces a longer recurrence.
        Lcur = i + 1 - Lcur
        B = T
        m = 1
      } else {
        m += 1
      }
    }

    L[i] = Lcur
  }

  return L
}

// ── Layer-overlap observables (coverage / hidden fraction) ───────────────────

/**
 * Coverage — how much of the sparser layer is shadowed by the other:
 * |L1 ∩ L2| / min(|L1|, |L2|). 1 means every live cell of the sparser layer
 * coexists with a live cell of the other layer at the same site.
 *
 * Edge cases (design choices, per the proposal):
 *   • both layers empty → 1 (vacuously fully covered);
 *   • exactly one layer empty → 0 (nothing of the live layer is shadowed).
 */
export function coverage(s: { count1: number; count2: number; intersect: number }): number {
  const min = Math.min(s.count1, s.count2)
  if (min === 0) return s.count1 === 0 && s.count2 === 0 ? 1 : 0
  return s.intersect / min
}

/**
 * Hidden fraction — the share of the union that is double-covered:
 * |L1 ∩ L2| / |L1 ∪ L2|. In the 4-state overlay a double-live cell shows as
 * "both" and hides its per-layer identity, so this is exactly the fraction
 * of visible activity whose layer membership is not determined by the map.
 *
 * Edge case (design choice, per the proposal): union empty → 1 (vacuously
 * "everything visible is also double").
 */
export function hiddenFraction(s: { count1: number; count2: number; intersect: number }): number {
  const union = s.count1 + s.count2 - s.intersect
  if (union === 0) return 1
  return s.intersect / union
}

// ── ANF degree growth for 1D Wolfram rules ───────────────────────────────────

/** Row type of the ANF growth curve: after t steps, the centre cell is a
 *  Boolean polynomial (algebraic normal form) in the 2t+1 initial cells —
 *  `degree` is its maximum monomial degree, `monomials` the number of
 *  nonzero ANF coefficients. */
export interface AnfLevel {
  t: number
  degree: number
  monomials: number
}

/** Hard cap: t = 10 means a 2²¹-entry truth table (2M evaluations of a
 *  21-cell CA plus a 21-pass Möbius transform) — the largest level that
 *  still computes in seconds rather than minutes. */
const ANF_T_MAX = 10

function parseEcaOrThrow(rule: string): ECARule {
  const parsed = parseRule(rule)
  if (parsed.kind !== '1d') {
    throw new Error(`anfGrowth: expected a 1D Wolfram rule (e.g. "W30"), got "${rule}"`)
  }
  return parsed
}

/** popcount over the 21-bit masks that occur here (size ≤ 2^21). */
function popcount(v: number): number {
  let c = 0
  while (v > 0) {
    v &= v - 1
    c++
  }
  return c
}

/**
 * One level of the ANF growth curve. Pure function of (rule, t): a minimal
 * local CA — two Uint8Array row buffers stepped by the shared pure step1D —
 * deliberately NOT a RecyclingCA instance, so the result cannot depend on
 * (or disturb) any workbench engine state.
 *
 * Method: the centre cell after t steps depends exactly on the 2t+1 initial
 * cells inside its light cone (a 1-cell/step rule cannot reach further, so
 * a fixed-boundary width-(2t+1) grid reproduces the infinite-line value).
 * Enumerate all 2^(2t+1) initial states → truth table of the centre cell;
 * in-place Möbius transform over GF(2) turns it into ANF coefficients
 * (f[mask] = coefficient of the monomial in the variables whose bits are
 * set in mask); read off monomial count and maximum degree.
 */
function anfLevel(rule: ECARule, t: number): AnfLevel {
  const w = 2 * t + 1 // initial window width
  const size = 1 << w // 2^w initial states
  const f = new Uint8Array(size)
  const rowA = new Uint8Array(w)
  const rowB = new Uint8Array(w)
  for (let state = 0; state < size; state++) {
    // Unpack: bit k of state = initial value of cell k.
    for (let k = 0; k < w; k++) rowA[k] = (state >> k) & 1
    let cur = rowA
    let buf = rowB
    for (let s = 0; s < t; s++) {
      step1D(cur, buf, w, rule.code, 'fixed')
      const swap = cur
      cur = buf
      buf = swap
    }
    f[state] = cur[t] // centre cell (index t) after t steps
  }

  // In-place Möbius transform over GF(2): f becomes the ANF coefficients.
  for (let i = 0; i < w; i++) {
    const bit = 1 << i
    for (let j = 0; j < size; j++) {
      if ((j & bit) !== 0) f[j] ^= f[j ^ bit]
    }
  }

  let monomials = 0
  let degree = 0
  for (let mask = 0; mask < size; mask++) {
    if (f[mask] === 1) {
      monomials++
      const pc = popcount(mask)
      if (pc > degree) degree = pc
    }
  }
  return { t, degree, monomials }
}

/** Single-level entry point (used by the UI to compute incrementally, one
 *  t per frame slot, so the browser stays responsive). */
export function anfGrowthLevel(rule: string, t: number): AnfLevel {
  if (!Number.isInteger(t) || t < 0 || t > ANF_T_MAX) {
    throw new Error(`anfGrowth: t must be an integer in [0, ${ANF_T_MAX}]`)
  }
  return anfLevel(parseEcaOrThrow(rule), t)
}

/**
 * ANF growth curve of a 1D Wolfram rule (e.g. "W30") for t = 0..tMax:
 * degree(t) = max monomial degree of the centre cell's algebraic normal form
 * as a polynomial in the 2t+1 initial cells; monomials(t) = number of
 * nonzero ANF coefficients. Cost is O(2^(2tMax+1) · tMax) — tMax is capped
 * at 10 (2^21 truth-table evaluations at t = 10).
 */
export function anfGrowth(rule: string, tMax: number): AnfLevel[] {
  if (!Number.isInteger(tMax) || tMax < 0) {
    throw new Error('anfGrowth: tMax must be a non-negative integer')
  }
  if (tMax > ANF_T_MAX) {
    throw new Error('anfGrowth: tMax capped at 10 (2^21 evaluations at t=10)')
  }
  const parsed = parseEcaOrThrow(rule)
  const results: AnfLevel[] = []
  for (let t = 0; t <= tMax; t++) results.push(anfLevel(parsed, t))
  return results
}
