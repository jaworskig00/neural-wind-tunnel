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
