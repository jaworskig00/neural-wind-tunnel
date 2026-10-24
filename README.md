# Neural Wind Tunnel

[![CI](https://github.com/jaworskig00/neural-wind-tunnel/actions/workflows/ci.yml/badge.svg)](https://github.com/jaworskig00/neural-wind-tunnel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A wind tunnel in the browser. Shape a parametric airfoil, and a neural surrogate trained on an
in-repo panel-method solver predicts the surface pressure, the force coefficients and a
reduced-order representation of the velocity field — instantly, on every slider drag. The GPU
reconstructs that field and advects hundreds of thousands of particles through it.

> **Status: planning complete, implementation starting.** This README is a skeleton; the demo
> media, measured accuracy numbers and the live link land in milestone M9. The plan is public
> from day one: [`docs/PLAN.md`](docs/PLAN.md).

<!-- M9: hero GIF goes here -->

**Live demo:** _not deployed yet_ · **Plan:** [`docs/PLAN.md`](docs/PLAN.md) · **Decisions:** [`docs/DECISIONS.md`](docs/DECISIONS.md)

## What it does

- **Shape.** NACA 4-digit presets or free-form CST control of both surfaces, plus angle of attack.
- **Predict.** A small MLP, exported to ONNX and run in the browser, returns the pressure
  coefficient at 128 surface stations, lift, drag and moment, and 32 modal coefficients of the
  velocity field — in single-digit milliseconds.
- **Visualise.** Pressure colormap on the surface, a GPGPU particle flow field, streamlines, and
  live Cp and polar charts.
- **Ask.** An optional assistant turns plain language ("make it thinner, reduce drag at five
  degrees") into concrete parameter changes through tool calling, and explains the result. The
  app is fully functional without it.

## How the ML works

<!-- M9: expand with the measured numbers from docs/accuracy.md -->

A panel-method solver in [`tools/solver`](tools/solver) generates the ground truth: linear-strength
vortex panels with the Kutta condition for the inviscid solution, then an integral boundary layer
for transition and profile drag. Around 40 000 cases are sampled across the CST shape space with a
Sobol sequence.

The velocity fields are not learned pixel by pixel. Proper orthogonal decomposition reduces them
to a mean field plus 32 modes, and the network predicts the modal coefficients. The browser
reconstructs the field as `mean + sum(a_i * phi_i)` in a single fragment-shader pass. That is a
reduced-order model, the same technique production simulation tools use — so the particles follow
an approximation of a real solution rather than procedural noise.

Everything about the pipeline is reproducible: see [`docs/DATASET-SCHEMA.md`](docs/DATASET-SCHEMA.md).

## How the shaders work

<!-- M9: expand with the final pass list and the frame budget -->

- A reconstruction pass writes `u, v` into a float render target from the predicted coefficients
  and a mode texture atlas, only when the prediction changes.
- A GPGPU pass advects particles with RK2 against ping-pong position textures, respawning them at
  the inlet and masking the body with a signed distance field.
- Particles render as additive points coloured by local speed, with trails accumulated in a
  separate target and decayed per frame.
- A capability probe picks the particle count and precision tier before the first frame, so the
  demo runs on integrated graphics as well as a discrete GPU.

## Honest limits

This is a surrogate, not a solver, and the UI says so on first load.

- Two-dimensional, incompressible, fixed Reynolds number of one million.
- No separation modelling, no stall, no compressibility, no three-dimensional effects.
- Accurate only inside the trained range; outside it the app warns instead of extrapolating.
- The reference solver is itself an approximation — its validation against published NACA data,
  and what it gets wrong, is in `docs/solver-validation.md`.
- Measured surrogate error against the reference solver: `docs/accuracy.md`.

## Running locally

```bash
pnpm install
pnpm dev
```

No API key is needed. For the assistant, paste your own key in the app's settings; it is stored
only in your browser's `localStorage` and sent directly to the provider you choose.

Regenerating the data and the model requires the Python toolchain:

```bash
uv sync
uv run python -m tools.dataset.run --help
uv run python -m tools.train.train --help
```

## Sister project

[**design-space-explorer**](https://github.com/jaworskig00/design-space-explorer) — a D3 explorer
for thousands of design variants, built on the same dataset. A design selected there deep-links
into this wind tunnel; the shared contracts are
[`docs/DATASET-SCHEMA.md`](docs/DATASET-SCHEMA.md) and [`docs/URL-STATE.md`](docs/URL-STATE.md).

## Repository map

| Path           | Contents                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------- |
| `tools/`       | Python: solver, dataset pipeline, training and export                                        |
| `src/`         | TypeScript app: geometry, inference, reduced-order model, GPGPU, scene, shaders, charts, LLM |
| `docs/`        | Plan, decision records, data contracts, accuracy, performance, screenshots                   |
| `data/sample/` | A small committed sample of the dataset, for tests and consumers                             |

## Licence

Code under [MIT](LICENSE). The generated dataset is published under CC BY 4.0.
