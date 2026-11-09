// Deterministic PRNG (mulberry32). All engine randomness — initial state and
// random recycling targets — flows through a single seeded stream, so the
// same seed + same config always produces a bit-identical rollout.
export class Rng {
  private s: number

  constructor(seed: number) {
    // Avoid the fixed point at 0 for hygiene; otherwise seed is used verbatim.
    this.s = (seed >>> 0) || 0x9e3779b9
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n))
  }

  /** Current internal state (included in stochastic cycle-detection keys). */
  get state(): number {
    return this.s >>> 0
  }
}
