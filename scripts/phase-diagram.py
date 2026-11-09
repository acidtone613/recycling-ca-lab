#!/usr/bin/env python3
"""Static phase-diagram export (courtesy artifact for download/) —
renders the same aggregates as the app's Results tab:
  panel 1: joint extinction probability vs initial density
  panel 2: median steady-state activity vs initial density (log y)
Series: six recycling configurations (topology x collision) + uncoupled baselines.
2D sweep: Life/Life on 64x64 torus, 100 seeds per configuration.

Usage:
  python3 scripts/phase-diagram.py [experiments.json [out.png]]
Paths default to locations relative to this file's repository root, so the
script runs from any working directory on any machine.
"""

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "public" / "data" / "experiments.json"
OUT_PATH = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "download" / "phase_diagram.png"

with open(DATA_PATH) as f:
    data = json.load(f)

configs = [c for c in data["configs"] if c["dim"] == "2d" and c["rule1"] == "B3/S23" and c["rule2"] == "B3/S23"]
densities = [0.1, 0.3, 0.5, 0.7]

COMBOS = [
    ("same", "drop", "same-coordinate + drop", "#fbbf24", "o", "-"),
    ("same", "overwrite", "same-coordinate + overwrite", "#f59e0b", "v", "--"),
    ("nearest_empty", "drop", "nearest-empty + drop", "#2dd4bf", "s", "-"),
    ("nearest_empty", "overwrite", "nearest-empty + overwrite", "#14b8a6", "^", "--"),
    ("random_empty", "drop", "random-empty + drop", "#f472b6", "D", "-"),
    ("random_empty", "overwrite", "random-empty + overwrite", "#db2777", "P", "--"),
]

fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6), constrained_layout=True)
ax1, ax2 = axes

def series(topo, coll):
    rows = [c for c in configs if c["topology"] == topo and c["collision"] == coll]
    rows.sort(key=lambda c: c["density"])
    return rows

for topo, coll, label, color, marker, ls in COMBOS:
    rows = series(topo, coll)
    if not rows:
        continue
    ax1.plot([r["density"] for r in rows], [100 * r["agg"]["extinctFrac"] for r in rows],
             color=color, marker=marker, ls=ls, lw=1.6, ms=5, label=label)
    ax2.plot([r["density"] for r in rows], [1000 * r["agg"]["medianActivity"] for r in rows],
             color=color, marker=marker, ls=ls, lw=1.6, ms=5, label=label)

base = [c for c in configs if c["direction"] == "none"]
base.sort(key=lambda c: c["density"])
if base:
    ax1.plot([c["density"] for c in base], [100 * c["agg"]["extinctFrac"] for c in base],
             color="#a1a1aa", marker="x", ls=":", lw=1.6, ms=7, label="uncoupled layers")
    ax2.plot([c["density"] for c in base], [1000 * c["agg"]["medianActivity"] for c in base],
             color="#a1a1aa", marker="x", ls=":", lw=1.6, ms=7, label="uncoupled layers")

ax1.set_xlabel("initial density")
ax1.set_ylabel("joint extinction probability (%)")
ax1.set_title("Phase diagram — extinction\n(Life/Life, 64x64 torus, 100 seeds)")
ax1.set_ylim(-3, 103)
ax1.grid(alpha=0.25)

ax2.set_xlabel("initial density")
ax2.set_ylabel("median steady-state activity (x10$^{-3}$/cell)")
ax2.set_title("Sustained activity after recycling\n(mean change per cell, final 100 steps)")
ax2.grid(alpha=0.25)

handles, labels = ax1.get_legend_handles_labels()
fig.legend(handles, labels, loc="lower center", ncol=4, fontsize=8.5, frameon=False,
           bbox_to_anchor=(0.5, -0.06))
fig.suptitle("Recycling CA — does recycling change the dynamics? (coupled vs uncoupled, 2D sweep)", fontsize=12)

out = OUT_PATH
fig.savefig(out, dpi=160)
print("saved", out)
