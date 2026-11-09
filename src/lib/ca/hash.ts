// Two-lane FNV-1a hashing for cycle detection and config fingerprints.
// Two independent 32-bit lanes give a 64-bit effective hash: over the run
// lengths used here (≤ 10⁴ states) the false-positive probability is
// negligible (< 10⁻⁹).

const LANE1_BASIS = 0x811c9dc5
const LANE2_BASIS = 0x050c5d01
const PRIME = 0x01000193

function fnvLane(bytes: Uint8Array, basis: number): number {
  let h = basis
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, PRIME)
  }
  return h >>> 0
}

function hex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

/** Hash one or two grids (joint state = layer1 ‖ layer2). */
export function hashGrids(a: Uint8Array, b?: Uint8Array): string {
  const h1a = fnvLane(a, LANE1_BASIS)
  const h2a = fnvLane(a, LANE2_BASIS)
  if (!b) return hex32(h1a) + hex32(h2a)
  const h1b = fnvLane(b, h1a)
  const h2b = fnvLane(b, h2a)
  return hex32(h1b) + hex32(h2b)
}

/** Stable fingerprint of a config. Field names come from the config object
 * itself (sorted), so a field added to CAConfig automatically participates
 * in the fingerprint — a hardcoded key list would silently ignore it. */
export function configFingerprint(cfg: object): string {
  const rec = cfg as Record<string, unknown>
  const keys = Object.keys(rec).sort()
  const str = keys.map((k) => `${k}=${String(rec[k])}`).join('|')
  const bytes = new TextEncoder().encode(str)
  return hex32(fnvLane(bytes, LANE1_BASIS)) + hex32(fnvLane(bytes, LANE2_BASIS))
}
