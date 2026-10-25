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

## 2026-10-24 — T0.5 Playwright smoke suite

**Done.** Playwright configured against a 1440x900 viewport (the same size the M6 frame-time
budget is measured at), with its own dev server on port 5182, the GitHub reporter under CI and
a trace on first retry. Two specs: the app boots with no console errors, no page errors and no
failed or 4xx/5xx requests; and the shell renders the station grid values the schema requires.

**Verified.** `pnpm test:e2e` 2 passed in 2.5 s. `pnpm lint` and `pnpm typecheck` clean.
Chromium headless shell 156 installed locally.

**Follow-ups.** None. Screenshot capture for the README is T4.5 and T9.2.

**Commit.** see `git log`

## 2026-10-24 — T0.6 Python toolchain

**Done.** `pyproject.toml` for uv with numpy as the only runtime dependency and pytest plus ruff
as the dev group; `package = false` because the tools run from the repository root as
`python -m tools.…` rather than being installed. Package layout created for
`tools/solver`, `tools/dataset` and `tools/train`, each with a docstring stating its remit.
Ruff set to 100 columns with pycodestyle, pyflakes, import sorting, naming, pyupgrade, bugbear,
simplify and ruff rules; `E741` is off because single-letter symbols are the readable choice in
code that mirrors a textbook formula.

**Verified.** `uv sync` installed numpy 2.x, pytest 9.1.1 and ruff 0.17.2. `uv run ruff check .`
and `ruff format --check` clean. `uv run pytest` 6 passed — the tests assert the stub generator
against `docs/DATASET-SCHEMA.md`: 194 columns in the documented order with no duplicates, the
cosine station formula to 1e-12, trailing-edge closure, rejection of crossing surfaces, the
leading-edge radius relation, and finite values with stagnation pressure at each nose.
Regenerated 200 rows after formatting to confirm the script still produces 194 columns.

**Follow-ups.** None. Pandas and pyarrow arrive with the dataset writer in T2.2, PyTorch in T3.2.

**Commit.** see `git log`

## 2026-10-24 — T0.7 GitHub Actions CI

**Done.** `.github/workflows/ci.yml` with two jobs on every push to `main`, every pull request
and manual dispatch, with in-progress runs cancelled per ref. The web job installs with a frozen
lockfile and pnpm's cache, then runs lint, the Prettier check, typecheck, unit tests with
coverage, the production build, the bundle budget, and the Playwright smoke suite with the
browser binaries cached by lockfile hash; the report uploads as an artifact on failure. The
Python job uses uv with its cache, `uv sync --locked`, ruff check, ruff format check and pytest.

**Verified.** `pnpm size` reports 68.19 kB gzipped against the documented 250 kB budget (the
check is configured for gzip so every number in the docs speaks the same unit; size-limit
defaults to brotli). `pnpm format:check` clean across the tree including the workflow. `uv.lock`
is committed and not ignored, so `--locked` will resolve.

**Follow-ups.** The model-artifact load check joins this workflow in T3.5.

**Commit.** see `git log`

## 2026-10-24 — T0.8 Milestone M0 closed

**Done.** `CHANGELOG.md` written for the 0.1.0-m0 release, README CI badge confirmed pointing at
`ci.yml`, every M0 checkbox and the preflight checklist ticked in `docs/PLAN.md`.

**Verified.** CI run 40058722896 is green on both jobs. The first attempt failed because
`astral-sh/setup-uv` publishes no moving major tag, so `@v10` does not resolve; pinned to
`v10.3.2` and re-run. Preflight confirmed on this machine: gh authenticated as jaworskig00,
git identity set, Node 25.8.2 matching `.nvmrc`, pnpm 10.30.0, Python 3.12.12, uv 0.9.16,
Playwright Chromium 156 installed, push to `main` working.

**Follow-ups.** The WebGL2 float-render-target capability check from the preflight list is
deferred to T6.1, where the code that needs it is written; headless Chromium's support will be
measured there rather than assumed now.

**Commit.** see `git log`

## 2026-10-24 — T1.1 Airfoil geometry

**Done.** `tools/solver/geometry.py`: cosine panel spacing, NACA four-digit sections with the
closing `-0.1036` thickness coefficient, the CST parametrisation from `docs/DATASET-SCHEMA.md`
section 2, a least-squares CST fit for existing coordinates, and the derived geometry metrics
with parabolic refinement of the thickness and camber extrema. Sections are stored as a closed
loop ordered trailing edge, upper surface, nose, lower surface, trailing edge — XFOIL's ordering,
which the panel method will depend on.

**Verified.** `uv run pytest tools/solver` 20 passed. NACA 0012 maximum thickness 0.11998
against 0.12, inside the plan's 1e-4 criterion; thicker and cambered sections inside 3e-4. NACA
2412 camber 0.02000 at x = 0.4026 against the designated 0.40. Leading-edge radius exact when the
closed form is supplied: 0.01587 for a 12 % section. CST round trip of NACA 2412 within 4e-3
overall and 1e-3 outside the first 0.5 % of chord. Ruff check and format clean.

**Follow-ups.** ADR-013 records two numerical decisions: the leading-edge radius comes from the
closed form rather than a coordinate fit, and the six-weight CST nose residual is documented
rather than engineered away, since the schema fixes the weight count. A flat-plate degenerate
case is covered so the dataset's validity filters cannot crash on it.

**Commit.** see `git log`

## 2026-10-24 — T1.2 and T1.3 Inviscid panel method and its verification

