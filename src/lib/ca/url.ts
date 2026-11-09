// ─────────────────────────────────────────────────────────────────────────────
// URL-encoded configs (shareable workbench links).
//
// Shape (v=1):
//   ?v=1&d=2d&n=16&b=tor&r1=B3/S23&r2=B3/S23&t=same&c=drop&dir=fwd
//    &s=1&den1=0.3&den2=0.3&i=seed1&sg=0&p=1&max=2000
//
// Short keys keep links readable; `v` versions the format so future field
// additions don't break old links. Unknown or invalid values fall back to
// that field's default (a link must never hard-fail the app); a `v` NEWER
// than this app supports falls back to the full default config — the caller
// shows a toast when that happens.
// ─────────────────────────────────────────────────────────────────────────────

import { defaultConfig } from './engine'
import { parseRule, ruleToString } from './rules'
import type { CAConfig } from './types'

export const URL_VERSION = 1

export type DecodeResult =
  | { ok: false; reason: 'empty' | 'newer-version' }
  | { ok: true; config: CAConfig }

const BOUNDARY_SHORT: Record<string, CAConfig['boundary']> = {
  tor: 'toroidal', fix: 'fixed', rep: 'replicate',
}
const TOPOLOGY_SHORT: Record<string, CAConfig['topology']> = {
  same: 'same', near: 'nearest_empty', rand: 'random_empty',
}
const COLLISION_SHORT: Record<string, CAConfig['collision']> = {
  drop: 'drop', over: 'overwrite',
}
const DIRECTION_SHORT: Record<string, CAConfig['direction']> = {
  none: 'none', fwd: 'forward', bi: 'bidirectional',
}
const INIT_MODES: CAConfig['initMode'][] = [
  'both', 'seed1', 'seed2', 'single1', 'single2', 'empty',
]

function boundaryShort(b: CAConfig['boundary']): string {
  return b === 'toroidal' ? 'tor' : b === 'fixed' ? 'fix' : 'rep'
}

function topologyShort(t: CAConfig['topology']): string {
  return t === 'nearest_empty' ? 'near' : t === 'random_empty' ? 'rand' : 'same'
}

function collisionShort(c: CAConfig['collision']): string {
  return c === 'overwrite' ? 'over' : 'drop'
}

function directionShort(d: CAConfig['direction']): string {
  return d === 'forward' ? 'fwd' : d === 'bidirectional' ? 'bi' : 'none'
}

/** Full config → query params (always includes `v`). */
export function encodeConfigToParams(cfg: CAConfig): URLSearchParams {
  const q = new URLSearchParams()
  q.set('v', String(URL_VERSION))
  q.set('d', cfg.dimensionality)
  q.set('n', String(cfg.size))
  q.set('b', boundaryShort(cfg.boundary))
  q.set('r1', cfg.rule1)
  q.set('r2', cfg.rule2)
  q.set('t', topologyShort(cfg.topology))
  q.set('c', collisionShort(cfg.collision))
  q.set('dir', directionShort(cfg.direction))
  q.set('s', String(cfg.seed))
  q.set('den1', String(+cfg.density1.toFixed(4)))
  q.set('den2', String(+cfg.density2.toFixed(4)))
  q.set('i', cfg.initMode)
  q.set('sg', String(cfg.sigma))
  q.set('p', String(cfg.stochasticP))
  q.set('max', String(cfg.maxSteps))
  return q
}

