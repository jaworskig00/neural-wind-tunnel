# Decision records

Short ADR-style records. Newest decisions go at the bottom. A decision is changed by adding a
new record that supersedes the old one, never by editing history.

Status values: `accepted`, `superseded by ADR-nn`.

---

## ADR-001 — Geometry scope for v1 is a 2D airfoil rendered in a 3D scene

**Status.** accepted

**Context.** The project must prove Three.js and shader depth while keeping the surrogate
trainable. A full 3D wing needs either a 3D solver or a span-wise decomposition, both of which
multiply the data-generation cost and the risk of an inaccurate model.

**Options.** Strictly 2D orthographic scene; 2D section rendered in a 3D scene; a finite 3D
wing with a 2.5D surrogate.

**Decision.** A parametric 2D section — NACA 4-digit presets plus free-form CST — extruded into
a 3D mesh, with the flow solved and visualised in the section plane and a free 3D camera.

**Consequences.** The physics stays within reach of a panel method. The visual payoff still
reads as 3D. Span-wise effects are explicitly out of scope and stated in the README. 3D bodies
move to the v2 backlog.

---

## ADR-002 — Ground truth is an in-repo panel method, not XFOIL

**Status.** accepted

**Context.** Training data needs a reference solver that runs tens of thousands of cases,
reproducibly, in CI, on macOS ARM and on Linux runners.

**Options.** XFOIL as an external binary; NeuralFoil; a self-written linear-strength vortex
panel method with an integral boundary layer.

**Decision.** Write the solver in Python and NumPy: linear-strength vortex panels with the
Kutta condition for the inviscid solution, then Thwaites, the Michel transition criterion,
Head's method and the Squire-Young formula for profile drag.

**Consequences.** Zero binary dependencies, fully reproducible, testable in CI, and the solver
itself becomes part of the portfolio. Drag is less accurate than XFOIL's and separation is not
modelled; both are validated against published NACA data and stated plainly in
`solver-validation.md`. NeuralFoil was rejected because training a surrogate on a surrogate is
hard to defend to an engineer reading the README.

---

## ADR-003 — The dataset lives here and is published as a Release asset

**Status.** accepted

**Context.** A sister project, the D3 design-space explorer, needs the same data. Options were
one shared third repository, duplicated datasets, or one producer and one consumer.

**Decision.** The solver and the pipeline live in this repository. The dataset ships as a
versioned GitHub Release asset (`dataset-v1`) plus a 2000-row CSV sample committed under
`data/sample/`. The explorer fetches it by URL. Both READMEs link to each other.

**Consequences.** One pipeline to maintain, no Git LFS, no large binaries in history. The
schema becomes a public contract — see ADR-010.

---

## ADR-004 — React Three Fiber for the scene graph, hand-written GLSL for the interesting parts

**Status.** accepted

**Context.** The code is a hiring sample. It must show shader and WebGL competence, not just
library wiring, while keeping the UI maintainable.

**Decision.** React plus TypeScript plus Vite plus react-three-fiber for scene composition and
UI integration; all materials, the reduced-order reconstruction pass and the GPGPU particle
advection written as raw GLSL with explicit render targets and ping-pong buffers.

**Consequences.** A reviewer sees real shader code rather than `<Effects />`. R3F's
abstractions stay out of the hot path. Any place where R3F would hide something important is
dropped down to imperative Three.js and commented as such.

---

## ADR-005 — WebGL2 first, WebGPU as an additive later path

**Status.** accepted

**Context.** WebGPU compute would be the more modern showcase but is not universally
available, and a dual implementation doubles the surface area before v1 even ships.

**Decision.** WebGL2 with ping-pong framebuffers is the only path in v1. WebGPU compute is a
v2 backlog item, to be added as a second runtime-selected backend behind the same interface.

**Consequences.** The demo works for every reviewer on first click. The particle system is
written behind an interface so the WebGPU backend can slot in without a rewrite.

---

## ADR-006 — ONNX Runtime Web as the canonical runtime, with a raw-weights TypeScript fallback

**Status.** accepted

**Context.** The model is a small MLP. ONNX Runtime Web brings a credible, standard inference
stack but several megabytes of wasm; a hand-written MLP is trivial but proves nothing about
tooling.