**Done.** `tools/solver/panel.py`: linear-strength vortex panel method with continuous nodal
strengths and the Kutta condition, influence coefficients vectorised over both panel indices,
surface pressure, lift from circulation, lift from pressure integration as an independent
cross-check, and the quarter-chord moment. A winding-order guard rejects a clockwise loop
outright.

**Verified.** `uv run pytest tools/solver` 38 passed. Circle against the exact solution:
rms error 3.46e-2, 1.72e-2, 8.53e-3 at 100, 200 and 400 panels — clean first-order convergence —
with lift and moment at 1e-13. NACA 0004 lift slope 6.4925 per radian, 3.3 % above 2*pi; the
thickness correction `2*pi(1 + 0.77 t/c)` matched within 1.2 % from 4 % to 18 % thickness.
`Cl / sin(alpha)` constant to nine digits for NACA 0012. NACA 2412 quarter-chord moment -0.0553
against a published experimental -0.053. The two lift routes agree within 0.3 % at 320 panels and
their gap halves as the panel count doubles.

**Follow-ups.** Two real bugs were caught and fixed during verification, both worth recording
because they produce plausible-looking output rather than errors. The nodal strengths are
non-dimensionalised by `2*pi*V_inf` in this formulation, so the circulation needed that factor —
without it lift was a factor of 2*pi low while still being perfectly linear in incidence. And the
quarter-chord moment came out nose-up for a cambered section: the cross product gives the
mathematically positive moment, which with x aft and y up is nose-down. The winding-order guard
exists because a reversed loop silently solves the interior problem and returns a nearly
motionless field; that cost twenty minutes before the shoelace area made it obvious.

ADR-014 records why verification uses derivable truth rather than transcribed reference tables,
and the T1.3 acceptance criterion in `docs/PLAN.md` was rewritten to match what is actually
asserted.

**Commit.** see `git log`

## 2026-10-24 — T1.4 Integral boundary layer and the solver entry point

**Done.** `tools/solver/boundary_layer.py`: Thwaites' laminar method, Michel's transition
criterion, Head's entrainment method with the Ludwieg-Tillmann skin-friction law, and
Squire-Young profile drag, with explicit statuses for laminar separation, turbulent separation
and non-convergence. `tools/solver/solve.py` is the single entry point the dataset pipeline
calls: it splits the geometric surfaces for the 128 pressure stations, splits the branches at the
stagnation point for the viscous march, and returns one row's worth of results.

**Verified.** `uv run pytest` 77 passed. Thwaites on a flat plate reproduces Blasius with
`theta` ratio 1.0103 at every station — exactly the method's known 1 % accuracy, since it gives
`sqrt(0.45) = 0.6708` against Blasius' 0.664 — and skin friction within 2 %. Laminar drag scales
as `Re**-0.5` to within 1 %. Head's `H` and `H1` relations invert to 1e-3. NACA 0012 at Reynolds
one million, zero incidence: `Cd = 0.00609` against a published 0.0055 to 0.0060,
`theta_te = 0.00226`, `H_te = 1.66`, transition at 55.5 % of chord. Drag rises monotonically with
incidence and transition marches forward on the suction side and aft on the pressure side.

**Follow-ups.** ADR-015 records three decisions forced by the physics: laminar separation now
induces transition rather than failing the row, the march stops at 98 % of chord because the edge
velocity collapses into the rear stagnation point at a sharp trailing edge, and the convergence
limit of roughly six to eight degrees depending on camber is published rather than tuned away.
Taking the Squire-Young edge velocity from the last panel instead of the cut-off station put drag
out by a factor of four — worth remembering. `docs/DATASET-SCHEMA.md` now warns that valid-row
density thins above about six degrees.

**Commit.** see `git log`

## 2026-10-24 — T1.5 Velocity field sampling

**Done.** `tools/solver/field.py` evaluates the velocity the panel distribution induces anywhere
in the plane and samples it on the 192 by 96 grid from `docs/DATASET-SCHEMA.md` section 4, with a
vectorised crossing-number test masking the body. The per-panel integrals are closed form and
free of the `1/y` that appears in the intermediate steps, so no special case is needed near the
panel line. Evaluation is chunked at 2048 points because the dense points-by-panels intermediates
would otherwise allocate several hundred megabytes per worker during the dataset run. `solve` now
takes `with_field` and carries the result.

**Verified.** `uv run pytest` 89 passed. The panel velocity formula matches direct quadrature of
point vortices to six decimals on four independent cases. Induced velocity decays as exactly
`1/r` and converges to the point-vortex limit `Gamma / (2 pi r)` within 1 % at a thousand chords.
The counter-clockwise line integral around a rectangle three chords on a side equals `-cl / 2` to
one part in a thousand. A symmetric section at zero incidence gives an even `u` and an odd `v` to
1e-9. One solve takes 2.1 ms, or 84.9 ms with the field.

**Follow-ups.** The signed circulation check caught a real inverted vortex sign: the panel solver
follows Kuethe and Chow's rotational convention, which is opposite to the point-vortex convention
the field integrals are derived in. The far field and the circulation _magnitude_ were both
correct while the near field was slowing the flow over the shoulder instead of speeding it up —
exactly the kind of error that would have produced a beautiful, wrong particle animation. Both
the signed circulation and the near-field acceleration are now asserted.

