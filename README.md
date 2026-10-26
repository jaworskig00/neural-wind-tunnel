# Neural Wind Tunnel

[![CI](https://github.com/jaworskig00/neural-wind-tunnel/actions/workflows/ci.yml/badge.svg)](https://github.com/jaworskig00/neural-wind-tunnel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Shape an aerofoil in the browser and watch the flow answer. A neural surrogate, trained on a
panel-method solver that lives in this repository, predicts the surface pressure, the force
coefficients and a reduced-order representation of the velocity field in under a millisecond — on
every slider movement. The GPU reconstructs that field and advects a million particles through it.

![The wind tunnel, sweeping incidence from -4 to +8 degrees](docs/media/hero.gif)

**Live demo:** <https://jaworskig00.github.io/neural-wind-tunnel/> · **Accuracy:**
[`docs/accuracy.md`](docs/accuracy.md) · **Performance:** [`docs/perf.md`](docs/perf.md) ·
**Decisions:** [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Using it

Open the demo. Nothing to install, nothing to sign in to, and no key for anything.

**The first half minute.** Pick a section on the right — `NACA 2412` is a good start — and drag
**Incidence**. The header updates on every frame: lift, drag, quarter-chord moment and lift-to-drag
ratio. The flow redraws with them, because the surrogate re-predicts the whole field each time you
move, not just the forces.

**Changing the shape.** `Thinner` / `Thicker` scale the thickness distribution and `Less camber` /
`More camber` the camber line, independently — in CST weight space the two separate cleanly, so one
does not disturb the other. `CST weights` at the bottom opens the twelve raw Bernstein weights if
you want them. **Measured** reports what you actually made: maximum thickness and camber, where
they sit, and the nose radius. Every slider stops at the edge of the range the model was trained
on, so you cannot accidentally ask it to extrapolate.

**Choosing what to look at.** Under **Flow field**:

| Control                           | What it does                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `particles` `lines` `both` `none` | Advected particles, streamlines, both, or just the pressure on the surface   |
| `Trails`                          | How long the particles smear. Low is crisp, high is silky and slower to read |
| `auto` `low` `mid` `high`         | Particle count. `auto` probes your frame times and settles on its own        |

Drag in the viewport to orbit, scroll to zoom.

**Reading the charts.** The dock at the bottom right toggles between `pressure` and `polars`.

- **pressure** plots Cp against chord with the axis inverted, the way the suction side is normally
  drawn on top. On one of the four stock sections a grey curve appears behind the blue one: that is
  the exact solver for the same case, so you can see the surrogate's error rather than take it on
  trust. Edit the shape and the grey curve disappears, because no reference exists for a section
  nobody solved.
- **polars** sweeps the whole trained incidence range and draws lift against incidence and lift
  against drag. The amber dot is where you are. The left edge of the drag polar is the useful part
  of a design.

**When drag shows `—`.** The viscous calculation did not converge for that case, most often near
the top of the incidence range. The app would rather show nothing than a plausible number.

**Sharing.** The address bar is the state. Every change rewrites the hash, so copying the URL
copies the exact section, incidence, view and camera. Opening a link that asks for something
outside the trained range clamps it and says so in a banner rather than pretending.

**The assistant.** `Assistant` next to the title. It works with no API key: three recorded
conversations are built in, and their tool calls run for real against whatever section you have
open, so the numbers in the answers are yours and not a recording. Each tool call it makes is
listed by name with an `undo` beside it. To go beyond the recordings, open the provider menu in the
panel header and paste a key — Anthropic, or any OpenAI-compatible endpoint including one on your
own machine. The key stays in your browser's local storage and goes only to the provider you
picked.

**Keyboard.** Every control is a native element, so `Tab` moves between them and the arrow keys,
`Home` and `End` drive the sliders. There are no custom shortcuts to learn. The camera is the one
thing you cannot drive from the keyboard; everything it shows is also in the header and the charts.

**If it runs badly.** Pick `low` under the particle count, or `none` to turn the field off and keep
the surface pressure and the charts. On a GPU without 32-bit float render targets the field drops
to half precision by itself; if the mode atlas cannot be loaded at all, the flow simply does not
appear and everything else — the coefficients, the pressure plot, the polars, the assistant —
carries on. The status line at the bottom left always says which inference backend is running, the
measured p95 and how many particles are actually being drawn.

## The claim, and what backs it

The particles are not noise dressed up as flow. They follow a velocity field reconstructed as
`mean + Σ aᵢ·φᵢ` from coefficients the network predicted — a reduced-order model, which is what
production simulation tools use when a full solve is too slow to be interactive. The field comes
from the model or it does not appear at all; there is no procedural fallback anywhere in the
codebase.

That claim is only worth making if the error is stated, so it is, in numbers:

| What                                 | Against                                  | Measured                             |
| ------------------------------------ | ---------------------------------------- | ------------------------------------ |
| Surrogate lift coefficient           | This project's solver                    | 0.0095 mean absolute error, R² 0.996 |
| Surrogate drag coefficient           | This project's solver                    | 0.0002 mean absolute error, R² 0.969 |
| Surrogate pressure, all 128 stations | This project's solver                    | 0.055 rms                            |
| The solver's lift slope              | Thickness-corrected thin-aerofoil theory | Within 1.2 %                         |
| The solver's drag                    | Published NACA 0012 data                 | 3–10 % high                          |
| The solver's quarter-chord moment    | Published NACA 4412 data                 | Up to 19 % too nose-down             |

**The two stack.** A drag number on screen carries the surrogate's error on top of the solver's.
[`docs/accuracy.md`](docs/accuracy.md) breaks the first down per output and per incidence;
[`docs/solver-validation.md`](docs/solver-validation.md) does the same for the second, including
the cases where the integral boundary layer simply fails to converge and the app shows no drag at
all rather than a plausible one.

## What you can do with it

**Shape it.** Four NACA presets, two transforms that matter — thickness and camber, which are
separable in CST weight space — and, underneath, the twelve raw Bernstein weights. Every control
is bounded by the dataset's own sampling range, so the surrogate is never asked to extrapolate.

**Watch it.** A pressure colormap on the surface, a GPGPU particle field with trails, streamlines
integrated through the same field, and a pressure plot that overlays the exact solver wherever a
reference exists for the section on screen.

<p align="center">
  <img src="docs/screenshots/particles.png" width="49%" alt="Particles and the pressure colormap" />
  <img src="docs/screenshots/streamlines.png" width="49%" alt="Streamlines through the same reconstructed field" />
</p>

**Read it.** The pressure distribution with the axis inverted the way an aerodynamicist expects,
and the polars — lift against incidence, lift against drag — swept across the trained range off
the critical path while you keep dragging.

<p align="center">
  <img src="docs/screenshots/pressure.png" width="49%" alt="Pressure distribution against the exact solver" />
  <img src="docs/screenshots/polars.png" width="49%" alt="Lift and drag polars" />
</p>

**Ask it.** An optional assistant turns "make it fifteen per cent thinner and tell me what that
costs" into tool calls against the same surrogate, shows every call it made, and offers an undo
next to each one. It needs no API key to try: three recorded conversations ship with the app, and
their tool calls run for real against whatever section you have on screen.

![The assistant, with its tool calls and an undo](docs/screenshots/assistant.png)

**Share it.** The whole design lives in the URL. A link reopens the exact section, incidence,
view and camera — and says so if it had to clamp anything.

## How it works

```mermaid
flowchart LR
  subgraph offline["Offline · Python"]
    S["Panel method<br/>+ integral BL"] --> D["Sobol over CST<br/>8400 shapes x 8 alpha<br/>67 200 cases"]
    D --> P["POD<br/>32 modes"]
    D --> T["MLP 13 → 256³ → 163"]
    P --> T
    T --> A["ONNX + raw weights<br/>GitHub Releases"]
  end
  subgraph online["In the browser"]
    A --> I["Inference<br/>0.9 ms p95"]
    I -->|"Cp, Cl, Cd, Cm"| C["Charts + surface colormap"]
    I -->|"32 coefficients"| R["Field reconstruction<br/>fragment shader"]
    R --> G["Particle advection<br/>RK2, ping-pong FBO"]
    R --> L["Streamlines"]
    G --> V["Trails + composite"]
  end
```

### The solver

[`tools/solver`](tools/solver) is a linear-strength vortex panel method with the Kutta condition
for the inviscid part, and an integral boundary layer for the viscous part: Thwaites while laminar,
Michel's criterion for transition, Head's entrainment method when turbulent, Ludwieg-Tillmann for
skin friction and Squire-Young to carry the momentum thickness to infinity. It is a textbook
method, and it is validated against published data rather than against itself.

It also knows when it has failed. Three separate guards — a trailing-edge cutoff, a suction-peak
floor, a bound on momentum thickness — mark a case invalid instead of emitting a number, and the
dataset build asserts every published row is physically plausible before it writes a file. All
three exist because something non-physical reached the dataset and looked exactly like data;
ADR-018 through ADR-020 are the post-mortems.

### The surrogate

Thirteen inputs — twelve CST weights and the incidence — through three layers of 256 to 163
outputs: 128 pressure stations, three force and moment coefficients, and 32 modal coefficients.
About 0.7 MB in fp32, trained with a Huber loss because squared error optimised the comfortable
99 % of rows while the extreme one per cent got steadily worse.

It ships twice. ONNX Runtime Web is the recognisable answer and is available at the flip of a
query parameter; the default is a hand-written forward pass in TypeScript, because thirteen inputs
through three small layers is thirty microseconds of arithmetic and the runtime costs 109 kB of
WebAssembly to do the same thing slower. Both are tested for numerical parity. ADR-021 records the
measurement that reversed the original decision.

### The field

The velocity fields are not learned pixel by pixel — 192 × 96 × 2 outputs per case would be a far
larger network predicting something far smoother than itself. Proper orthogonal decomposition
reduces the whole dataset of fields to a mean plus 32 modes carrying 99 % of the energy, and the
network predicts only the coefficients. The browser reconstructs the field in one fragment-shader
pass over a texture atlas of the modes.

### The shaders

Hand-written GLSL on WebGL2, no post-processing library:

| Pass                 | Runs when              | What it does                                                  |
| -------------------- | ---------------------- | ------------------------------------------------------------- |
| Field reconstruction | The prediction changes | 33 texture fetches per texel into a float render target       |
| Body mask            | The shape changes      | The section into a mask the particles cannot enter            |
| Particle advection   | Every frame            | RK2 against ping-pong position textures, respawn at the inlet |
| Trail fade and draw  | Every frame            | Additive points into an accumulation buffer that decays       |
| Composite            | Every frame            | Tone-mapped over the scene, `1 - exp(-x·I)`                   |

A capability probe runs before the first frame and a frame-time probe adjusts afterwards, so the
particle count matches the hardware: 65k, 262k or 1 048 576. On an M4 Pro every tier is
vsync-bound at 8.4 ms, which is the honest way of saying the GPU work is too small to measure
against a 120 Hz refresh. [`docs/perf.md`](docs/perf.md) has the method and the numbers.

## Honest limits

The app says this on first load, not in a footnote.

- Two-dimensional, incompressible, Reynolds number fixed at one million.
- No stall, no separation modelling, no compressibility, no three-dimensional effects. The
  trained range stops at +10° for exactly this reason.
- Drag is the least reliable output and is missing where the viscous march did not converge —
  which is most often at the top of the incidence range.
- The reference solver is itself an approximation, and its own errors are documented.
- The assistant quotes only numbers that came from a tool call you can see. It is still a language
  model, and the aerodynamic reasoning around those numbers is its own.

## Accessibility

Every control is a native element and works from the keyboard; focus is visible; the charts carry
text alternatives; the palette is checked at AA against both surfaces it sits on. Reduced motion
is honoured by pausing the particles and drawing the field as streamlines instead — the same
field, standing still — with an override for anyone who wants it to move anyway.
[`docs/accessibility.md`](docs/accessibility.md) says what is covered and what is not.

## Running locally

```bash
pnpm install
pnpm models:sync   # fetches the published model and mode atlas from Releases
pnpm dev
```

No API key is needed for anything except the assistant's live mode, and the assistant works
without one. A key you paste is stored only in your browser's local storage and sent directly to
the provider you chose; this project has no server to send it to.

Regenerating the dataset and the model needs the Python toolchain. The full run is about
half an hour on twelve cores, and `--help` on each command explains the knobs:

```bash
uv sync
uv run python -m tools.dataset.run       # solve 8400 shapes at 8 incidences into parquet
uv run python -m tools.dataset.pod       # 32-mode POD basis
uv run python -m tools.dataset.build     # assemble, validate, publish
uv run python -m tools.train.train       # train
uv run python -m tools.train.export      # ONNX + raw weights + manifest
uv run python -m tools.train.accuracy    # regenerate docs/accuracy.md
```

Checks, all of which CI runs on every push:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm size && pnpm check:bundle
pnpm test:e2e
uv run ruff check . && uv run pytest
```

## Sister project

[**design-space-explorer**](https://jaworskig00.github.io/design-space-explorer/)
([source](https://github.com/jaworskig00/design-space-explorer)) — a D3 explorer for thousands of
design variants, built in parallel with this project.

The two were planned to share a dataset and a deep link, and neither happened. The explorer
generates its own sample from a different parametrisation — camber, camber position, thickness,
incidence and Reynolds number, sampled continuously — and its ADR-002 records the decision not to
consume this project's CST dataset. There is no button in it that opens a design here.

The contract for that link exists on this side and is unused:
[`docs/URL-STATE.md`](docs/URL-STATE.md) is a complete, versioned deep-link format, and
[`docs/DATASET-SCHEMA.md`](docs/DATASET-SCHEMA.md) describes the dataset. Connecting the two would
need two things that do not exist yet: a mapping from the explorer's
`(camber, position, thickness)` onto twelve CST weights -- which exists in Python as `fit_cst` and
has no TypeScript counterpart -- and an honest answer for Reynolds number, which is a sampled
dimension there and fixed at 1e6 here, so a linked row would quietly change meaning. The two
repositories share no code.

## Repository map

| Path             | Contents                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| `tools/solver/`  | Panel method, boundary layer, geometry, field evaluation                       |
| `tools/dataset/` | Sobol sampling, parallel solve, POD, build and validation                      |
| `tools/train/`   | Training, export, accuracy report, artifact check                              |
| `src/geometry/`  | CST parametrisation, presets, shape operations                                 |
| `src/ml/`        | Two backends behind one interface, plus the parity test                        |
| `src/rom/`       | Mode atlas, field reconstruction, streamline integration, capability detection |
| `src/gpgpu/`     | Ping-pong targets, particles, trails, body mask, frame probe                   |
| `src/shaders/`   | Hand-written GLSL                                                              |
| `src/llm/`       | Tool schemas, dispatcher, provider adapters, recorded demos                    |
| `docs/`          | Plan, decision records, data contracts, accuracy, performance, accessibility   |
| `data/sample/`   | A committed 2000-row slice of the dataset, so the tests need no download       |

## Licence

Code under [MIT](LICENSE). The generated dataset is published under CC BY 4.0.