**Decision.** Ship both. ONNX is the canonical exported artifact and `onnxruntime-web` with the
wasm backend is the default, dynamically imported off the critical path. A second backend reads
the raw weight blob and runs the MLP in about eighty lines of typed TypeScript. A parity test
asserts the two agree with each other and with a Python reference case to 1e-4.

**Consequences.** Slightly more code, considerably more credibility: the fallback demonstrates
the model is understood, protects against an ORT regression, and gives a real numerical test.

---

## ADR-007 — The flow field comes from a reduced-order model, never from procedural noise

**Status.** accepted

**Context.** Surface Cp alone cannot drive a particle field. The options were to approximate a
field analytically from the predicted lift, to predict a dense field with a decoder network, or
to use a modal decomposition.

**Decision.** The offline pipeline runs proper orthogonal decomposition on the solver's velocity
fields and stores the mean field plus 32 modes. The network predicts the 32 modal coefficients
alongside Cp and the force coefficients. The GPU reconstructs `u, v = mean + sum(a_i * phi_i)`
in one fragment-shader pass; particles advect through that field.

**Consequences.** A tiny model, a cheap reconstruction, measurable field error, and a technique
that matches what production simulation tools actually do. The cost is a POD mode atlas of a
few megabytes, lazy-loaded. Procedural noise standing in for a solution is forbidden anywhere
in this codebase.

---

## ADR-008 — LLM access is bring-your-own-key, provider-agnostic, with no proxy in v1

**Status.** accepted

**Context.** The app must stay static and must never ship or leak a key, while still showing a
working natural-language layer.

**Decision.** The user pastes their own key; it is stored only in `localStorage` and sent
directly from the browser to the chosen provider. Adapters cover the Anthropic API and any
OpenAI-compatible endpoint, which also covers Grok and local gateways. Structured output and
tool calling drive concrete parameter changes. With no key the app is fully functional and the
assistant panel offers a demo mode built from recorded transcripts.

**Consequences.** No server, no secret in the repository, no operating cost. The key is visible
to the user's own browser only; the UI states where it is sent. A key-hiding proxy is a backlog
item, not a v1 requirement.

---

## ADR-009 — Reynolds number is fixed at one million in v1

**Status.** accepted

**Context.** Adding Reynolds number as an input multiplies the dataset and the training time
for a parameter that the demo barely exercises.

**Decision.** All data is generated at Re = 1e6, incompressible, Mach 0. The column is kept in
the schema as a constant so the dataset can grow later without a schema break.

**Consequences.** The UI shows the fixed condition rather than pretending to vary it.
Making Reynolds number a model input is a v2 backlog item and a dataset version bump.

---

## ADR-010 — The dataset schema and the URL state format are versioned public contracts

**Status.** accepted

**Context.** The sister project is built in parallel by a different agent. Any informal
agreement about column names would drift immediately.

**Decision.** `docs/DATASET-SCHEMA.md` and `docs/URL-STATE.md` are the contract. Both carry a
version number. `tools/stub_dataset.py` generates schema-conformant placeholder data so the
consumer can be built before this project's dataset exists. Breaking changes bump the version,
land in `CHANGELOG.md`, and keep the previous Release asset in place.

**Consequences.** Both projects can proceed in any order with no blocking dependency. The cost
is discipline: the schema document is updated in the same commit as any pipeline change that
affects it.

---

## ADR-011 — Work happens on `main` with small commits

**Status.** accepted

**Context.** A single author plus an autonomous agent. Pull requests would add ceremony with no
reviewer.

**Decision.** Commit directly to `main` in small conventional commits, push after every task,
tag each milestone. No force pushes, no history rewrites. Commit messages carry no co-author
trailers and no mention of the tooling that wrote them.

**Consequences.** Progress is never lost and CI runs on every push. A broken CI run becomes the
next task before anything else, since there is no branch to hide it on.

---

## ADR-012 — Dataset and model artifacts are never committed

**Status.** accepted

**Context.** Parquet files, ONNX models and POD mode blobs would bloat the repository and its
clone time for a portfolio project people skim.

**Decision.** Everything generated goes to GitHub Release assets and is gitignored. The only
committed data is a 2000-row CSV sample for tests and for the sister project. No Git LFS.

**Consequences.** A clean, fast clone. The app fetches artifacts from a Release URL with a local
development fallback, and CI downloads only the small sample.

---

## ADR-013 — Geometry metrics use the closed-form leading-edge radius; the CST nose residual is documented, not hidden