A surface-limit consistency test comparing the field just outside a control point against the
panel edge velocity was tried and dropped: evaluating on a vortex sheet returns the mean of the
two sides rather than the outside value, so the comparison needs a `gamma/2` correction and is
delicate at panel-length scales. The circulation integral covers the same ground unambiguously.

**Commit.** see `git log`

## 2026-10-24 — T1.6 Solver validation document, milestone M1 closed

**Done.** `docs/solver-validation.md` with five regenerable figures and the measured numbers
behind every claim: the exact circle comparison with its convergence, lift-curve slope against
the thickness correction, Thwaites against Blasius, NACA 0012 pressure distributions and polar
with the published drag band drawn on, and the sampled velocity field.
`tools/solver/make_validation_figures.py` regenerates all of them with one command.

**Verified.** `uv run pytest` 89 passed. Figures inspected rather than assumed: the velocity
field shows acceleration over the suction side, the stagnation point below the nose at positive
incidence, and upwash ahead with downwash behind. The polar's minimum drag sits just to the right
of the published 0.0055 to 0.0060 band, which is visible in the figure rather than hidden in prose.

**Follow-ups.** The document states seven limits plainly, including the two that most constrain
the project: the viscous march converges only to between 4.5 and 7 degrees depending on camber,
and separation-induced transition — an assumption, not a model — is what sets transition above
roughly four degrees. Both must surface in the app and in `docs/accuracy.md`.

**Commit.** see `git log`

## 2026-10-24 — T2.1 Shape sampling

**Done.** `tools/dataset/sample.py`: scrambled Sobol sequence over the twelve CST weights, drawn
in powers-of-two blocks so its balance properties hold, with the published validity filters and a
tally of why candidates were rejected. Incidences are drawn one per stratum so every shape covers
the whole range without every shape sharing the same grid of angles. The leading-edge radius comes
from the closed form, per ADR-013.

**Verified.** `uv run pytest tools/dataset` 16 passed, including that Sobol's worst per-dimension
gap beats independent uniform draws of the same size. Acceptance rate 83 % over 240 candidates,
rejections split 33 crossing surfaces and 7 out-of-range thickness. The accepted set spans
thickness 0.064 to 0.200 and camber -0.043 to +0.058.

**Follow-ups.** Measured the solver's convergence across the design space — sixty shapes at
eleven angles — and cut the sampled incidence range from +14 to +10 degrees as a result: the
converged fraction is 90 % at zero incidence, 45 % at six degrees, 15 % at ten and zero at
fourteen. ADR-016 records the decision and the schema now publishes that table instead of leaving
a consumer to discover it. The measurement also turned up a crash: a boundary-layer branch of
fewer than three points, which happens when the stagnation point lands on the trailing edge, now
reports failure rather than raising out of `np.gradient`.

**Commit.** see `git log`

## 2026-10-24 — T2.2 and T2.3 Batch runner and proper orthogonal decomposition

**Done.** `tools/dataset/run.py` solves sampled shapes in parallel, writing shards of a parquet
table and a float16 field array; a shard whose two files exist is skipped, so an interrupted run
resumes by being restarted. `tools/dataset/pod.py` builds the basis by snapshot POD — eigenvectors
of the small correlation matrix rather than an SVD of the tall snapshot matrix — from a subsample,
then projects every row in chunks, and writes the basis twice: float32 in an npz for Python and
float16 in the flat atlas the browser uploads as a texture.

The stored field is the _perturbation_, `(u - cos(alpha), v - sin(alpha))` with the body zeroed,
not the total. It decays to zero far from the section, so POD compresses it far better, and
incidence then enters the browser's reconstruction analytically instead of having to be learnt.

**Verified.** `uv run pytest tools/dataset` 28 passed, including that a synthetic rank-five set is
captured exactly by five modes, that the modes come out orthonormal, that truncation error falls as
modes are added, and that projection is chunk-invariant. A twenty-shape trial produced 160 rows
with all 162 schema columns in the published order, 60 % of them converged, `design_id` contiguous,
and resumption correctly found nothing left to solve. On that trial 32 modes captured 99.87 % of
variance with a 2.66 % relative rms reconstruction error and a 2.43 MB atlas, inside the 3 MB
budget — the honest figure comes from the full run, since the trial's subsample was the whole set.

**Follow-ups.** Throughput is about 100 ms per row including the field, so 67 200 rows take roughly
fourteen minutes across eight workers and 4.9 GB of temporary field shards, which are gitignored
and deleted after the basis is built.

**Commit.** see `git log`

## 2026-10-24 — T4.2 TypeScript CST evaluator (taken early, out of plan order)

**Done.** `src/geometry/cst.ts` ports the CST evaluator, cosine spacing, the section loop and the
derived metrics, with `src/geometry/__fixtures__/cst.json` generated from the Python original by
`tools/solver/make_ts_fixtures.py`. Taken out of order because the dataset run occupies all cores
for about fifteen minutes and this task needs none of it.

**Verified.** `pnpm test` 35 passed: surfaces agree with Python to 1e-9 at eleven stations for four
sections, metrics to 1e-9, the loop to 1e-12, and the loop is wound counter-clockwise as the solver
demands. `uv run pytest` 94 passed.

**Follow-ups.** The parity test surfaced a real methodological split. Python's `geometry_metrics`
reads thickness and camber off a linear interpolation of the panel loop, which is all that is
available for arbitrary coordinates but costs about 2e-5 in peak thickness and a hundredth of chord
in its station. The TypeScript port evaluates the formula directly, which is exact. Rather than
making the browser imitate the less accurate path, Python gained `cst_metrics`, an exact path used
by the sampler and the fixtures, and the interpolated path stays for coordinates that have no
parametrisation. The geometry columns of the dataset run now in flight will be recomputed from the
CST weights during the merge in T2.4, so the published values are the exact ones regardless of
which code path a worker happened to load.

