'use client'

// The Phase 0 formalization, stated in-app so the experiment is unambiguous.

import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion'

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-zinc-300 last:mb-0">{children}</p>
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[12px] text-amber-200">{children}</code>
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[12px] text-teal-300">{children}</code>
}

export function ModelDocs() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">The model, written down</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Phase 0 of the roadmap: fix the alphabet, the coupling, the collision semantics and
          the observables <em>before</em> interpreting any result. Everything below is exactly
          what the engine implements — the same tested module drives this GUI and the batch
          experiments on the Results tab.
        </p>
      </div>

      <Accordion type="multiple" defaultValue={['model', 'coupling']} className="space-y-2">
        <AccordionItem value="model" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">1 · Layers, alphabet, and what Layer 3 is</AccordionTrigger>
          <AccordionContent>
            <P>
              There are exactly <strong>two dynamical layers</strong>. Each is a standard binary
              CA: a grid of cells, each 0 or 1, updated synchronously by a local rule that reads
              the cell and its neighbours. No 4-state alphabet is implemented — the pair
              <Mono> (s1, s2)</Mono> is an <em>analytical overlay</em> (visible in the map panel's
              overlay view), not a rule table.
            </P>
            <P>
              <strong>Layer 3 is a viewport, not a dynamical layer.</strong> It has no rule and no
              state of its own; it renders Layer 1 and Layer 2 side by side (with a visible
              separator), as the 4-state overlay, or as the recycled-record heatmap. Keeping the
              dynamics entirely in Layers 1–2 is what keeps the map interpretable.
            </P>
            <P>
              <strong>Initial states and the <Code>seed1</Code> default.</strong> Six init modes
              cover the seeding choices: <Mono>both</Mono> (both layers random at their own
              densities), <Mono>seed1</Mono> (L1 random, L2 empty — the default), <Mono>seed2</Mono>,
              <Mono>single1</Mono>/<Mono>single2</Mono> (one centre cell in the respective layer),
              and <Mono>empty</Mono> (draw your own). <strong><Mono>seed1</Mono> vs <Mono>both</Mono>:</strong>
              in <Mono>seed1</Mono> mode, Layer 2 starts empty and only receives cells via
              recycling — the first few steps show the transfer directly. In <Mono>both</Mono> mode,
              Layer 2 has its own rule-driven dynamics from step 0 and the recycling is layered on
              top. Combined with a passive Layer 2 rule (<Code>B/S012345678</Code>), <Mono>seed1</Mono>
              gives you a pure record of which cells died in Layer 1 and when.
            </P>
            <P>
              <strong>Boundaries.</strong> Three grid edges: <Mono>toroidal</Mono> (wrap-around),
              <Mono>fixed</Mono> (outside is dead), and <Mono>replicate</Mono> — an out-of-bounds
              neighbour is replaced by the nearest edge cell (its coordinates are clamped into
              the grid), so the edge behaves like a mirror without a halo.
            </P>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="rules" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">2 · Rule families (standard only)</AccordionTrigger>
          <AccordionContent>
            <P>
              <strong>1D — elementary CA.</strong> A Wolfram code 0–255: an 8-bit lookup table over
              the three-cell neighbourhood (left, centre, right), indexed by <Mono>4·l + 2·c + r</Mono>.
              The 256 codes reduce to 88 inequivalent rules under reflection and complement.
            </P>
            <P>
              <strong>2D — Life-like CA.</strong> Notation <Code>B*/S*</Code>: B lists the
              live-neighbour counts (Moore neighbourhood, 8 neighbours) that cause a birth
              (dead → alive); S lists the counts that allow survival (alive → alive). Conway&apos;s
              Life is <Code>B3/S23</Code>; HighLife is <Code>B36/S23</Code>. This family is the
              natural 2D analogue of the 3-cell 1D neighbourhood.
            </P>
            <P>
              A rule is <em>quiescent</em> when the all-0 grid is a fixed point (no B0; even
              Wolfram code). Only quiescent rules make extinction absorbing — the UI warns when
              you pick a non-quiescent rule.
            </P>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="coupling" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">3 · The recycling transfer (the only non-standard part)</AccordionTrigger>
          <AccordionContent>
            <P>
              When a cell <em>dies</em> in Layer 1 (1 → 0), that death is <em>recycled</em> into
              Layer 2 as a birth. The coupling is a <strong>transfer operator</strong> that reads
              a death event and writes a birth event — the layers stay binary. Two independent
              choices define it:
            </P>
            <div className="mb-3 overflow-x-auto rounded-md border border-zinc-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Axis</th>
                    <th className="px-3 py-2 font-medium">Option</th>
                    <th className="px-3 py-2 font-medium">Meaning</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300">
                  <tr>
                    <td className="px-3 py-2 align-top" rowSpan={3}>
                      <strong>Topology</strong><br />
                      <span className="text-zinc-500">target selection</span>
                    </td>
                    <td className="px-3 py-2 font-mono">same</td>
                    <td className="px-3 py-2">Birth tries the death cell&apos;s own coordinate in Layer 2.</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-mono">nearest_empty</td>
                    <td className="px-3 py-2">Origin first, then the Moore ring clockwise from North (1D: origin, left, right).</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-mono">random_empty</td>
                    <td className="px-3 py-2">A uniformly random empty cell anywhere in Layer 2 (non-local).</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 align-top" rowSpan={2}>
                      <strong>Collision</strong><br />
                      <span className="text-zinc-500">when the preferred target is occupied / unavailable</span>
                    </td>
                    <td className="px-3 py-2 font-mono">drop</td>
                    <td className="px-3 py-2">The event is lost (lossy). Aliveness leaks; extinction is reachable.</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-mono">overwrite</td>
                    <td className="px-3 py-2">
                      Guaranteed delivery: redirect to a uniformly random empty cell; if Layer 2 is
                      entirely full, merge at the origin. Every death yields exactly one birth
                      while Layer 2 has any empty cell — the transfer never destroys aliveness.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <P>
              <strong>A formalization note worth stating honestly.</strong> In <em>binary</em>
              layers, the roadmap&apos;s &quot;same-coordinate, always — force (i,j) to 1, even if
              already 1&quot; is mathematically identical to &quot;same-coordinate, if empty&quot;:
              writing 1 onto a cell that is already 1 is a state no-op. The redirect semantics
              above is what makes <Code>overwrite</Code> behaviourally distinct and honours
              &quot;overwrite conserves aliveness&quot;. With <Code>drop</Code>, the same-coordinate
              option reproduces the roadmap&apos;s &quot;same, if empty&quot; exactly.
            </P>
            <P>
              Coupling direction is a separate axis: off (baseline), unidirectional
              (L1 → L2, the default experiment), or bidirectional (a second, reverse channel
              that recycles Layer 2 rule-deaths into Layer 1).
            </P>
            <P>
              <strong>Distance kernel (σ).</strong> For the <Mono>nearest_empty</Mono> and
              <Mono>random_empty</Mono> topologies, σ = 0 keeps the topology’s default rule —
              nearest_empty scans origin-then-ring, random_empty picks uniformly. With σ &gt; 0
              the candidate empty cells are instead weighted by <Mono>exp(−d²/2σ²)</Mono>, d =
              Euclidean distance from the death site, and the target is sampled from that
              distribution: small σ keeps recycled births near the death site (approaching
              nearest-empty), large σ approaches uniform (random-empty) — a continuous
              interpolation between the two topologies. <Code>same</Code> has no distance to
              speak of, so σ does not apply there.
            </P>
            <P>
              <strong>Rule reliability (p).</strong> With probability 1 − p, each cell ignores its
              rule output and keeps its current state — a per-cell failure rate on the rule table.
              p = 1 is the deterministic CA; p &lt; 1 turns the process into a Markov chain whose
              cycle detection stays genuine (state hashes are RNG-tagged).
            </P>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="order" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">4 · Step order (the documented contract)</AccordionTrigger>
          <AccordionContent>
            <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-zinc-300">
              <li><Mono>L1&apos; = rule1(L1)</Mono> — Layer 1 rule step.</li>
              <li><Mono>L2&apos; = rule2(L2)</Mono> — Layer 2 rule step.</li>
              <li><Mono>D1 = {'{i : L1=1 ∧ L1&apos;=0}'}</Mono> — Layer 1 death mask.</li>
              <li><Mono>L2&apos;&apos; = L2&apos; + transfer(D1)</Mono> — recycled births written into Layer 2&apos;s fresh state.</li>
              <li>Bidirectional only: <Mono>D2 = {'{i : L2=1 ∧ L2&apos;=0}'}</Mono> (Layer 2 <em>rule</em> deaths — transfer births never kill) and <Mono>L1&apos;&apos; = L1&apos; + transfer(D2)</Mono>.</li>
              <li>Commit; statistics and cycle detection run on the joint state.</li>
            </ol>
            <P>
              Events are processed in increasing linear index order, then via the seeded PRNG for
              random choices — the order is part of the contract, so every rollout is reproducible.
            </P>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="observables" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">5 · Observables &amp; outcome classification</AccordionTrigger>
          <AccordionContent>
            <P>
              Per step: live counts per layer, union count, <strong>mean change per cell</strong>
              (fraction of the 2N cells that flipped), joint 4-state Shannon entropy, and the
              transfer event counters (recycled / dropped / redirected / merged).
            </P>
            <P>
              Per run, the trajectory is classified as: <strong>extinct</strong> (both layers
              all-0 — absorbing for quiescent rules), <strong>limit cycle</strong> (a joint state
              repeated; period reported), or <strong>active at cap</strong> (censored at the step
              limit). From the batch sweep we report extinction probability, survival time,
              cycle-length distributions and steady-state activity.
            </P>
            <P>
              <strong>The recycled-record view.</strong> The engine tallies, per cell, every
              delivered recycled birth (the recycled and redirected paths of the forward
              channel). The map panel’s <em>Recycled record</em> mode renders this counter as a
              log-scaled viridis heatmap — in <Mono>seed1</Mono> mode with a passive Layer 2 rule
              it is a picture of Layer 1’s history: every cell that has ever died there, weighted
              by how many times. Hot spots align with Layer 1’s recently-died regions.
            </P>
            <P>
              <strong>Cycle detection with stochastic recycling.</strong> With
              <Code> random_empty</Code>, <Code>overwrite</Code>, a distance kernel (σ &gt; 0) or
              rule reliability p &lt; 1, the process consumes runtime
              randomness — it is a Markov chain, not a deterministic CA, and a repeated
              <em> state</em> does not imply a repeated <em>trajectory</em>. The engine therefore
              hashes the state <em>together with</em> the RNG state: any cycle it reports is
              genuine. In practice stochastic runs almost never repeat — for those, extinction
              probability and sustained activity are the meaningful observables, not cycle length.
            </P>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="theory" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">6 · Two structural theorems (asserted in the test suite)</AccordionTrigger>
          <AccordionContent>
            <P>
              <strong>L1-invariance.</strong> With unidirectional coupling, Layer 1&apos;s
              trajectory is <em>bit-identical</em> to Layer 1 run alone with the same seed — the
              coupling cannot feed back into its source. Consequently the meaningful coupling
              contrast is <strong>Layer 2 coupled vs. Layer 2 alone</strong>, plus joint
              observables (joint extinction, union activity). The test suite asserts this for
              every topology × collision combination.
            </P>
            <P>
              <strong>Conservation.</strong> With <Code>overwrite</Code>, every Layer 1 death
              yields exactly one birth while Layer 2 has any empty cell; the transfer never
              removes aliveness. The total live count changes only through the rules&apos;
              births/deaths plus delivered recycled births — asserted at every step.
            </P>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="repro" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">7 · Reproducibility</AccordionTrigger>
          <AccordionContent>
            <P>
              Every stochastic choice draws from seeded <Mono>mulberry32</Mono> streams derived
              from the seed: one for the initial state and the transfer (random targets,
              redirects), and a dedicated one for rule noise (p &lt; 1) — insulating the noise
              stream from transfer consumption is what keeps L1-invariance true for p &lt; 1.
              Same seed + same config ⇒ bit-identical
              rollout — covered by a determinism test. Each run log entry carries the config
              fingerprint (a stable hash of the full config — every field participates, sorted by
              name) alongside the seed, so any stamp can be replayed exactly; PNG snapshots carry
              the same fingerprint in their footer, and the workbench URL encodes the full config
              so any state is shareable as a link.
            </P>
            <P>
              The batch experiments on the Results tab run the <em>same</em> TypeScript engine
              module headlessly (Bun) — one source of truth; the GUI is only a view.
            </P>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="analysis" className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4">
          <AccordionTrigger className="text-sm font-medium text-zinc-100">8 · Analysis observables (the stats panel&rsquo;s analysis cards)</AccordionTrigger>
          <AccordionContent>
            <P>
              Three read-only instruments live at the bottom of the stats panel. They are pure
              functions over engine output — <Mono>src/lib/ca/analysis.ts</Mono> — and never
              feed back into the run.
            </P>
            <P>
              <strong>Linear complexity (Berlekamp&ndash;Massey).</strong> The engine keeps no
              per-step states, so the card records its own Layer-1 trace — but only while you
              have it open (<em>Open trace</em>), capped at 2,048 steps and ~8&nbsp;MB.{' '}
              <em>Analyze</em> extracts the centre column (1D: the centre cell; 2D: the grid-centre
              cell) and runs the incremental Berlekamp&ndash;Massey algorithm over GF(2), plotting{' '}
              <Mono>L(n)</Mono> — the length of the shortest binary linear recurrence generating the
              first <Mono>n</Mono> terms. A <em>flat</em> profile means the sequence obeys a short
              recurrence (a linear rule such as W90, or a low-period limit cycle); a profile with{' '}
              <em>slope &asymp; &frac12;</em> is the signature of a random-looking, chaotic source
              (W30&rsquo;s centre column tracks it). The classic one-screen demo: run{' '}
              <Mono>single1 + W90 + fixed</Mono> and the plot stays flat; switch to{' '}
              <Mono>W30</Mono> and it climbs at &frac12;.
            </P>
            <P>
              <strong>Coverage &amp; hidden fraction.</strong> The engine reports, each step, how
              many cells are live in <em>both</em> layers at once (the coexistence count feeding the
              entropy&rsquo;s &ldquo;both&rdquo; state). <strong>Coverage</strong> is that count
              relative to the sparser layer — <Mono>|L1 &cap; L2| / min(|L1|, |L2|)</Mono> — the
              fraction of the smaller layer&rsquo;s activity that sits on live ground of the other.
              <strong>Hidden fraction</strong> is the count relative to the union —{' '}
              <Mono>|L1 &cap; L2| / |L1 &cup; L2|</Mono> — the share of visible activity that the
              4-state overlay renders as &ldquo;both&rdquo;, hiding its per-layer identity. On a{' '}
              <Mono>seed1</Mono> + passive-L2 record run, coverage near 1 means the current Layer-1
              activity sits almost entirely on &ldquo;used&rdquo; (once-died) ground.
            </P>
            <P>
              <strong>ANF degree growth (1D only).</strong> For a Wolfram rule, the centre cell
              after <Mono>t</Mono> steps is a Boolean polynomial in the{' '}
              <Mono>2t+1</Mono> initial cells inside its light cone (enumerating all initial states
              gives the truth table; a M&ouml;bius transform over GF(2) yields the algebraic normal
              form). The card reports the polynomial&rsquo;s maximum monomial degree and monomial
              count for <Mono>t = 0..10</Mono>: a <em>linear</em> rule (W90) stays at degree 1
              forever, while W30&rsquo;s degree climbs steadily — a second, structural lens on the
              linear-vs-chaotic distinction the complexity profile measures empirically.
            </P>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