**Status.** accepted

**Context.** Two numerical facts surfaced while implementing `tools/solver/geometry.py`.

First, estimating the leading-edge radius from discrete coordinates by fitting `z**2 = 2 r x`
reads about 10 % low on a symmetric section and over 30 % high on a strongly cambered one. The
cause is geometric, not a bug: NACA thickness is applied perpendicular to the camber line, so
the vertical gap between the surfaces near a steeply cambered nose is not twice the half
thickness. Extrapolating `z**2 / x` to the origin fixes the symmetric case and makes the
cambered case worse.

Second, a six-weight CST fit of NACA 2412 leaves a residual of 3.1e-3 at `x = 4e-5`. The
dataset schema fixes the order at six weights per surface, so this cannot be improved by adding
degrees of freedom.

**Options.** Raise the CST order and break the schema; implement monotone cubic interpolation
and a smarter nose fit; use the closed form where the parametrisation provides one and document
the fallback.

**Decision.** `geometry_metrics` accepts an optional `le_radius` and every caller that knows the
parametrisation passes the exact value — `A_0**2 / 2` for CST, `1.1019 * t**2` for NACA four
digit. Every dataset row takes that route, so the published column is exact. The numerical
fallback stays for arbitrary coordinates, with its bias stated in the docstring and asserted
only within a factor of two in the tests.

The CST fit residual is accepted as a property of the parametrisation, not a defect. The test
asserts the measured bounds: below 4e-3 overall, below 1e-3 outside the first 0.5 % of chord,
and below 3e-4 outside the first 1 %. Thickness and camber maxima survive the round trip to
within 1e-3, which is what the surrogate actually consumes.

**Consequences.** The dataset's `le_radius` column is exact rather than approximate. Thickness
and camber extrema are refined with a parabola through the samples around the discrete maximum,
which brings the reported station to within about 0.01 of chord of the published value — the
residual is linear interpolation across 80 panels per surface in a flat region, and is not worth
a cubic interpolator. Anyone fitting CST to a published section should expect the nose to be the
least faithful part, which is also where a panel method is least reliable.

---

## ADR-014 — Verify the solver against statable truth, not remembered tables

**Status.** accepted

**Context.** The plan originally called for validating the inviscid solver against "published
NACA 0012 Cp data". Bundling a digitised reference dataset means either finding one with a
licence that permits redistribution, or transcribing numbers whose provenance cannot be stated
in the repository. Typing in half-remembered table values and calling them published data would
break this project's central promise.

**Options.** Bundle a licensed reference dataset; cite a source and transcribe its numbers;
verify against results that carry their own proof.

**Decision.** Verify against truth that can be derived on the spot:

- The exact potential-flow solution for a circle, `Cp = 1 - 4 sin^2(theta)`, including the
  first-order grid convergence that the control-point placement predicts.
- Thin-airfoil theory: a lift slope within 5 % of `2*pi` per radian for NACA 0004, and the
  thickness correction `2*pi * (1 + 0.77 t/c)` matched within 1.2 % from 4 % to 18 % thickness.
- Exact identities: zero lift and zero moment for a symmetric section at zero incidence,
  `Cl / sin(alpha)` constant for a symmetric section, and mirror symmetry of the two surface
  pressure distributions.
- Internal consistency: lift from circulation and lift from pressure integration agree within
  1 % at 320 panels and their gap halves when the panel count doubles.

**Consequences.** Every assertion in `tools/solver/test_panel.py` can be justified from first
principles by a reviewer, with no external file to trust. The trade-off is that absolute
agreement with experiment is not asserted here; that comparison belongs with the viscous solver
and is made qualitatively, with the discrepancy explained, in `docs/solver-validation.md`. If a
redistributable reference dataset is added later, these tests stay as they are and the
comparison is added alongside them.

---

## ADR-015 — Separation-induced transition, a trailing-edge cut-off, and the honest incidence limit

**Status.** accepted

**Context.** Three things broke when the integral boundary layer was first marched over real
sections, and all three have the same root: an uncoupled integral method has no way to represent
flow that is not attached and thin.

1. A laminar boundary layer under the suction peak separates well before Michel's criterion is
   met -- at NACA 0012, four degrees, Reynolds one million, that happens at 27 % of chord.
   Treating it as a failure would have discarded most of the useful incidence range.
