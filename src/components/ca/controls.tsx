'use client'

// Control sidebar — exposes every independent variable of the experiment:
// dimension, per-layer rules (presets + custom editors), recycling topology,
// collision semantics, coupling direction, grid size/boundary, initial state
// protocol, seed and step cap.

import { useState } from 'react'
import { PRESETS_1D, PRESETS_2D, type RulePreset1D, type RulePreset2D } from '@/lib/ca/presets'
import type { CAConfig } from '@/lib/ca/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { Dices, PencilLine } from 'lucide-react'

const SIZES_2D = [8, 16, 32, 64, 128]
const SIZES_1D = [32, 64, 128, 256]

const INIT_MODE_HINT: Record<CAConfig['initMode'], string> = {
  both: 'Both layers start random at their own densities — Layer 2 has its own rule-driven dynamics from step 0 and the recycling is layered on top.',
  seed1: 'Layer 2 starts empty and only receives cells via recycling — the first few steps show the transfer directly. Combined with a passive Layer 2 rule (B/S012345678), this is a pure record of Layer 1 deaths.',
  seed2: 'Layer 1 starts empty; Layer 2 random. With coupling on, Layer 1 deaths land on top of Layer 2\u2019s own dynamics.',
  single1: 'A single centre cell in Layer 1 — everything that happens afterwards comes from the rules and the recycling.',
  single2: 'A single centre cell in Layer 2 — Layer 1 stays empty until deaths feed it (needs bidirectional coupling).',
  empty: 'Blank board — draw your own initial state with the pointer directly on the grids.',
}

function parseBS(rule: string): { b: boolean[]; s: boolean[] } {
  const m = /^B?(\d*)\/S?(\d*)$/i.exec(rule) ?? null
  const b = new Array(9).fill(false)
  const s = new Array(9).fill(false)
  if (m) {
    for (const ch of m[1]) b[+ch] = true
    for (const ch of m[2]) s[+ch] = true
  }
  return { b, s }
}

function bsToString(b: boolean[], s: boolean[]): string {
  const list = (t: boolean[]) => t.map((v, i) => (v ? String(i) : '')).join('')
  return `B${list(b)}/S${list(s)}`
}

// ── Custom rule editor dialog ────────────────────────────────────────────────

