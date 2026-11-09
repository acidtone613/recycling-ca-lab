# Results

Precomputed outputs from the full sweep (see README, "Rerun the experiments"):

- `experiment_results.json` — the full results archive: aggregates plus the
  per-run records of the 11,200-run sweep (2D + 1D).
- `phase_diagram.png` — a static matplotlib export of the phase diagram
  (regenerated with `python scripts/phase-diagram.py` if you want a fresh one).

The lean payload the Results tab actually loads lives in
`public/data/experiments.json`, built by `scripts/analyze-results.ts` from the
raw `.jsonl` shards in `scripts/results/partial/`.