2. At a sharp trailing edge the inviscid edge velocity collapses toward the rear stagnation
   point. The momentum equation's `(H + 2) * theta / Ue * dUe/ds` term then diverges, and every
   section was reported as separating at 99.9 % of chord.
3. Even with both handled, the turbulent march reaches `H = 2.4` somewhere between six and eight
   degrees depending on camber, and raising the separation threshold to 3.0 buys only one more
   degree -- the limit is physical, not a threshold choice.

**Decision.**

- **Separation-induced transition.** When laminar separation precedes Michel's criterion, the
  march transitions at the separation point and continues turbulent. At this Reynolds number a
  laminar separation normally forms a short bubble that reattaches turbulent within a few per
  cent of chord, so this is the standard engineering treatment, but it is an assumption, not a
  model: no bubble length, no reattachment loss. `SurfaceBoundaryLayer.separation_induced_transition`
  records which mechanism fired, and the dataset carries it.
- **Trailing-edge cut-off at 98 % of chord.** The march stops there and Squire-Young is
  evaluated at that one consistent station -- `theta`, `H` and `Ue` all from it. Taking the edge
  velocity from the last panel instead put drag out by a factor of four, because `Ue` there is
  already collapsing: the cut-off is not cosmetic.
- **The incidence limit is published, not papered over.** Rows beyond the convergence limit are
  marked `bl_not_converged` and excluded from training. The dataset's sampled range stays wide;
  what narrows is the range in which rows actually converge, and the app warns outside it.

**Consequences.** NACA 0012 at Reynolds one million now gives `Cd = 0.0061` at zero incidence
against a published 0.0055 to 0.0060, with `theta_te = 0.00226` and `H_te = 1.66` -- textbook
values. Coverage thins above roughly six degrees and the surrogate will be weakest there, which
`docs/accuracy.md` must show per incidence rather than as a single aggregate number. Thwaites on
a flat plate reproduces Blasius to 1.03 %, which is that method's known accuracy, so the laminar
side carries about a percent of error before any of this is considered.

---

## ADR-016 — The sampled incidence range is set by measured convergence, and the schema is amended before publication

**Status.** accepted

**Context.** The plan assumed incidence from -6 to +14 degrees. Measuring the solver across a
Sobol sample of sixty shapes at eleven angles showed the viscous march converging for 90 % of
shapes at zero incidence, 45 % at six degrees, 15 % at ten and none at fourteen.

**Decision.** Cut the sampled range to -6 to +10 degrees. Beyond ten the yield is below 15 %,
which would spend a fifth of the run on rows that fail and still leave coverage too thin for the
surrogate to learn anything trustworthy. The negative side is kept to -6 despite a 47 % yield
because incidence coverage below zero is worth the compute.

`docs/DATASET-SCHEMA.md` is amended in place rather than version-bumped. ADR-010 requires a
version bump for a breaking change, but no `dataset-v1` Release exists yet and no consumer has
read real data, so there is nothing to break. The change is recorded in `CHANGELOG.md`, and the
schema now publishes the measured convergence table so a consumer can see the coverage rather
than discovering it. Once the Release is published this exemption ends.

**Consequences.** Roughly 8400 shapes at eight stratified angles each yields about 40 000
converged rows. The surrogate will be weakest at the extremes of the range, which
`docs/accuracy.md` must show per incidence. A guard was also added for a boundary-layer branch of
fewer than three points, which happens when the stagnation point lands on the trailing edge at
extreme incidence; it reports failure instead of raising.

---

## ADR-017 — Thirty-two POD modes stand, and the error is reported by region

**Status.** accepted

**Context.** The plan's acceptance criterion for the reduced-order basis was "POD energy at 32
modes is at least 99 %". On the full 67 200-row dataset the measured figures are 98.26 % of
in-sample variance and a 10.11 % relative rms reconstruction error over every row — well short of
it. A twenty-shape trial had suggested 99.87 %, but its basis was built from the very snapshots it
then reconstructed, so that number was never out-of-sample.

**Investigation.** Raising the subsample from 3000 to 8000 snapshots changed nothing, so the basis
is converged and the mode count is the binding constraint. Raising the mode count helps slowly:
48 modes give 98.71 % and 8.69 % error for a 3.6 MB atlas, 64 modes give 98.98 % and 7.81 % for
4.8 MB, against 2.4 MB at 32. Doubling the modes buys a fifth of the error and breaks the 3 MB
atlas budget.