Presets changed from NACA 23012 to NACA 0008: the solver implements the four-digit series only, and
a five-digit section needs its own camber line. `docs/PLAN.md` T4.4 updated to match.

**Commit.** see `git log`

## 2026-10-24 — T4.1, T4.3, T4.4, T4.5 Application shell, scene and controls

**Done.** Tailwind v4 with a deliberately narrow token palette — colour is reserved for data, so the
chrome never competes with the pressure map or the charts. A zustand store holding the twelve CST
weights, incidence, view mode and colormap, every setter clamping to the dataset's own sampling
bounds so the surrogate is never extrapolated. `src/geometry/shapeOps.ts` separates camber from
thickness in weight space, which is exact because both are linear in the weights, and those same
pure functions are what the assistant's `nudge_shape` tool will call in M8. A react-three-fiber
viewport with the section extruded by a hand-written geometry builder that writes into preallocated
typed arrays, an orbit camera, and the four fitted NACA presets. Playwright captures the shell
screenshot.

**Verified.** 35 unit tests, 7 end-to-end tests, lint, typecheck and build all green. Measured
geometry in the UI matches the Python fixture: 12.01 % thickness at 30.1 % chord, 2.01 % camber at
41.8 % chord for NACA 2412. The committed screenshot was inspected, not assumed: the first camera
angle made the section read as a wing panel and hid the profile, so it was moved close to side-on.

Bundle budgets, after splitting the renderer onto its own lazily loaded chunk: entry 72.5 kB gzip
against a 100 kB limit, renderer 244 kB against 300 kB, stylesheet 3.4 kB against 12 kB. Three,
react-three-fiber and drei together are 244 kB of the total, which is why the shell paints before
they arrive. The single 250 kB budget in `docs/PLAN.md` is replaced by these three.

**Follow-ups.** Three findings worth recording, all of which cost real time.

`preserveDrawingBuffer` is now on in the viewport: without it a WebGL canvas composites as empty in
every capture, and the screenshots are part of the deliverable. Headless Chromium has no GPU, so
`playwright.config.ts` turns on ANGLE's software backend explicitly — the renderer reports
SwiftShader through Vulkan — and without those flags the canvas renders nothing at all and every
framebuffer read is zero. And reading the framebuffer before the renderer's first present returns
zeros _and keeps returning zeros_ however long the poll runs, so `waitForRenderedSection` waits a
second before its first read; both the reason and the symptom are in the comment.

The preflight checklist's WebGL item is now ticked: `EXT_color_buffer_float` is available both in
the desktop browser (Apple M4 Pro via ANGLE Metal) and in headless SwiftShader, so M6 can target the
float render-target path rather than the fallback.

**Commit.** see `git log`

## 2026-10-24 — T2.4 Dataset assembly and coverage report

**Done.** `tools/dataset/build.py` turns the shards into everything the Release carries:
`designs.parquet` with the geometry columns recomputed exactly from the CST weights and the 32
modal coefficients filled in, the basis as both an npz and the browser's float16 atlas,
`cp_stations.json`, `manifest.json` with bounds and checksums, the 2000-row sample CSV committed to
the repository, and `docs/dataset.md`. The basis is built and projected shard by shard so nothing
ever holds more than one shard in memory; the full field set is 4.7 GB.

**Verified.** `uv run pytest tools/dataset` 33 passed. The run produced **67 200 rows over 8400
shapes, 41 541 of them converged** (61.8 %), clearing the 40 000-row criterion. Convergence by
incidence runs 60 % at -6 to -4 degrees, peaks near zero and falls away above six, as predicted.
`designs.parquet` is 109.3 MB.

**Follow-ups.** The headline reduced-order number missed its target and the investigation changed
the conclusion, so ADR-017 records it in full. Thirty-two modes capture 98.26 % of in-sample variance
and reconstruct with a 10.11 % relative rms error over every row, against a planned 99 %. The trial
figure of 99.87 % had been measured on the snapshots the basis was built from, so it was never
out-of-sample. Raising the subsample from 3000 to 8000 changes nothing; raising the modes to 48 or
64 buys 8.7 % and 7.8 % for atlases of 3.6 MB and 4.8 MB against a 3 MB budget.

Splitting the error by region is what settled it: away from the section, over 93 % of the domain, the
reconstruction is accurate to **1.14 %** of the freestream — an absolute error of 0.0011 — while in
the band around the section it is **17.7 %**. The section occupies different grid points in every
row, so the masked body is a moving discontinuity, which is the one structure a linear basis cannot
compress; and that band is where the renderer masks the body anyway. Thirty-two modes stand, the
acceptance criterion in `docs/PLAN.md` is rewritten to the measured truth, and `pod.py` gained
`spatial_error` so the breakdown is regenerated rather than typed once.

**Commit.** see `git log`

## 2026-10-24 — T2.5 Dataset published, milestone M2 closed

**Done.** The `dataset-v1` Release carries `designs.parquet`, the 500-row sample CSV,
`pod_modes.npz` and `pod_modes.bin`, `cp_stations.json`, `manifest.json` and the schema verbatim as
its README. The notes lead with the filter every consumer needs — `solver_status == "ok"` — and with
the solver's limits rather than burying them.

