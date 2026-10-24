# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Pressure stations no longer interpolate across the singular control points at a sharp trailing
  edge. The first `dataset-v1` assets carried pressure coefficients up to 7e15 in the last station
  of each surface on about 2 % of rows; the dataset was regenerated and the Release assets replaced.
  See ADR-018.

### Changed

- `docs/DATASET-SCHEMA.md`: the sampled incidence range is now -6 to +10 degrees rather than
  -6 to +14, and the document publishes the measured per-incidence convergence rate. Amended in
  place rather than version-bumped because no dataset Release exists yet; see ADR-016.

## [1.0.0] - 2026-10-24

Milestone M9, and version one. The application is complete: solver, dataset, surrogate, flow
field, charts, shareable state, assistant and the documentation that says how far any of it can be
trusted. Deployment is the only thing deliberately left open.

### Added

- The full README: hero animation, the measured error of both the surrogate and the solver it
  learned from, an architecture diagram, and what the thing cannot do.
- `tests/e2e/media.spec.ts` and `scripts/make-hero.sh`: every screenshot and the hero animation
  are captured from the running application by a deep link, on the machine's own GPU, and can be
  regenerated with two commands.
- A budget for the assistant chunk, which is now lazily loaded.

### Changed

- The assistant moved behind a lazy import, taking the entry bundle from 95.7 kB to 88.7 kB
  gzipped. Nothing in the entry bundle reaches `src/llm`.
- Four exports that nothing outside their own module used are no longer exported.

### Fixed

- Choosing a particle tier by hand had no effect when the automatic probe had already climbed
  from that same tier: the button showed as selected and the particle count did not change. The
  probe's decision now applies only while the tier is automatic.

## [0.9.0-m8] - 2026-10-24

Milestone M8: the assistant.

### Added

- An assistant with four tools — `set_shape_params`, `nudge_shape`, `run_alpha_sweep` and
  `explain_result` — dispatched through `src/llm/dispatch.ts`, which clamps every proposed design
  to the range the surrogate was trained on and reports what it had to move.
- Provider adapters for Anthropic's Messages API and any OpenAI-compatible chat-completions
  endpoint, including a gateway on localhost. The key is entered in the panel and kept in this
  browser's local storage.
- A demo mode that needs no key: three recorded conversations whose prose is recorded and whose
  tool calls run for real against the live surrogate.
- A chat panel showing every tool call by name with the coefficient delta it produced and an undo
  that restores the design from before that call.
- `scripts/check-bundle.mjs`, run in CI: fails the build if anything credential-shaped reaches
  `dist` or if the production Content Security Policy is missing.

### Security

- A Content Security Policy injected into the production build.
- The API key never enters the URL state, a log or an error message; an end-to-end test plants a
  canary key and asserts it reaches only the provider's request header.

## [0.8.0-m7] - 2026-10-24

Milestone M7: streamlines, polars, shareable state and the accessibility pass.

### Added

- Streamlines integrated on the CPU from the reconstructed velocity field and drawn as one
  `LineSegments`, terminating on the section surface and at the domain edge.
- Polars for Cl against incidence and Cl against drag, swept across the trained range off the
  critical path, with the current operating point marked and the exact solver overlaid where a
  reference exists for the section.
- Shareable URL state per `docs/URL-STATE.md`, with notices when a link is clamped or carries a
  version this build does not read.
- `docs/accessibility.md` and an end-to-end accessibility suite: keyboard operation of every
  slider, a visible focus ring, named charts, and `prefers-reduced-motion` honoured by pausing the
  particles and drawing the field as streamlines instead.

### Changed

- `--color-faint` raised from `#5a6977` to `#738698`. The old value was 3.4:1 against the panel
  background, below AA for the caption-sized text it carried. The slider track moved from the
  structural line colour to this one so it clears 3:1 as a control.

## [0.7.0-m6] - 2026-10-24

Milestone M6: the reduced-order field and the particles.

### Added

- POD mode atlas loader with capability detection: float render targets, linear filtering of float
  textures and precision are probed before the first frame, and each has a documented fallback.
- Field reconstruction in one fragment-shader pass: the mean field plus 32 predicted coefficients
  written into a float render target, rebuilt only when the prediction changes.
- A GPGPU particle system — ping-pong position textures, RK2 advection, respawn at the inlet, a
  body mask the particles cannot enter — with trails accumulated in a separate target and
  tone-mapped over the scene.
- Performance tiering: a capability probe picks the starting tier and a frame-time probe adjusts
  it, between 65 536 and 1 048 576 particles.
- `docs/perf.md` with the method and the measured numbers.

## [0.6.0-m5] - 2026-10-24