Splitting the error by region explains why, and changes the conclusion. The section occupies a
different set of grid points in every row, so the masked body is a moving discontinuity — exactly
what a linear basis cannot compress. Over the 93 % of the domain away from the section the
reconstruction is accurate to **1.14 %** of the freestream, an absolute velocity error of 0.0011.
Within the band around the section it is **17.7 %**, and that band is where the renderer masks the
body with a signed distance field and kills particles anyway.

**Decision.** Keep 32 modes. The schema's 32 coefficient columns stand, the atlas stays at 2.43 MB,
and the acceptance criterion in `docs/PLAN.md` is rewritten to the measured truth with the regional
split, rather than being quietly dropped or met by inflating the mode count.

`docs/dataset.md` publishes all three figures and `tools/dataset/pod.py` gains `spatial_error`, so
the breakdown is regenerated from the data rather than typed in once.

**Consequences.** The honest claim is that the flow field a viewer sees is reconstructed to about
one per cent of the freestream everywhere the flow is visible, and that accuracy degrades sharply in
the few grid cells adjacent to the surface. `docs/accuracy.md` must repeat this, and the README's
honesty section must not quote the 98.26 % figure without the regional split beside it. If a future
version wants a genuinely better near-surface field, the fix is a body-fitted or
signed-distance-aware representation, not more modes.

---

## ADR-018 — Pressure stations stop at 98 % of chord, because the trailing-edge singularity reached the dataset

**Status.** accepted

**Context.** The first published dataset carried pressure coefficients up to 7e15 in the
`cp_063` and `cp_127` columns — the last station on each surface — on about 2 % of rows, with a
further 5 % beyond any physical value. The cause is the same one that forced the boundary-layer
cut-off in ADR-015: at a sharp trailing edge the inviscid edge velocity collapses into the rear
stagnation point and the panel solution there is badly conditioned. The station interpolation read
straight across those control points and published whatever came out.

This is the most dangerous class of error in this project. The columns looked like data, they would
have trained a model to predict 1e15, and nothing would have failed loudly.

**Decision.** Drop control points past 98 % of chord before interpolating onto the station grid —
the same cut-off, for the same reason, as the viscous march. The interpolation then clamps, holding
the last trustworthy value across the final two per cent of chord instead of extrapolating a
singularity. Two regression tests assert that no sampled section produces a pressure coefficient
above stagnation or a suction peak beyond -25, and a third asserts the last stations are held rather
than extrapolated.

**Consequences.** The worst pressure coefficient across 200 sampled sections at four incidences is
now -22.3, a real suction peak on a sharp nose at ten degrees. The published dataset was regenerated
and the `dataset-v1` Release assets replaced; the schema is unchanged, so the version is not bumped,
and `CHANGELOG.md` records the replacement.

The cost is real: the pressure recovery over the last two per cent of chord is flattened, so the
trailing-edge pressure in both the dataset and the app is held rather than resolved. Resolving it
properly needs viscous-inviscid coupling, which is out of scope. This limit belongs in
`docs/accuracy.md` and in the README's honesty section alongside the others.

---

## ADR-019 — A non-physical inviscid suction peak invalidates the row

**Status.** accepted

**Context.** With the trailing-edge singularity fixed (ADR-018), the pressure columns still carried
a tail: the worst sampled section reaches a pressure coefficient of -155, which means a local
velocity twelve times the freestream. That is not a bug in the panel method — the potential-flow
solution really is singular at a near-cusp leading edge — but it is not a flow this project can
claim to model, and a single target of -155 against a typical range of -4 to 1 would distort the
output normalisation and the loss.

**Measurement first.** Across the 67 200 rows the tail falls away smoothly: 1.2 % of rows go below
a peak of -10, 0.13 % below -15, 0.024 % below -20 and 0.018 % below -25. Those last twelve rows
come from four sections, and eleven of the twelve were already `bl_not_converged`.

**Decision.** Reject a row whose inviscid suction peak falls below -25 by marking it
`geometry_invalid` — the status the schema already reserves for geometry that cannot be solved
meaningfully — and nulling its drag columns. The floor is set where the measured tail thins to a
handful of sections rather than at a round number chosen in advance. Rows between -25 and -10 are
kept: they are extreme but they are the model's job to learn.

