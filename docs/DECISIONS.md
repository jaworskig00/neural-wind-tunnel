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