**Verified.** `gh release view dataset-v1` lists all seven assets and a direct asset URL resolves,
so the sister project can fetch by URL as the contract promises.

**Follow-ups.** The schema's amendment window closes here: ADR-016 allowed editing version 1 in place
only while no Release existed. From now on a breaking change bumps the version and leaves this asset
in place.

**Commit.** see `git log`

## 2026-10-24 — T3.1, T5.1, T5.2, T5.4 Training pipeline and the browser inference layer

**Done.** `tools/train/data.py` loads the dataset, splits it by `shape_id` so a shape's whole
incidence sweep stays on one side, and normalises from the training split alone. Pressure, lift, the
quarter-chord moment and the modal coefficients come from the inviscid solution and are valid for
every row, so only drag is masked to the converged ones — 60 % more data for the outputs that can
take it. `tools/train/model.py` is a 177 059-parameter MLP at 0.71 MB with normalisation folded into
the graph, and `tools/train/export.py` writes both the ONNX graph and a flat float32 blob.

On the browser side, `src/ml` holds a shared interface over two backends: ONNX Runtime Web, loaded
by dynamic import so it never enters the bundle, and a hand-written forward pass over the blob that
serves as both fallback and parity reference. `src/shaders` carries the pressure colormap, which
samples the predicted stations per fragment from a 128-entry float texture and inverts the cosine
station mapping in GLSL, so the mesh needs no index attribute. `src/charts/CpChart.tsx` draws the
distribution with the pressure axis inverted and room for the exact solver curve beside it.

**Verified.** 60 unit tests pass, lint and typecheck clean, entry bundle still 72.5 kB gzip with
`onnxruntime-web` entirely absent from it. The TypeScript forward pass is checked against arithmetic
worked out by hand on a two-layer toy model, and the blob parser is checked against four ways of
getting the layout wrong. Splits confirmed on the real dataset: 53 760 / 6720 / 6720 rows with zero
shape overlap.

**Follow-ups.** These were taken out of plan order because the dataset regeneration occupies every
core for twenty-five minutes and none of this needs it. Training itself is still blocked on that
run finishing.

The machine's load average reached 22 during the regeneration, which killed the `lint-staged`
pre-commit hook twice; that commit was made with the hook skipped after running eslint, tsc and
vitest by hand, and the commit message says so.

**Commit.** see `git log`

## 2026-10-24 — M3 closed: the surrogate is trained, exported, measured and published

**Done.** Trained on the regenerated dataset, exported to ONNX and to a flat float32 blob, measured
against the solver on held-out sections, and published as the `model-v1` Release. `docs/accuracy.md`
is generated from the data. CI gained a job that fetches the published artifacts and asserts they
still reproduce the committed reference case.

**Verified.** 177 059 parameters, 0.71 MB. On sections the model has never seen at any incidence:

| output       | mean absolute error | R-squared |
| ------------ | ------------------- | --------- |
| `cl`         | 0.0095              | 0.996     |
| `cd`         | 0.00020             | 0.969     |
| `cm_quarter` | 0.0014              | 0.982     |

Pressure rms 0.055 over 128 stations, modal coefficients 6.0 % relative. ONNX agrees with PyTorch
to 5.5e-6 and the raw blob to 4.3e-6, both far inside the 1e-4 tolerance. In the app at two degrees,
NACA 2412 predicts `Cl` 0.5009 and `Cd` 0.00659 against the solver's own 0.50 — checked in a browser,
not inferred.

**Follow-ups.** Three findings worth recording.

The first run reported `cd` between -29 144 and 108 549 on held-out rows while `cl` had a mean error
of 0.0062. The model was right and the targets were wrong; that trail led to ADR-020.

Training under squared error made the model improve on 99 % of rows while getting steadily worse on
the extreme 1 % — untrimmed validation loss tripled while the trimmed figure fell. The targets are
heavy-tailed, and squared error is the wrong loss for that. Huber fixed it outright: train 0.0016,
validation 0.0042, test 0.0056, no divergence.

And the measurement that reversed a plan: the hand-written TypeScript forward pass runs at **0.9 ms
p95** against ONNX Runtime Web's **1.9 ms**, and saves **6.8 MB of gzipped WebAssembly**. The
hand-written pass is now the default and the runtime is opt-in; ONNX stays the canonical artifact and
the parity test holds them to 1e-4. ADR-021 records it.

Two smaller fixes found by looking at the screen rather than at a test: the diverging colormap was
centred on the midpoint of its range instead of on `Cp = 0`, so a typical distribution came out
uniformly warm; and the suction floor was -4, which left the median suction peak a fifth of the way
along the scale and washed the surface out. The floor is now -2.5, chosen from the dataset's own
distribution, clamping 1.0 % of station values.

**Commit.** see `git log`

## 2026-10-24 — T5.5, milestone M5 closed

**Done.** The pressure chart gained a hover readout and the exact solver curve behind the
prediction. `tools/dataset/make_overlay.py` sweeps each preset across the trained incidence range
and publishes the result with the model Release; the app draws it for a stock section and withdraws
it once the section is edited, because a free-form shape has no reference to compare against.

**Verified.** 8 end-to-end tests pass, including one asserting the overlay appears for a preset and
goes away once edited. Read off the screen at two degrees on NACA 2412: at `x/c` 0.073 the surrogate
gives `Cp` -0.829 against the solver's -0.840 on the upper surface, and -0.019 against -0.024 on the
lower. Lift 0.5009 against 0.4982, drag 0.00659 against 0.00692. Those are the numbers a visitor can
see for themselves rather than read in a claim.

