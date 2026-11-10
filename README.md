# Recycling CA Lab

**An interactive playground for multi-layer cellular automata.** Open it in a browser,
draw some cells, hit play, and watch what happens when the death of one world feeds
the birth of another.

## The idea

Two layers of binary cellular automata run side by side, each with its own rule.
The twist is a **recycling channel**: when a cell dies in Layer 1, it can be reborn
in Layer 2. You control *where* the birth lands:

- **same** — the same coordinate in Layer 2 (if it's empty)
- **nearest empty** — the closest free cell to the death site
- **random empty** — a uniformly random free cell
- **σ kernel** — a Gaussian distance kernel; closer sites are more likely

and what happens when the target is already taken: **drop** it (lossy) or
**overwrite** it (guaranteed delivery via redirect).

Because both layers keep their own rules — elementary rules (Wolfram codes) in 1D,
Life-like B/S rules in 2D — you can pair any two worlds. Recycling a Game-of-Life
death into Rule 110, or feeding a chaotic Rule 30 into a quiet layer, is one click.
Layer 2 starts empty by default, so the recycling itself is visible from step one.

A third, **read-only map viewport** shows the two layers side by side, as a 4-state
overlay, or as a heatmap of the recycled-birth record — a picture of where Layer 1's
deaths have landed over time.

## Set it up

**Windows, one click:** double-click `start.bat`. It installs dependencies on first
run, starts the dev server, and opens http://localhost:3000 in your browser.
Closing the window stops the server.

From a terminal it's the same two lines:

```bash
npm install
npm run dev
```

Open http://localhost:3000. That's it — no database, no API keys, no environment
variables. The app is fully client-side: the engine runs in your browser.

(Bun users: `bun install && bun run dev` works identically.)

## How to use it

The **Workbench** tab is the main view — a three-panel layout:

- **Left panel — controls.** Pick a rule per layer (presets, Wolfram codes, or a
  custom B/S editor), set the recycling topology and collision policy, tune the
  σ/p coupling knobs, choose init modes with per-layer densities, and pick the
  boundary (toroidal, fixed, or replicate). Grid size and seed are here too.
- **Centre — canvases.** Pixelated grid, spacetime strip, overlay, and the
  recycled-record heatmap, with a transport bar (step / play / speed).
- **Right panel — stats.** Live observables (population, activity, recycled
  births) plus trajectory charts and analysis cards.

Things worth trying first:

- The one-click **Scenarios** in the header: record mode (a passive Layer 2 rule
  makes the heatmap a literal photograph of Layer 1's history), asymmetric pairs
  like Life + HighLife, and W110 → W90.
- **Copy link** — the entire configuration is mirrored into the URL, so any
  experiment you set up is shareable as a plain link.
- The **analysis cards** in the stats panel (pure read-outs, never affect the run):
  linear complexity via Berlekamp–Massey, coverage/hidden-fraction between the
  layers, and algebraic normal form degree growth for 1D rules.
- **Export** any run as JSON or PNG from the run log (PNG snapshots carry a
  provenance footer: config fingerprint · seed · step).

The other two tabs: **Results** shows a precomputed 11,200-run sweep with phase
diagrams and outcome mixes (click any configuration to open it in the Workbench),
and **Model** holds the formal definition of the engine — the step order, the
transfer operator, and the exact semantics of every knob.

## What's inside

```
src/lib/ca/        the engine — single source of truth, no React
  engine.ts          RecyclingCA: step order, transfer operator, cycle detection,
                     observables, live config updates
  rules.ts           ECA (Wolfram) + Life-like (B/S) rule families
  analysis.ts        Berlekamp–Massey, coverage, ANF (pure functions)
  url.ts             URL encoding of the full config, versioned
  presets.ts         named rule presets for the GUI

src/components/ca/ the GUI (a view over the engine)
src/app/           Next.js App Router shell — three tabs: Workbench, Results, Model
scripts/           headless experiments + engine test suite (drive the same engine)
```

Same seed + same configuration always produces a bit-identical rollout — the run
log stamps every entry with a config fingerprint and seed, so anything you find
can be reproduced and shared exactly.

## Engine checks

The engine has its own test suite (150 checks: conservation identities, known
patterns like gliders and blinkers, boundary handling, determinism, the
L1-invariance theorem, URL round-trips):

```bash
bun scripts/test-engine.ts    # or: npm exec tsx -- scripts/test-engine.ts
```

The batch sweep behind the Results tab can be rerun headlessly — see
`scripts/run-experiments.ts` and the README in `results/`.

## Stack

Next.js 16 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui, TypeScript
strict throughout. The engine and scripts are plain TypeScript that also runs
under Node via `tsx`. Both `bun.lock` and `package-lock.json` are committed.

## License

MIT — see `LICENSE`.