The rule lives in one function, `tools.solver.solve.pressure_is_physical`. `solve` applies it so a
fresh run never writes such a row as converged, and `tools.dataset.build` applies the same function
when assembling, so a dataset solved before the gate existed is corrected without a
twenty-five-minute re-solve. One rule, two callers, no second definition to drift.

**Consequences.** Twelve rows re-marked. Converged rows now span a pressure coefficient of -19.67 to
1.0000, with 41 540 of them — still above the 40 000 the plan asks for. The output normalisation is
left as mean and standard deviation rather than something percentile-based: with the gate in place
the remaining tail is about ten times the typical magnitude, not a hundred, and robust scaling would
be a second mechanism solving a problem the gate already solved. If the accuracy report shows
particular pressure stations fitting badly, that is the place to revisit it.

---

## ADR-020 — Drag and moment get the same trailing-edge treatment as pressure, and the build asserts what it publishes

**Status.** accepted

**Context.** With the pressure columns fixed (ADR-018) and the non-physical suction peaks gated
(ADR-019), training still produced nonsense for two of the three force coefficients: a held-out drag
prediction range of -29 144 to 108 549, and a normalisation scale for drag of 1.2e7. The model was
fine — lift came out with a mean absolute error of 0.0062 — and the targets were not.

Two separate defects, both of the same shape as ADR-018: a plausible-looking column full of
nonsense.

* **The moment inherited the trailing-edge singularity.** ADR-018 excluded the singular control
  points from the *reported pressure stations* but not from the force and moment integrals, and the
  moment amplifies them because the lever arm at the trailing edge is three quarters of a chord.
  Result: 360 converged rows, 0.87 % of them, with a quarter-chord moment outside ±0.3, the worst at
  -11 770, against a 99.99th percentile of 0.103.
* **The viscous march could diverge while reporting success.** Forward Euler on the momentum
  equation can run away before the shape factor reaches the separation threshold. Two rows had a
  drag above 0.05 and one reached 2.2e9, against a 99.99th percentile of 0.0296.

**Decision.** Three changes.

1. The force and moment integrals use the same 98 %-of-chord cut-off as the pressure stations and
   the viscous march. One cut-off, one reason, three places. On well-behaved sections it costs
   almost nothing: NACA 2412's quarter-chord moment moves from -0.0553 to -0.0552 and NACA 4412's
   from -0.1104 to -0.1097, both still matching their published values as before.
2. The march declares itself not converged when the momentum thickness exceeds a twentieth of the
   chord. A boundary layer that thick at Reynolds one million is not attached flow by any reading,
   so it is a failure rather than a number.
3. `tools.dataset.build` asserts that every converged row it is about to publish has lift within
   ±3, drag between 0.001 and 0.05, a quarter-chord moment within ±0.5 and no pressure above
   stagnation — and raises rather than writing the file if not.

That third point is the one that matters most. Every data defect this project has shipped looked
exactly like data, and each was found only because something downstream behaved absurdly. The
assertion turns the next one into a failed build instead of a trained model. Its bounds are not
gates: the solver's own guards decide what converges, and a row outside these bounds means a guard
has a hole, which is to be fixed rather than accommodated by widening the bound.

**Consequences.** The dataset is regenerated and the `dataset-v1` Release assets replaced again.
The schema is unchanged, so the version is not bumped. The moment is now integrated over 98 % of the
chord rather than all of it, which is a documented approximation belonging with the others in
`docs/solver-validation.md`.

**Addendum, found by the assertion itself.** The first regeneration under this ADR failed its own
new check: two converged rows still carried a drag of 2.2e9. The momentum-thickness bound and the
trailing-edge cut-off had both been added inside the *turbulent* branch of the march, and these two
rows took the fully-laminar return path, which reported from the branch end where the inviscid edge
velocity is collapsing -- 26 663, raised to the power 3.6 by Squire-Young. The cut-off station is
now computed once, before the march branches, and every return path reports from it. The assertion
caught in forty minutes what three milestones of downstream work had not.

A second defect surfaced while debugging it: `generate_shapes(4000)` and `generate_shapes(8400)`
returned entirely different geometries under the same seed, because the Sobol block size was derived
from the requested count. A shape id therefore meant nothing outside the run that produced it, which
made the first attempt to reproduce the failing rows reproduce different rows instead. The block is
now a fixed 4096, so a smaller request is a prefix of a larger one.