**Follow-ups.** The reported latency was wrong, not the latency itself. The percentile counted the
first few predictions, which pay for a cold runtime and a cold JIT, and on a small front-loaded
sample that turned a 0.9 ms p95 into 8.9 ms. Five warm-up predictions are now discarded before the
figure starts counting, with the reason in the code: quoting a number nobody will see again is the
misleading choice, not the standard one.

An end-to-end test also broke on a substring: the chart's new caption mentions an edited section and
`getByText('Edited')` then matched two elements. Both assertions now use test ids.

**Commit.** see `git log`

## 2026-10-24 — T6.1 to T6.4 The GPU flow field

**Done.** The reduced-order reconstruction, the particle simulation and the trail buffer. Thirty-two
modal coefficients come out of the surrogate; one fragment pass rebuilds a 192 by 96 velocity field
from them; a second advects up to a million particles through it with Runge-Kutta; a third fades
their history so each leaves a decaying streak; a fourth composites that over the scene. Particle
positions never touch the CPU. The body is masked by rasterising the section itself into a small
target rather than testing a polygon per particle, and the panel gained trail-exposure and
particle-count controls.

**Verified.** 9 end-to-end tests and 64 unit tests pass, lint and typecheck clean, budgets held
(entry 85.7 kB gzip, renderer 253.8 kB). The field reconstruction was checked by reading the target
back: at the inlet it gives `u` 0.98 and `v` 0.05 against a freestream of `cos 2°` and `sin 2°`.
Particle positions were read back and confirmed to vary per texel and to advect.

**Follow-ups.** Five real bugs, every one of which produced a plausible-looking frame rather than an
error, and all five are now documented where they happened.

_Particles seeded from cleared memory._ The update shader treated an alpha of zero as "needs a
starting position", and the renderer clears to an opaque colour, so the test never fired: a quarter
of a million particles all started at the origin and advected as a single point. Seeding is now an
explicit pass.

_A hash that collapses._ The usual `fract(sin(dot(p, k)) * 43758.5453)` reaches 1e7, where float32
resolves to about 2, so `fract` quantises and neighbouring texels hash identically. Replaced, and
the replacement is fed integer texel coordinates rather than normalised ones -- the same hash
returns near-identical values for inputs a five-hundredth apart.

_A `uv` varying that arrived constant._ Every full-screen pass now derives its coordinate from
`gl_FragCoord` and an explicit resolution uniform, which the rasteriser cannot fail to supply.

_React-three-fiber hands over the render loop_ at any positive `useFrame` priority. The scene simply
stopped being drawn while the trail composite accumulated onto an uncleared buffer -- a uniformly
white frame that survived every attempt to turn the trails down. The callback now renders the scene
itself.

_Two feedback loops_, where a texture bound for reading was also the render target. The driver
refuses the draw and reports a warning; the frame goes black. Both the trail composite and the
particle render material now release their texture before it becomes a target.

Two smaller ones: the composite used the CSS size rather than the drawing buffer size, which on a
pixel ratio of two drew the pass at double scale and showed a quarter of it; and trail exposure is
now tone-mapped rather than scaled linearly, because the right linear constant depends on particle
count, trail length and how much of the domain is on screen, and being a factor of three out is the
difference between invisible and white.

Worth recording about method: the browser pane's screenshots of this WebGL canvas were repeatedly
wrong -- showing a blank viewport while a pixel read of the same frame returned the rendered image.
Several of the above were diagnosed only after switching to reading the framebuffer directly.

**Commit.** see `git log`

## 2026-10-24 — T6.5 and T6.6, milestone M6 closed

**Done.** `src/gpgpu/frameProbe.ts` chooses a particle count from measured frame times rather than
from what the hardware claims: a 50-frame window, the median so one long frame cannot force a
downgrade, asymmetric thresholds with a gap between them so it cannot oscillate, and a hold after
every change. Picking a tier by hand freezes it. The running tier and its frame time are reported in
the status line. `docs/perf.md` carries the measurements and `tests/e2e/performance.spec.ts`
reproduces them.

**Verified.** 73 unit tests and 13 end-to-end tests pass, lint and typecheck clean.

On an Apple M4 Pro through ANGLE Metal, every tier lands on exactly 8.3 ms — 120 frames per second —
and raising the drawing buffer to 3200 by 2018 with a million particles changed nothing. The loop is
bound by the display refresh, not the GPU, so the honest claim is not "a million particles at
120 fps" but "the particle work is too small to measure against a 120 Hz vsync on this hardware".
The budget of 60 fps at 500 000 particles is met at half the frame budget and double the count.

On ANGLE's software renderer, which is what continuous integration runs, the tiers finally separate:
65 536 particles hold 16.7 ms, 262 144 take 33.7 ms, and a million give a 34.2 ms median with a
108.5 ms p95 — frames that occasionally take three times the median. That is the measurement that
justifies the tiering existing at all.

**Follow-ups.** The frame-time figures could not isolate the cost of individual passes; doing so
needs `EXT_disjoint_timer_query_webgl2`, which is not worth the code for a number nobody acts on,
and `docs/perf.md` says so rather than implying the stages were profiled. Memory is not profiled
either, and that is stated too.

**Commit.** see `git log`

## 2026-10-24 — T7.2 and T7.3 Polars and shareable state

