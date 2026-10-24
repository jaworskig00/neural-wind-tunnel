# Progress log

Append one entry per completed task, newest at the bottom. This is the record a human reads to
find out what actually happened while nobody was watching, so write numbers rather than
adjectives, and write down what you skipped.

Entry format:

```markdown
## YYYY-MM-DD — Tn.m short title

**Done.** What changed, in one or two sentences.
**Verified.** The checks that ran and what they showed. Measured numbers where there are numbers.
**Follow-ups.** Anything deliberately left undone, or "none".
**Commit.** `<short sha>`
```

---

## 2026-10-24 — Planning

**Done.** Repository created; planning documents written: `docs/PLAN.md` (M0 through M10 with
acceptance criteria), `docs/DECISIONS.md` (ADR-001 through ADR-012), `docs/DATASET-SCHEMA.md` and
`docs/URL-STATE.md` (versioned contracts shared with the design-space-explorer sister project),
`AGENTS.md`, `CLAUDE.md`, a Cursor rules file, `README.md` skeleton, and
`tools/stub_dataset.py` so the sister project can be built before this project's dataset exists.

**Verified.** `python3 tools/stub_dataset.py --rows 400` produces 194 columns matching
`docs/DATASET-SCHEMA.md` exactly, with plausible ranges: thickness/chord 0.061 to 0.198,
`cl` -0.77 to 1.41, `cd` 0.0069 to 0.0254. Preflight environment check: gh authenticated as
jaworskig00, git identity set, Node 25.8.2, pnpm 10.30.0, Python 3.12.12, uv 0.9.16, gh 2.86.0.

**Follow-ups.** No application code yet by design — M0 starts with the Vite scaffold and CI.
Playwright browsers not yet installed; that happens in T0.5.

**Commit.** see `git log`

## 2026-10-24 — T0.2 Vite + React + TypeScript scaffold

**Done.** Vite 8.3 + React 19.3 + TypeScript 6.0 scaffold with `strict` plus
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (the current Vite template ships
without `strict` at all). Placeholder shell in `src/app/App.tsx`, project favicon, and
`src/geometry/stations.ts` — the cosine surface-station grid from `docs/DATASET-SCHEMA.md`
section 3, which the shell renders so the toolchain is proven end to end.

**Verified.** `pnpm typecheck` clean; `pnpm build` produced 220.71 kB raw / 69.08 kB gzip,
well inside the 250 kB gzip budget; dev server on port 5182 renders the shell with zero
console errors and reports stations 0.000 to 1.000 as the schema requires. Screenshot taken.

**Follow-ups.** The app's launch config uses port 5182 because the preview tooling resolved a
different project's config on 5173. Linting is still the template's default; T0.3 replaces it
with ESLint as the plan specifies.

**Commit.** see `git log`

## 2026-10-24 — T0.3 ESLint, Prettier and the pre-commit hook

**Done.** ESLint 10 flat config with `typescript-eslint` 8.72 `strictTypeChecked` (type-aware,
via the project service), the flat variant of `eslint-plugin-react-hooks` 7 for `.tsx` files,
`eslint-plugin-react-refresh`, and `eslint-config-prettier` last so formatting rules stay off.
Prettier configured at 100 columns, no semicolons, single quotes. `simple-git-hooks` installs a
pre-commit hook that runs `lint-staged` over staged TypeScript, config, markdown and Python
files.

**Verified.** `pnpm lint` exits 0 on the whole tree, `pnpm typecheck` clean, `prettier --write`
reformatted two files and is now idempotent, and `.git/hooks/pre-commit` exists and calls
`lint-staged`.

**Follow-ups.** The plugin's `configs['recommended-latest']` is still eslintrc-shaped; the flat
config lives under `configs.flat['recommended-latest']`, which is what this project uses. Noted
here because the plugin's README shows the other one.

**Commit.** see `git log`

## 2026-10-24 — T0.4 Vitest with coverage

**Done.** Vitest 5 configured with the v8 coverage provider, text and lcov reporters, and unit
tests co-located with their module. Eight tests cover `src/geometry/stations.ts` against the
contract in `docs/DATASET-SCHEMA.md` section 3: column count, exact chord span, monotonicity,
cosine clustering symmetric about mid-chord, agreement with the closed form to 15 digits, and
the surface/index mapping including its range guards.

**Verified.** `pnpm test` 8 passed; `pnpm test:coverage` reports 100 % of
`src/geometry/stations.ts` covered. `App.tsx` is uncovered by design — the Playwright smoke
test in T0.5 owns it.

**Follow-ups.** Added an ESLint override allowing non-null assertions in `*.test.ts` only:
indexing a `Float64Array` under `noUncheckedIndexedAccess` is `number | undefined`, and an
unwrap helper in every assertion reads worse than the assertion. Production code keeps the rule
on. `docs/PLAN.md` folder map updated: unit tests are co-located, `tests/e2e` is Playwright's.

**Commit.** see `git log`
