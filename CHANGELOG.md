# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