function RuleEditorDialog({
  open, onClose, rule, dimensionality, onSave,
}: {
  open: boolean
  onClose: () => void
  rule: string
  dimensionality: '1d' | '2d'
  onSave: (rule: string) => void
}) {
  const [bs, setBs] = useState(() => parseBS(rule))
  const [code, setCode] = useState(() => (/^W(\d+)$/.exec(rule)?.[1] ?? '90'))

  const canonical =
    dimensionality === '2d'
      ? bsToString(bs.b, bs.s)
      : `W${Math.max(0, Math.min(255, parseInt(code || '0', 10) || 0))}`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Custom rule editor</DialogTitle>
          <DialogDescription>
            {dimensionality === '2d'
              ? 'Life-like B/S rule over the Moore neighbourhood (8 neighbours). Tick the live-neighbour counts that cause a birth (B) or allow survival (S).'
              : 'Elementary CA: enter a Wolfram code 0–255 (8-bit lookup table over left/centre/right).'}
          </DialogDescription>
        </DialogHeader>

        {dimensionality === '2d' ? (
          <div className="space-y-4">
            {(['b', 's'] as const).map((key) => (
              <div key={key}>
                <p className="mb-2 text-sm font-medium">
                  {key === 'b' ? 'Birth (dead → alive) at live-neighbour count' : 'Survival (alive → alive) at count'}
                </p>
                <div className="grid grid-cols-9 gap-1">
                  {Array.from({ length: 9 }, (_, n) => (
                    <label key={n} className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                      <Checkbox
                        checked={bs[key][n]}
                        onCheckedChange={(v) =>
                          setBs((prev) => {
                            const next = { b: [...prev.b], s: [...prev.s] }
                            next[key][n] = v === true
                            return next
                          })
                        }
                        aria-label={`${key === 'b' ? 'Birth' : 'Survival'} at ${n}`}
                      />
                      {n}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {bs.b[0] && (
              <p className="text-xs text-amber-400">
                ⚠ B0: the all-dead state is not absorbing — a fully dead layer regrows, so
                extinction can never be reached.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="wolfram">Wolfram code (0–255)</Label>
            <Input
              id="wolfram"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            />
            <div className="flex flex-wrap gap-1">
              {PRESETS_1D.slice(2, 12).map((p) => (
                <Button key={p.code} variant="outline" size="sm" className="h-6 px-2 text-xs"
                  onClick={() => setCode(String(p.code))}>
                  {p.code}
                </Button>
              ))}
            </div>
            {parseInt(code, 10) % 2 === 1 && (
              <p className="text-xs text-amber-400">
                ⚠ Odd Wolfram codes map the empty neighbourhood (0,0,0) → 1: the all-dead
                state is not absorbing, so extinction can never be reached.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onSave(canonical); onClose() }}>Apply rule {canonical}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Rule selector (preset dropdown + custom editor) ─────────────────────────

function RuleSelector({
  label, rule, dimensionality, onChange, accent,
}: {
  label: string
  rule: string
  dimensionality: '1d' | '2d'
  onChange: (rule: string) => void
  accent: string
}) {
  const [editing, setEditing] = useState(false)
  const presets = dimensionality === '2d' ? PRESETS_2D : PRESETS_1D
  // Canonical selector value of a preset (B/S string in 2D, W-code in 1D).
  // Branching on dimensionality FIRST lets TS narrow the preset union.
  const presetKey = (p: RulePreset2D | RulePreset1D): string =>
    dimensionality === '2d' && 'rule' in p ? p.rule : `W${(p as RulePreset1D).code}`
  const matchesPreset = presets.some((p) => presetKey(p) === rule)
  const value = matchesPreset ? rule : '__custom'
  const current = presets.find((p) => presetKey(p) === rule)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: accent }} />
          {label}
        </Label>
        <span className="font-mono text-[11px] text-muted-foreground">{rule}</span>
      </div>
      <div className="flex gap-1.5">
        <Select value={value} onValueChange={(v) => (v === '__custom' ? setEditing(true) : onChange(v))}>
          <SelectTrigger className="h-8 text-xs" aria-label={`${label} rule`}>
            <SelectValue placeholder="Rule" />
          </SelectTrigger>
          <SelectContent>
            {(dimensionality === '2d' ? (presets as typeof PRESETS_2D).map((p) => (
              <SelectItem key={p.rule} value={p.rule} className="text-xs">
                {p.name} <span className="text-muted-foreground">— {p.note}</span>
              </SelectItem>
            )) : (presets as typeof PRESETS_1D).map((p) => (
              <SelectItem key={`W${p.code}`} value={`W${p.code}`} className="text-xs">
                {p.name} <span className="text-muted-foreground">— {p.note}</span>
              </SelectItem>
            )))}
            <Separator />
            <SelectItem value="__custom" className="text-xs">Custom…</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setEditing(true)}
          aria-label={`Edit ${label} rule`}>
          <PencilLine className="h-3.5 w-3.5" />
        </Button>
      </div>
      {current && <p className="text-[11px] text-muted-foreground">{current.note}</p>}
      <RuleEditorDialog
        open={editing}
        onClose={() => setEditing(false)}
        rule={rule}
        dimensionality={dimensionality}
        onSave={onChange}
      />
    </div>
  )
}

// ── Main controls ────────────────────────────────────────────────────────────

export function Controls({
  config, onChange,
}: {
  config: CAConfig
  onChange: (partial: Partial<CAConfig>) => void
}) {
  const twoD = config.dimensionality === '2d'

  const switchDimension = (dim: '1d' | '2d') => {
    if (dim === config.dimensionality) return
    onChange({
      dimensionality: dim,
      rule1: dim === '2d' ? 'B3/S23' : 'W90',
      rule2: dim === '2d' ? 'B3/S23' : 'W90',
      size: dim === '2d' ? 16 : 64,
    })
  }

  return (
    <div className="space-y-5 text-sm">
      {/* Dimension */}
      <section className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rule family
        </Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(['1d', '2d'] as const).map((d) => (
            <button
              key={d}
              onClick={() => switchDimension(d)}
              className={cn(
                'rounded-md border px-2 py-1.5 text-xs transition-colors',
                config.dimensionality === d
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200',
              )}
              aria-pressed={config.dimensionality === d}
            >
              {d === '1d' ? '1D · Elementary (W)' : '2D · Life-like (B/S)'}
            </button>
          ))}
        </div>
        <RuleSelector label="Layer 1 rule" rule={config.rule1} dimensionality={config.dimensionality}
          onChange={(rule1) => onChange({ rule1 })} accent="#fbbf24" />
        <RuleSelector label="Layer 2 rule" rule={config.rule2} dimensionality={config.dimensionality}
          onChange={(rule2) => onChange({ rule2 })} accent="#2dd4bf" />
      </section>

      <Separator />

      {/* Coupling */}
      <section className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recycling (the coupling)
        </Label>
        <div className="space-y-1.5">
          <Label className="text-xs">Direction</Label>
          <Select value={config.direction} onValueChange={(v) => onChange({ direction: v as CAConfig['direction'] })}>
            <SelectTrigger className="h-8 text-xs" aria-label="Coupling direction"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">Off — independent layers (baseline)</SelectItem>
              <SelectItem value="forward" className="text-xs">Unidirectional — L1 deaths → L2</SelectItem>
              <SelectItem value="bidirectional" className="text-xs">Bidirectional — + L2 deaths → L1</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Topology (target selection)</Label>
          <Select value={config.topology} onValueChange={(v) => onChange({ topology: v as CAConfig['topology'] })}
            disabled={config.direction === 'none'}>
            <SelectTrigger className="h-8 text-xs" aria-label="Recycling topology"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="same" className="text-xs">Same coordinate</SelectItem>
              <SelectItem value="nearest_empty" className="text-xs">Nearest empty (origin → ring)</SelectItem>
              <SelectItem value="random_empty" className="text-xs">Random empty (uniform)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {config.topology === 'same' && 'Birth tries the death cell’s own coordinate in Layer 2 — “same, if empty” in the roadmap’s table. σ does not apply here.'}
            {config.topology === 'nearest_empty' && 'Scans the origin, then the Moore ring clockwise from North (1D: origin, left, right).'}
            {config.topology === 'random_empty' && 'Picks a uniformly random empty cell anywhere in Layer 2 — non-local; destroys spatial correlation.'}
          </p>
        </div>
        {(config.topology === 'nearest_empty' || config.topology === 'random_empty') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Recycling distance falloff (σ)</Label>
              <span className="font-mono text-xs text-amber-300">
                {config.sigma === 0 ? 'off — topology default' : `σ = ${config.sigma.toFixed(1)}`}
              </span>
            </div>
            <Slider
              value={[config.sigma]} min={0} max={16} step={0.5}
              onValueChange={([v]) => onChange({ sigma: v })}
              aria-label="Recycling distance falloff sigma"
              disabled={config.direction === 'none'}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              σ = 0 keeps the topology’s default rule. With σ &gt; 0 the candidate empty cells are weighted by a
              Gaussian centred on the death site — small σ keeps recycled births near the death site
              (approaching nearest-empty), large σ approaches uniform (random-empty): a continuous
              interpolation between the two.
            </p>
          </div>
        )}
        {config.sigma === 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Rule reliability (p)</Label>
              <span className="font-mono text-xs text-amber-300">
                {config.stochasticP >= 1 ? 'deterministic' : `p = ${config.stochasticP.toFixed(2)}`}
              </span>
            </div>
            <Slider
              value={[config.stochasticP]} min={0.5} max={1} step={0.01}
              onValueChange={([v]) => onChange({ stochasticP: v })}
              aria-label="Rule reliability"
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              With probability 1 − p each cell ignores its rule output and keeps its current state — the
              run becomes a Markov chain (cycle detection stays genuine via RNG tagging). p = 1 is the
              deterministic CA. Hidden while σ &gt; 0 to keep the panel calm — the two knobs are
              independent.
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-xs">Collision semantics</Label>
          <Select value={config.collision} onValueChange={(v) => onChange({ collision: v as CAConfig['collision'] })}
            disabled={config.direction === 'none'}>
            <SelectTrigger className="h-8 text-xs" aria-label="Collision semantics"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="drop" className="text-xs">Drop — lossy</SelectItem>
              <SelectItem value="overwrite" className="text-xs">Overwrite — guaranteed delivery</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {config.collision === 'drop'
              ? 'Events whose target is occupied/unavailable are lost — aliveness leaks, extinction is reachable.'
              : 'Every death yields exactly one birth: redirect to a random empty cell (merge at the origin if L2 is full). Note: literally forcing a 1 onto an occupied cell is a state no-op in binary layers — redirect is what makes overwrite meaningful and aliveness-conserving.'}
          </p>
        </div>
      </section>

      <Separator />

      {/* Grid */}
      <section className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Grid
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{twoD ? 'Size (N×N)' : 'Row length'}</Label>
            <Select value={String(config.size)} onValueChange={(v) => onChange({ size: +v })}>
              <SelectTrigger className="h-8 text-xs" aria-label="Grid size"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(twoD ? SIZES_2D : SIZES_1D).map((s) => (
                  <SelectItem key={s} value={String(s)} className="text-xs">{s}{twoD ? ` × ${s}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Boundary</Label>
            <Select value={config.boundary} onValueChange={(v) => onChange({ boundary: v as CAConfig['boundary'] })}>
              <SelectTrigger className="h-8 text-xs" aria-label="Boundary"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="toroidal" className="text-xs">Toroidal (wrap)</SelectItem>
                <SelectItem value="fixed" className="text-xs">Fixed (dead edge)</SelectItem>
                <SelectItem value="replicate" className="text-xs">Replicate (edge cell itself)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {config.boundary === 'toroidal' && 'The grid wraps around — no edge, finite but boundary-free.'}
              {config.boundary === 'fixed' && 'Outside the grid is dead: patterns feel the edge and die against it.'}
              {config.boundary === 'replicate' && 'An out-of-bounds neighbour is replaced by the nearest edge cell (coordinates clamped into the grid) — the edge acts like a mirror without a halo.'}
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Step cap</Label>
          <Input
            type="number" min={10} max={20000} className="h-8 text-xs"
            value={config.maxSteps}
            onChange={(e) => onChange({ maxSteps: Math.max(10, +e.target.value || 1000) })}
            aria-label="Maximum steps"
          />
        </div>
      </section>

      <Separator />

      {/* Initial state */}
      <section className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Initial state
        </Label>
        <div className="space-y-1.5">
          <Label className="text-xs">Protocol</Label>
          <Select value={config.initMode} onValueChange={(v) => onChange({ initMode: v as CAConfig['initMode'] })}>
            <SelectTrigger className="h-8 text-xs" aria-label="Initial state protocol"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="both" className="text-xs">Both layers random at density</SelectItem>
              <SelectItem value="seed1" className="text-xs">L1 random, L2 empty (recycling only) — default</SelectItem>
              <SelectItem value="seed2" className="text-xs">L1 empty, L2 random</SelectItem>
              <SelectItem value="single1" className="text-xs">Single centre cell in L1, L2 empty</SelectItem>
              <SelectItem value="single2" className="text-xs">Single centre cell in L2, L1 empty</SelectItem>
              <SelectItem value="empty" className="text-xs">Empty — draw your own</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">{INIT_MODE_HINT[config.initMode]}</p>
        </div>
        {(config.initMode === 'both' || config.initMode === 'seed1') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{config.initMode === 'both' ? 'L1 density' : 'Initial density'}</Label>
              <span className="font-mono text-xs text-amber-300">{config.density1.toFixed(2)}</span>
            </div>
            <Slider
              value={[config.density1]} min={0.02} max={0.95} step={0.01}
              onValueChange={([v]) => onChange({ density1: v })}
              aria-label="Layer 1 initial density"
            />
          </div>
        )}
        {(config.initMode === 'both' || config.initMode === 'seed2') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{config.initMode === 'both' ? 'L2 density' : 'Initial density'}</Label>
              <span className="font-mono text-xs text-teal-300">{config.density2.toFixed(2)}</span>
            </div>
            <Slider
              value={[config.density2]} min={0.02} max={0.95} step={0.01}
              onValueChange={([v]) => onChange({ density2: v })}
              aria-label="Layer 2 initial density"
            />
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Seed</Label>
            <Input
              type="number" className="h-8 text-xs" value={config.seed}
              onChange={(e) => onChange({ seed: +e.target.value || 1 })}
              aria-label="Random seed"
            />
          </div>
          <Button
            variant="outline" size="icon" className="h-8 w-9 shrink-0"
            onClick={() => onChange({ seed: Math.floor(Math.random() * 100000) + 1 })}
            aria-label="Randomise seed"
          >
            <Dices className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Same seed + same config ⇒ bit-identical rollout. Changing the seed or protocol
          re-initialises; changing rules/coupling applies live from the next step.
        </p>
      </section>
    </div>
  )
}