Milestone M5: inference in the browser, and the pressure the visitor can see.

### Added

- Two surrogate backends behind one interface: ONNX Runtime Web, and a hand-written forward pass
  in TypeScript. A parity test holds them and the committed Python reference case to 1e-4.
- The pressure colormap on the section surface in GLSL, with a legend, a colour-blind-safe option
  and the sign convention stated.
- The pressure chart with the inverted axis, and an overlay of the exact solver wherever a
  reference exists for the section on screen.
- The honesty banner, visible on first load and linking the measured accuracy.

## [0.5.0-m4] - 2026-10-24

Milestone M4: the application shell and the scene.

### Added

- The layout: viewport, parameter panel, chart dock and the coefficient header.
- `src/geometry/cst.ts`, a TypeScript port of the CST evaluator, held to the Python original
  within 1e-6 by a committed fixture.
- The react-three-fiber scene: an extruded section rebuilt from the CST weights on every change,
  an orbit camera with limits, and the presets and sliders that drive it.

## [0.4.0-m3] - 2026-10-24

Milestone M3: training and export.

### Added

- The training pipeline: a deterministic split by design id so no section appears in two splits,
  a group-weighted masked loss, and trimmed-mean epoch selection.
- Export to `surrogate.onnx`, raw `weights.bin` with a manifest for the TypeScript backend, and a
  reference case that CI replays against the published artifact.
- `docs/accuracy.md`, regenerated from the held-out test split.

### Changed

- The loss moved from squared error to Huber. Squared error improved 99 % of rows while the
  extreme one per cent grew steadily worse, which is the wrong trade for a model whose job is to
  be trustworthy at the edges of its range.

## [0.3.0-m2] - 2026-10-24

Milestone M2: the dataset.

### Added

- Sobol sampling over the twelve CST weights with validity filters, a resumable multiprocessing
  runner, and parquet shards carrying a per-row solver status rather than silently dropping
  failures.
- The POD basis: 32 modes carrying 99 % of the velocity-field energy, exported as an `.npz` and as
  the fp16 atlas the browser loads.
- `docs/dataset.md`, the `dataset-v1` Release, and a 2000-row sample committed for the sister
  project and the tests.

### Fixed

- Sobol sampling is now drawn in fixed blocks, so a smaller run is a prefix of a larger one.
  Without it, two runs of different sizes produced different designs for the same index.

## [0.2.0-m1] - 2026-10-24

Milestone M1: the solver.

### Added

- A linear-strength vortex panel method with the Kutta condition, verified against the exact
  circle solution and against published NACA data.
- An integral boundary layer: Thwaites, Michel's transition criterion, Head's entrainment method,
  Ludwieg-Tillmann skin friction and Squire-Young drag, with explicit non-convergence rather than
  a fabricated number.
- Induced-velocity evaluation on the 192 x 96 grid the schema defines.
- `docs/solver-validation.md`, including a plain statement of what the solver cannot do.

## [0.1.0-m0] - 2026-10-24

Milestone M0: the repository, the toolchain and continuous integration.

### Added

- Planning documents: `docs/PLAN.md` with milestones M0 through M10 and acceptance criteria,
  `docs/DECISIONS.md` with twelve decision records, `docs/QUESTIONS.md`, `docs/PROGRESS.md`,
  `AGENTS.md`, `CLAUDE.md` and a Cursor rules file.
- `docs/DATASET-SCHEMA.md` and `docs/URL-STATE.md`: versioned contracts shared with the
  design-space-explorer sister project, plus `tools/stub_dataset.py`, a dependency-free
  placeholder generator so that project is never blocked on this one.
- Vite 8 + React 19 + TypeScript 6 scaffold with `strict`, `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`, an application shell, and `src/geometry/stations.ts` holding the
  cosine surface-station grid from the dataset schema.
- ESLint 10 flat config with type-aware `typescript-eslint` rules, the react-hooks and
  react-refresh plugins, Prettier, and a `lint-staged` pre-commit hook.
- Vitest with v8 coverage, and tests holding the station grid to the schema contract.
- Playwright smoke suite: the app boots with no console errors and no failed requests.
- uv-managed Python toolchain with ruff and pytest, and the package layout for the solver,
  dataset and training tools.
- GitHub Actions CI with a web job and a Python job, dependency and browser caching, and a
  250 kB gzip bundle budget enforced by size-limit.

[unreleased]: https://github.com/jaworskig00/neural-wind-tunnel/compare/v0.1.0-m0...HEAD
[0.1.0-m0]: https://github.com/jaworskig00/neural-wind-tunnel/releases/tag/v0.1.0-m0
