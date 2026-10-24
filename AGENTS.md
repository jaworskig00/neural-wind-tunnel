# AGENTS.md — how to work in this repository

Operating manual for coding agents (Claude Code, Cursor, Codex) and for humans. Read this
before touching anything, then follow [`docs/PLAN.md`](docs/PLAN.md) task by task.

## What this project is

A browser wind tunnel. The user shapes a parametric airfoil, a small neural surrogate trained on
an in-repo panel-method solver predicts the surface pressure distribution, the force
coefficients and 32 POD coefficients of the velocity field, and the GPU reconstructs that field
and advects hundreds of thousands of particles through it. An optional LLM layer turns plain
language into concrete parameter changes.

It is a portfolio piece aimed at engineers. Two things matter above features: the rendering and
shader code must be genuinely good, and every physical claim must be honest and backed by a
measured number.

## Read order

1. [`docs/PLAN.md`](docs/PLAN.md) — the plan; find the first unticked task and do that one.
2. [`docs/DECISIONS.md`](docs/DECISIONS.md) — why things are the way they are. Do not relitigate an ADR; add a new one if you must change course.
3. [`docs/DATASET-SCHEMA.md`](docs/DATASET-SCHEMA.md) and [`docs/URL-STATE.md`](docs/URL-STATE.md) — versioned contracts shared with a sister repository. Changing either is a deliberate, documented act.
4. [`docs/PROGRESS.md`](docs/PROGRESS.md) — what happened before you arrived.

## Commands

```bash
pnpm install            # install web dependencies
pnpm dev                # Vite dev server
pnpm build              # production build, static output
pnpm preview            # serve the build
pnpm lint               # ESLint
pnpm typecheck          # tsc --noEmit
pnpm test               # Vitest unit tests
pnpm test:e2e           # Playwright
pnpm format             # Prettier write

uv sync                 # Python environment for tools/
uv run pytest           # solver, dataset and training tests
uv run ruff check .     # Python lint
uv run python -m tools.dataset.run --help     # dataset pipeline entry point
uv run python -m tools.train.train --help     # training entry point
```

`pnpm install && pnpm dev` must work at every single commit. If a commit breaks the dev server,
fixing it is the next task, ahead of everything else.

## Conventions

### TypeScript

- `strict` on, no `any` without a comment explaining why, no non-null assertions in new code.
- Modules stay small and single-purpose; the folder layout in `docs/PLAN.md` is the boundary map.
- No barrel files that re-export everything; import from the module that owns the symbol.
- Comments explain why, not what. Physics and shader maths get a comment with the formula or a
  reference; plumbing does not get narrated.
- Units and conventions belong in the name or in a comment: `alphaDeg`, not `alpha`.

### Shaders

- One concern per `.glsl` file, with a header comment stating what it computes, its inputs and
  the coordinate space it works in.
- Shared helpers live in `src/shaders/lib/` and are composed with the project's include
  convention; no copy-pasted noise or colormap functions.
- Every render target states its format and precision where it is created, and every pass says
  what it reads and what it writes.
- Magic numbers get a name or a comment. A tuned constant is fine; an unexplained one is not.

### Python

- Pure functions over classes in the solver; NumPy arrays in, NumPy arrays out.
- Every solver function carries a docstring with the governing equation or a textbook reference.
- Numerical tolerances are named constants, not literals buried in an assertion.
- No silent failures. A case that does not converge returns a status, and the caller records it.

### Tests

- Unit tests where the logic is real: geometry, the panel method, the boundary layer, the CST
  port parity, the URL codec, the inference backends' parity, the LLM tool dispatcher.
- Playwright for anything visual or timing-related: boot with no console errors, screenshots of
  each visualisation mode, frame-time budgets, the URL round trip, keyboard operation.
- Do not write tests that assert the implementation back to itself. A test that cannot fail is
  worse than no test.

## Git workflow

- Work directly on `main`. Small, focused commits, one per completed task or smaller.
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `perf:`, `refactor:`,
  `build:`, `ci:`.
- Commit messages carry **no co-author trailers and no mention of the tool that wrote them**.
  Describe the change, not the author.
- Push after every task once local checks pass. Progress is never left only on disk.
- Tag every finished milestone: `v0.1.0-m0`, `v0.2.0-m1`, … and `v1.0.0` at the end. Update
  `CHANGELOG.md` in the same commit as the tag.
- Never force-push, never rewrite pushed history.
- Never commit secrets, `.env` files, API keys, datasets, model artifacts or any binary over a
  megabyte. Generated artifacts belong in GitHub Release assets; see ADR-012.

## The autonomous loop

For each task, in this order:

1. Read the task and its acceptance criteria in `docs/PLAN.md`.
2. Implement it. Stay inside the task; resist adjacent refactors and note them for later instead.
3. Run the checks that apply: `pnpm lint typecheck test build`, `pnpm test:e2e` for anything
   visual, `uv run ruff check . && uv run pytest` for Python changes.
4. Verify the acceptance criteria yourself. For visual work that means running the app, taking
   Playwright screenshots and actually looking at them against the criteria. Keep the screenshots
   that belong in the README under `docs/screenshots/`.
5. Commit and push.
6. Tick the checkbox in `docs/PLAN.md`.
7. Append an entry to `docs/PROGRESS.md`: what was done, how it was verified, numbers where there
   are numbers, and any follow-up you deliberately skipped.

Then move to the next unticked task.

### Ambiguity

Do not stop to ask questions while running unattended. Choose the most sensible option, write it
down as a new ADR in `docs/DECISIONS.md`, note it in `docs/QUESTIONS.md`, and keep going.

Stop only for a true blocker that no default can resolve — missing credentials, a service that
needs a human account, a push permission you do not have. In that case log it clearly in
`docs/QUESTIONS.md`, skip to the next independent task, and continue. Never fabricate a
measurement or a result to get past a blocker.

### CI

CI must stay green. If a push turns it red, fixing it is the next task, before any new feature
work. Check with `gh run list --limit 1` after pushing.

### Cost and keys

Add no paid services and no API keys. The LLM layer is bring-your-own-key and the app must be
fully usable without one. Never write a key into the repository, a log, an error message or a
URL.

## Honesty rules, specific to this project

These are not style preferences. Breaking one defeats the purpose of the project.

- The surrogate is an approximation. The UI says so, visibly, on first load, with a link to
  `docs/accuracy.md`.
- The velocity field is always `mean + sum(a_i * phi_i)` from the model's predicted coefficients.
  Procedural noise, hand-tuned curl fields and "it looks about right" hacks never stand in for a
  solution, not even temporarily.
- Accuracy, performance and dataset numbers in any document are measured on a real run and
  reproducible. If a target is missed, write the real number and say it was missed.
- Out-of-range inputs produce a warning, not a plausible-looking extrapolation.

## Finishing

The last milestone is a polish pass: dead-code and bundle audit, demo media captured with
Playwright, a complete README (hero media, live demo placeholder, architecture diagram, how the
ML works, how the shaders work, honest limits, local setup), `CHANGELOG.md` finished, every
checkbox in `docs/PLAN.md` ticked, `docs/QUESTIONS.md` reduced to what is genuinely still open,
and the `v1.0.0` tag pushed with CI green on that commit.