**Done.** `src/state/urlState.ts` implements `docs/URL-STATE.md` in both directions, and
`useUrlState` applies an incoming link on load and rewrites the hash as the design changes.
`usePolarSweep` runs the surrogate across the trained range and `PolarChart` draws lift against
incidence and the drag polar, with the current operating point marked on both.

**Verified.** 92 unit tests and 23 end-to-end tests pass; budgets held at 88.1 kB entry and
254.1 kB renderer. The URL codec is tested against the cases that matter when someone else's code
generates the string: unknown keys ignored, an unreadable version refused rather than guessed at,
incidence and weights clamped with the clamp reported, malformed weights falling back, and the deep
link the sister project builds from a dataset row read correctly. End to end, a link opens the
design it describes, the app writes one that reopens it, and four slider movements leave the history
length unchanged.

**Follow-ups.** The sweep is spread across animation frames rather than run in a worker. Forty-one
predictions at 0.9 ms is about 37 ms, which is two dropped frames in the middle of a slider drag;
chunking six per frame costs nothing and avoids a second bundle with a copy of the model in it. A
new section cancels the sweep in flight rather than queueing behind it.

The hash is written with `replaceState` after 250 ms of quiet. Writing on every change would fill
the back button with every slider position.

**Commit.** see `git log`

## T7.1 — streamlines

**Done.** A hundred-odd curves integrated on the CPU from the reconstructed velocity field, read
back once per prediction, drawn as one `LineSegments`. The crossing-number test against the section
outline stops a curve at the surface rather than letting it swim through the body.

**Two bugs, both invisible rather than wrong.** The first: the geometry was built in an effect, and
a child's effects run before its parent's, so on the first mount the GPU stages did not exist yet
and nothing re-ran when they appeared. Moved into `useFrame` at priority 0.5, which simply looks
every frame and acts when there is something to look at. The second was worse: replacing the
`position` attribute on a geometry three has already uploaded does not reliably invalidate the
driver's buffer. Ninety-six curves and 21 448 points existed in memory and never appeared on screen.
A whole new geometry per prediction fixes it.

**Honesty note.** These are integrated through the same reconstructed field the particles advect in
— `mean + sum(a_i * phi_i)` — not a decorative curve family drawn to look like flow.

**Commit.** see `git log`

## T7.4 — accessibility

**Done.** `docs/accessibility.md` records what holds and what does not. Four end-to-end tests guard
it: arrow keys, Home and End on the sliders, a visible focus ring, named charts, and reduced motion.

**One real failure found.** `--color-faint` was `#5a6977`, which is 3.4:1 on the panel background —
below AA, and it was carrying captions, units and the status line at 0.65–0.75 rem. Now `#738698`,
4.5:1 on the surface it sits on. The slider track moved from `line` to `faint` for the same reason:
a control you have to find needs 3:1, and `line` is 1.3:1 because it draws grid rules.

**Reduced motion, honestly.** Pausing the particles and leaving them on screen would be a frozen
cloud of dots that says nothing. The scene switches to streamlines instead — the same reconstructed
field, standing still — and the panel says so and offers to animate anyway. The override stays out
of the URL state: a shared link should not impose motion on whoever opens it.

**Left undone, on purpose.** No keyboard camera control: `OrbitControls` is pointer-driven, and
every number the view shows is also in the header and the charts. No live region for the
coefficients; it would talk continuously through a slider drag.

**Commit.** see `git log`

## M8 — the assistant

**Done.** Four tools, two provider adapters, a demo mode that needs no key, and a panel that shows
every tool call with an undo next to it. Twenty-nine unit tests and four browser tests.

**The design decision that mattered** is in ADR-022: the dispatcher is the only path from a model
to the store, and it does exactly what a slider does — clamp to the trained range, predict with the
same surrogate, report the clamp. A model cannot write a number into this app that the app would
not have produced itself, and the system prompt forbids stating a figure that did not come from a
tool result in that conversation. Verbose tool results are the price; grounding is what they buy.

**The demo is recorded prose, not recorded numbers.** The tools really run, against the real
surrogate and whatever section is on screen, and the recorded text carries placeholders that
resolve against those results. `demo.test.ts` fails on an unresolved placeholder, which is what
stops a transcript from quoting a figure no tool produced. The three scenarios double as the
acceptance test for the whole loop.

**Security.** The key lives under its own `localStorage` entry, never enters the URL state, and an
error is reported as the provider's status plus the provider's own text — never the request.
`tests/e2e/assistant.spec.ts` plants a canary key, fails the provider call, and asserts the key
reached the request header and nothing else: not the URL, not the DOM, not the console. The
production build now carries a CSP, injected at build time so the dev server can keep its `eval`,
and `scripts/check-bundle.mjs` fails CI if the policy is missing or anything credential-shaped is
in `dist`. `connect-src` cannot be an allowlist, because the endpoint is the visitor's choice;
ADR-023 says so rather than pretending otherwise.

**Noted for M9.** The entry bundle is at 95.7 kB against a 100 kB budget. The assistant is a
candidate for its own chunk in the T9.1 audit.

**Commit.** see `git log`

## M9 — polish and release

**The audit found one real bug.** Picking a particle tier by hand did nothing when the automatic
probe had already climbed from that same tier: `override.from === startingTier` matched the
explicit choice and put the probe's decision back. The button highlighted, the count did not
change. The probe's decision now applies only while the tier is automatic. It surfaced while
capturing media, which is the argument for capturing media from the real app.