function num(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Query string → config. Recognizes a payload only when at least one of the
 * identity keys (d / n / r1 / r2) is present; otherwise there is nothing to
 * load. A `v` newer than URL_VERSION refuses (reason 'newer-version') so the
 * caller can fall back to defaults with a visible toast. Every invalid or
 * missing field silently falls back to its default — links never hard-fail.
 */
export function decodeConfigFromSearch(search: string): DecodeResult {
  const qs = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(qs)
  const hasPayload =
    params.has('d') || params.has('n') || params.has('r1') || params.has('r2')
  if (!hasPayload) return { ok: false, reason: 'empty' }

  const v = Math.floor(num(params.get('v')) ?? 1)
  if (v > URL_VERSION) return { ok: false, reason: 'newer-version' }

  const cfg = defaultConfig()

  const dim = params.get('d')
  if (dim === '1d' || dim === '2d') cfg.dimensionality = dim

  const size = num(params.get('n'))
  if (size !== undefined) cfg.size = clamp(Math.round(size), 2, 512)

  const b = params.get('b')
  if (b !== null && b in BOUNDARY_SHORT) cfg.boundary = BOUNDARY_SHORT[b]

  // Rules: must parse AND match the selected family — otherwise the family
  // default. Stored canonical ('b36/s23' in a link loads as 'B36/S23').
  // (URL keys are r1/r2; config fields are rule1/rule2 — map explicitly.)
  for (const [paramKey, configKey] of [['r1', 'rule1'], ['r2', 'rule2']] as const) {
    const raw = params.get(paramKey)
    if (raw === null) continue
    try {
      const parsed = parseRule(raw)
      if (parsed.kind === cfg.dimensionality) cfg[configKey] = ruleToString(parsed)
    } catch { /* keep default */ }
  }

  const t = params.get('t')
  if (t !== null && t in TOPOLOGY_SHORT) cfg.topology = TOPOLOGY_SHORT[t]

  const c = params.get('c')
  if (c !== null && c in COLLISION_SHORT) cfg.collision = COLLISION_SHORT[c]

  const dir = params.get('dir')
  if (dir !== null && dir in DIRECTION_SHORT) cfg.direction = DIRECTION_SHORT[dir]

  const seed = num(params.get('s'))
  if (seed !== undefined) cfg.seed = Math.max(0, Math.floor(seed))

  const d1 = num(params.get('den1'))
  if (d1 !== undefined) cfg.density1 = clamp(d1, 0, 1)
  const d2 = num(params.get('den2'))
  if (d2 !== undefined) cfg.density2 = clamp(d2, 0, 1)

  const i = params.get('i')
  if (i !== null && (INIT_MODES as string[]).includes(i)) {
    cfg.initMode = i as CAConfig['initMode']
  }

  const sg = num(params.get('sg'))
  if (sg !== undefined) cfg.sigma = clamp(sg, 0, 16)

  const p = num(params.get('p'))
  if (p !== undefined) cfg.stochasticP = clamp(p, 0, 1)

  const max = num(params.get('max'))
  if (max !== undefined) cfg.maxSteps = clamp(Math.floor(max), 10, 100000)

  return { ok: true, config: cfg }
}

/** Canonical round-trip check: encode → decode must reproduce the config
 *  exactly (used by the test suite; export for reuse). */
export function urlRoundTrip(cfg: CAConfig): boolean {
  const decoded = decodeConfigFromSearch(`?${encodeConfigToParams(cfg).toString()}`)
  if (!decoded.ok) return false
  const a = decoded.config
  return (
    a.dimensionality === cfg.dimensionality && a.size === cfg.size &&
    a.boundary === cfg.boundary && a.rule1 === cfg.rule1 && a.rule2 === cfg.rule2 &&
    a.topology === cfg.topology && a.collision === cfg.collision &&
    a.direction === cfg.direction && a.seed === cfg.seed &&
    a.density1 === cfg.density1 && a.density2 === cfg.density2 &&
    a.initMode === cfg.initMode && a.sigma === cfg.sigma &&
    a.stochasticP === cfg.stochasticP && a.maxSteps === cfg.maxSteps
  )
}

/** Replace the current URL's query with the encoded config (client only).
 *  replaceState keeps the browser history clean — configuring is navigation
 *  noise, not navigation. */
export function syncConfigUrl(cfg: CAConfig): void {
  if (typeof window === 'undefined') return
  const params = encodeConfigToParams(cfg)
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`)
}
