# Recycling CA Lab

**A playground for two coupled binary cellular automata.** Pick a rule for each layer.
When a cell dies in Layer 1, it can be recycled into Layer 2 as a birth — choose where
the birth lands (same coordinate / nearest empty / random empty / a distance kernel),
and what happens if the target is already occupied (drop or overwrite). Both layers
keep their own rules; only the recycling transfer couples them. **Layer 2 starts empty
by default (`seed1`), so the first few steps show the recycling directly.**

Layer 3 is a read-only map viewport (never a dynamical layer): side-by-side, the
4-state overlay, or a heatmap of the recycled-birth record — with a passive Layer 2
rule that record is a picture of Layer 1's history.

Built to the roadmap: formalize → test the engine → build the GUI → run the experiments →
state the result honestly.

## What's inside

```
src/lib/ca/                 THE ENGINE — single source of truth
  types.ts                    config/summary/step-stat types (the Phase 0 formalization)
  rng.ts                      seeded mulberry32 (all stochasticity derives from it)
  hash.ts                     two-lane FNV-1a state hashing + config fingerprints
  rules.ts                    ECA (Wolfram code) + Life-like (B/S) rules, neighbour tables
  presets.ts                  named rule presets for the GUI (incl. passive record mode)
  engine.ts                   RecyclingCA — step order, transfer operator (with σ distance
                              kernel and rule reliability), cycle detection,
                              extinction/censoring, observables, live config updates
  url.ts                      URL encoding of the full config (shareable links, v-versioned)
  experiments.ts              types + loader for the precomputed batch results

src/components/ca/          THE GUI (a view over the engine)
  workbench.tsx               three-panel layout, transport, play loop, URL sync,
                              one-click scenarios, exports
  controls.tsx                rule selectors, custom B/S editor, Wolfram input, coupling
                              axes (σ, p), init modes with per-layer densities, boundaries
  canvas-views.tsx            pixelated grid/spacetime/overlay canvases + painter + the
                              recycled-record heatmap (viridis, log-scaled)
  stats-panel.tsx             live observables + trajectory charts (population, activity)
  run-log.tsx                 JSON-stamped run history (localStorage) + JSON/PNG export
  results-tab.tsx             phase diagram, outcome mixes, three-way comparison
  model-docs.tsx              the Phase 0 formalization, stated in-app

src/app/                    Next.js 16 App Router shell (page.tsx = the three tabs)

scripts/                    HEADLESS EXPERIMENTS (drive the same engine via Bun)
  test-engine.ts             150-check suite — run BEFORE trusting anything else
  run-experiments.ts         resumable batch sweep (--benchmark / --dim / --shard)
  analyze-results.ts         aggregates → public/data/experiments.json (+ full archive)
  phase-diagram.py            static matplotlib export of the phase diagram
  results/findings.txt       the honest findings text embedded into the results
  results/partial/*.jsonl    raw per-run records (the full 11,200-run sweep)

public/data/experiments.json  precomputed results payload for the Results tab
```

## Quick start

```bash
bun install          # or: npm install
bun run dev          # or: npm run dev  → http://localhost:3000
```

No database, no API routes, no environment variables — the app is fully
client-side (the engine runs in the browser; the Results tab reads a static
JSON payload from `public/data/`).

## Test the engine first

```bash
bun scripts/test-engine.ts
```