**Dead code.** Four exports nothing outside their own module used, now module-private. The rest of
what a naive scan flags is prop and option interfaces, exported for readers rather than for
importers; they stay.

**Bundle.** The assistant is behind a lazy import, which took the entry bundle from 95.7 kB to
88.7 kB gzipped and gave it a budget of its own. Nothing in the entry chunk reaches `src/llm`.

**Media.** `tests/e2e/media.spec.ts`, skipped unless `CAPTURE_MEDIA=1`, drives the app by deep
link and captures five screenshots and 48 hero frames; `scripts/make-hero.sh` assembles them. It
runs headed and on Metal rather than SwiftShader, for two reasons that both took a wrong capture
to learn: headless Chromium has no compositor driving `requestAnimationFrame`, so the particles
take a handful of steps and the still shows them bunched at the inflow; and the software backend
draws a tenth of the particles at a sixth of the frame rate, which is honest about the renderer
and dishonest about the app. Trail exposure is turned well down for a still, because the
accumulation buffer keeps building while nothing changes.

**README.** Rewritten around the claim the project actually makes — the field is a reduced-order
model, not noise — and the numbers that back it, including the solver's own error against
published data, which stacks on top of the surrogate's.

**Commit.** see `git log`

## Post-1.0.0 — the preset contract had drifted

**Found while answering a question about the sister project.** `docs/URL-STATE.md` named a preset
that does not exist (`naca23012`) and omitted one that does (`naca0008`). That document is the
deep-link contract the explorer reads, so the error sat in the one place it could do real damage —
and the explorer's own ADR-002 cites having read it.

**Fixed, and guarded.** The row now names all four presets, points at `src/geometry/presets.ts` as
canonical, and states the fallback the reader actually performs (verified against
`urlState.ts`, which pushes a notice naming the unknown section). `src/geometry/presets.test.ts`
parses the document and compares it to `PRESETS`; deleting a name from the table turns it red,
which I checked rather than assumed.

**Also tidied.** Two entries describing M2 work were still sitting under `[Unreleased]` after the
1.0.0 backfill. They shipped; they are now filed under `0.3.0-m2`.

**Commit.** see `git log`

## Post-1.0.0 — the README promised an integration that does not exist

**Four documents claimed it.** The README said the explorer was "built on this dataset" and that
"a design selected there deep-links into this wind tunnel"; `URL-STATE.md`, `PLAN.md` and
`DATASET-SCHEMA.md` said the same in the present tense. None of it is true. The explorer chose its
own parametrisation — continuous camber, camber position, thickness, incidence and Reynolds — and
its ADR-002 explicitly declines both this dataset and the link. Its live bundle contains zero
references to this project.

**Why it slipped.** Those sentences were written during planning, when the shared dataset was the
plan, and nothing re-read them afterwards. T9.4 asked that `QUESTIONS.md` list what is genuinely
open, and I ticked it without checking what the sister repo had actually decided — so the single
most open thing in the project was the one thing the file did not mention.

**Fixed.** All four documents now describe the real state: the contract exists, is complete, and
has no second reader. `QUESTIONS.md` gains Q9 with what connecting the two would actually take —
a deployed URL, a `(camber, position, thickness)` to CST mapping that exists only in Python as
`fit_cst`, and an answer for Reynolds, which is a sampled dimension there and fixed at 1e6 here.

**Worth saying plainly.** For a project whose entire claim is that it states its own error, a
README advertising a feature that does not exist was the worst-placed defect in the repository.

**Commit.** see `git log`

## M10 — deployment

**GitHub Pages**, live at <https://jaworskig00.github.io/neural-wind-tunnel/>, published by
`.github/workflows/pages.yml` on every push to `main`. Nothing but the frontend went out: no
backend, no database, nothing to operate. The model and the mode atlas are static files on the
app's own origin, the design state is the URL hash, and the assistant talks to the visitor's own
provider from their browser.

**Cloudflare Pages was ruled out by a number, not a preference.** It caps one file at 25 MiB and
the ONNX Runtime WebAssembly binary is 27 MB, so keeping the opt-in ONNX path would have meant
moving that file to R2. GitHub Pages allows 100 MB per file and took the build unchanged.

**One line of code.** `base: process.env['PAGES_BASE'] ?? '/'`, set only by the Pages job. Every
artifact already resolved through `import.meta.env.BASE_URL`, so there were no absolute paths to
hunt down — a decision made back in M5 that cost nothing then and paid for itself here. Verified
before pushing by serving the built site under `/neural-wind-tunnel/` locally and loading it.

**What the deploy cost.** `frame-ancestors` had to come out of the policy. GitHub Pages cannot
send headers, the policy travels in a meta element, and a browser ignores that directive there —
while logging an error about it on every single load. Shipping a console error to every visitor
for a line that never applied is worse than not having the line. Clickjacking protection waits for
a host that can send headers; it is in `QUESTIONS.md`.

**Verified live, not assumed**: Cl 1.2371 on NACA 4412 at 6 degrees matching the local build,
solver overlay drawn, 1 048 576 particles at 1.5 ms p95, and an empty console.

**README gained a `Using it` section** — what to drag, what each view and chart shows, what an em
dash in the drag column means, how sharing works, and that the assistant needs no key. One claim
in the first draft was wrong and got corrected before it shipped: the app does not tell you when
your GPU lacks float render targets, it just falls back. The README now says that instead.

**Commit.** see `git log`