150 checks (the runner prints `PASSED 150`): uncoupled baselines vs independent naive references (ECA
W0/30/51/90/110/184/204 and Life/HighLife; toroidal, fixed and replicate boundaries), known patterns
(glider displacement, blinker, block, beacon, torus edge-wrap), conservation accounting for drop and
overwrite — including a dedicated merge-regime check that asserts the Δtotal identity while merges
are actually firing (a merged event writes nothing, so it contributes +0 cells and must NOT appear
in the expected total), determinism, hand-computed transfer units for every topology × collision,
cycle detection, extinction, the bidirectional channel, reinit/updateConfig contract enforcement
(structural overrides, dimensionality rule-family fallback, size/density clamping), conditional
extinction-stamp clearing on manual redraws (per-layer: a still-empty layer keeps its stamp), and
the **L1-invariance theorem** (with unidirectional coupling, Layer 1 is bit-identical to Layer 1 run
alone — asserted for plain configs, σ > 0 kernels, and rule reliability p < 1). A features section
covers the newer engine additions: all six init modes with per-layer densities, the
recycled-record counter (recycled + redirected tallied; merged and reverse-channel not),
σ-kernel clustering vs uniform
statistics, rule-reliability determinism and accounting, the replicate boundary (engine vs a naive
clamped reference), and URL encode/decode round-trips (version guard, junk tolerance). The final
sections cover the analysis observables: the Berlekamp–Massey linear complexity profile
(known sequences cross-checked against a brute-force minimal-recurrence search, plus the W90
centre-column L < n/4 and W30 L > n/3 bounds), coverage / hidden-fraction edge cases and their
conservation identity over a random bidirectional run, and ANF degree growth for 1D rules
(W90 degree 1 with monomials = 2^popcount(t), W30's one-step form l ⊕ c ∨ r = l ⊕ c ⊕ r ⊕ c·r,
the t ≤ 10 cap).

## Rerun the experiments

```bash
bun scripts/run-experiments.ts --benchmark          # timing estimate first
bun scripts/run-experiments.ts --dim=2d --shard=0/2 # resumable; run 2 shards in parallel
bun scripts/run-experiments.ts --dim=1d
bun scripts/analyze-results.ts                      # rebuild public/data/experiments.json
python3 scripts/phase-diagram.py                    # optional static PNG (needs matplotlib)
```

Both `--dim=2d` and `--dim 2d` forms are accepted (same for `--shard k/n` or `--shard=k/n`).
Raw per-run records are written to `scripts/results/partial/*.jsonl` — the completed
11,200-run sweep (2D + 1D, 4 × ~2 MB) is included in this repository, so `analyze-results.ts`
reproduces `public/data/experiments.json` out of the box (it globs every `*.jsonl`
shard, any shard count). The sweep spec lives at the top of `run-experiments.ts`:
rule pairs × topologies {same, nearest_empty, random_empty} × collisions {drop, overwrite} ×
densities {0.1, 0.3, 0.5, 0.7} × 100 seeds, plus uncoupled baselines sharing seeds and initial
states.

## The model in one paragraph

Each layer is a standard binary CA (1D elementary rules by Wolfram code; 2D Life-like
B*/S* over the Moore neighbourhood). When a cell dies in Layer 1 (1 → 0), that death is
recycled into Layer 2 as a birth: the **topology** selects the target (same coordinate /
nearest empty / uniformly random empty / a Gaussian distance kernel with scale σ) and the
**collision policy** resolves unavailable targets (drop = lossy; overwrite = guaranteed
delivery via redirect, conserving aliveness). Six init modes seed the layers (the default
`seed1` leaves Layer 2 empty so the transfer is visible from step 1), with per-layer
densities; boundaries are toroidal, fixed, or replicate; and rule reliability p < 1 adds
per-cell noise, turning the run into a (reproducible, RNG-tagged) Markov chain.
Step order: L1 rule step → L2 rule step → death masks → forward transfer → (optional
reverse transfer) → commit. The 4-state pair (s1, s2) is an analytical overlay only.
One formalization note: in *binary* layers, literally forcing a 1 onto an already-1 cell
is a state no-op, so "same-coordinate, always" ≡ "same, if empty"; overwrite is therefore
implemented as guaranteed delivery (redirect), which is what makes it behaviourally
distinct. Full details: the **Model** tab in the app.

## Workbench niceties

- The full config is mirrored into the URL on every change — **Copy link** shares the
  exact state (grid, rules, coupling, σ, p, init mode, densities, seed); a `v` parameter
  versions the format, and a link from a newer version falls back to defaults with a
  toast instead of breaking.
- One-click **Scenarios**: record mode, asymmetric rules (Life + HighLife),
  W110 → W90 in 1D, and a single replicator seed.
- The map panel's **Recycled record** view is a viridis heatmap of the per-cell
  recycled-birth counter; PNG snapshots carry a provenance footer
  (config fingerprint · seed · step), and there is a grid-lines toggle for small grids.
- **Analysis cards** in the stats panel (pure functions in `src/lib/ca/analysis.ts` — they
  never feed back into the run):
  - *Linear complexity (Berlekamp–Massey).* Open the trace, run the CA, click **Analyze**:
    the plot shows L(n) of Layer 1's centre column. Flat = short linear recurrence
    (`single1 + W90 + fixed` stays flat); slope ≈ ½ = chaotic (`single1 + W30 + fixed`
    climbs at ½). Recording only happens while the card is open (≤ 2,048 steps / ~8 MB).
  - *Coverage & hidden fraction.* Live readouts of |L1 ∩ L2| relative to the sparser layer
    (coverage) and to the union (hidden fraction — the share of the overlay's "both" state),
    plus a small trajectory chart.
  - *ANF degree growth* (1D only, collapsed by default). The centre cell's algebraic normal
    form in its 2t+1-cell light cone, t = 0..10: W90 stays degree 1; W30's degree climbs.
    The t = 10 level (2²¹ truth-table evaluations) computes in a few seconds.

## Findings (the honest version)

- Extinction is 0% everywhere in the 2D regime (coupled *and* uncoupled): on a 64×64
  torus, Life-like rules leave still-life/oscillator mosaics, so the all-0 absorbing state
  is practically unreachable. For the extinction observable, the rule dominates the coupling.
- Recycling decisively changes *settling*: uncoupled layers cycle-detect in 39–69% of runs,
  every coupled configuration suppresses cycles to ~0% and stays active at 3–12× the
  baseline activity with 2–4× the standing density.
- Non-local recycling maximises the shift (random-empty > same-coordinate), exactly as
  the roadmap predicted; overwrite > drop within the same topology.
- Where extinction is the attractor (nilpotent W90), recycling stretches median survival
  from 64 to 126 steps in the same topology order.
- Cleanest attractor-class change: W90 alone dies in 100% of runs; coupled to a W110
  source it never dies, held at ~0.60 live density (union ≈0.86).

## Reproducibility

Same seed + same config ⇒ bit-identical rollout (asserted by test). Every run log entry
carries the config fingerprint and seed. Cycle detection for stochastic configurations
(random-empty topology, overwrite collision, a σ > 0 distance kernel, or rule reliability
p < 1) hashes the RNG state together with the CA
state, so any reported cycle is genuine — such processes are Markov chains, and "active
at cap" for them means sustained non-equilibrium activity. The rule-noise stream is
derived separately from the transfer stream, which is what keeps L1-invariance true for
p < 1.

## Environment notes

- Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui; TypeScript throughout
  (strict mode; `next build` fails on type errors).
- The engine and scripts run on plain Bun (or tsx/node with the TS loader of your choice).
- `npm run start` serves the standalone production build with plain `node` — Bun is only
  needed for the test/experiment scripts (swap in `tsx` if you prefer Node there). The
  `build` script's `cp` step is Unix-flavoured; on Windows run it under WSL or copy
  `.next/static` and `public` into `.next/standalone/` manually.
- `bun.lock` is included for Bun users; npm users can ignore it (a `package-lock.json`
  will be created on first `npm install`).
- Only the dependencies actually imported by the app are declared in `package.json`.

## Results

- `results/experiment_results.json` — the full archive (aggregates + per-run records of the
  11,200-run sweep); `results/README.md` is its manifest.
- `results/phase_diagram.png` — static phase-diagram export (regenerate with `python scripts/phase-diagram.py`).

## License

MIT — see `LICENSE`.

