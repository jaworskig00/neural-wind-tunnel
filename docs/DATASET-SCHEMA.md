# Dataset schema — contract version 1

This document is a **contract**, not documentation of an implementation detail. The sister
project [design-space-explorer](https://github.com/jaworskig00/design-space-explorer) consumes
this dataset and is built in parallel, so any change here bumps the contract version, lands in
`CHANGELOG.md`, and leaves the previous Release asset untouched.

Until this project's M2 lands, a consumer can generate schema-conformant placeholder data with
`uv run python tools/stub_dataset.py --rows 5000 --out data/sample/stub.csv`. Switching to the
real dataset is then a URL change and nothing else.

## 1. Physical conventions

| Quantity             | Convention                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Length               | Non-dimensional, chord `c = 1`. Leading edge at `x = 0`, trailing edge at `x = 1`.                    |
| Velocity             | Non-dimensional, freestream `U_inf = 1`, flowing in the `+x` direction.                               |
| Angle of attack      | Degrees, positive nose-up, applied to the freestream rather than rotating the geometry.               |
| Pressure coefficient | `Cp = 1 - (V/U_inf)^2`. Negative on suction surfaces. Plotted with an inverted axis by convention.    |
| Moment               | `cm_quarter` about `x/c = 0.25`, positive nose-up.                                                    |
| Reynolds number      | Fixed at `1e6` in dataset version 1 (see ADR-009).                                                    |
| Mach number          | `0`, incompressible. The column exists so a compressible dataset can be added without a schema break. |
| Trailing edge        | Sharp, zero thickness.                                                                                |

## 2. Shape parametrisation

Kulfan Class-Shape Transformation (CST), one curve per surface:

```
z(psi) = C(psi) * S(psi) + psi * dz_te
C(psi) = psi^N1 * (1 - psi)^N2        with N1 = 0.5, N2 = 1.0
S(psi) = sum_{i=0}^{5} A_i * B_{i,5}(psi)
B_{i,n}(psi) = binomial(n, i) * psi^i * (1 - psi)^(n - i)
psi = x / c  in  [0, 1]
dz_te = 0
```

Six Bernstein weights per surface, so twelve shape parameters in total. `cst_u_*` describes the
upper surface and `cst_l_*` the lower surface; a positive `cst_l_*` means the lower surface
bulges upward, which is how cambered sections are represented.

### Sampling bounds

Initial Sobol bounds. The bounds actually used are written into `manifest.json` at generation
time, and that file is authoritative for a given dataset version.

| Parameter             | Lower | Upper |
| --------------------- | ----- | ----- |
| `cst_u_0`             | 0.08  | 0.30  |
| `cst_u_1` … `cst_u_4` | 0.00  | 0.40  |
| `cst_u_5`             | 0.00  | 0.30  |
| `cst_l_0`             | -0.30 | -0.05 |
| `cst_l_1` … `cst_l_4` | -0.40 | 0.15  |
| `cst_l_5`             | -0.25 | 0.20  |
| `alpha_deg`           | -6.0  | 14.0  |

Coverage is not uniform across this range. The reference solver is an uncoupled integral method
with no separated-flow model, so the viscous march stops converging somewhere between six and
eight degrees depending on camber; those rows are published with `solver_status =
"bl_not_converged"` and must be filtered out. Expect the density of valid rows to thin above
roughly six degrees and to be sparse near the upper bound. See `solver-validation.md` and
ADR-015.

Validity filters applied after sampling and before solving: maximum thickness between 6 % and
20 % of chord, no crossing of the two surfaces anywhere in `(0, 1)`, leading-edge radius between
0.2 % and 5 % of chord, enclosed area positive. Rejected samples are not stored; the rejection
rate is reported in `docs/dataset.md`.

## 3. Surface station grid

Cp is reported at 128 fixed stations, 64 per surface, cosine-clustered toward the leading and
trailing edges:

```
psi_j = 0.5 * (1 - cos(pi * j / 63))      for j = 0 .. 63
```

| Column range        | Surface | Direction                     |
| ------------------- | ------- | ----------------------------- |
| `cp_000` … `cp_063` | upper   | leading edge to trailing edge |
| `cp_064` … `cp_127` | lower   | leading edge to trailing edge |

The same values are published as `cp_stations.json` so a consumer never has to recompute them.

## 4. Velocity field grid and POD

The solver samples the induced velocity field on a fixed uniform grid:

| Property               | Value                                   |
| ---------------------- | --------------------------------------- |
| Resolution             | 192 in `x`, 96 in `y`                   |
| `x/c` range            | -1.0 to 2.0 inclusive                   |
| `y/c` range            | -0.75 to 0.75 inclusive                 |
| Components             | `u`, `v`, non-dimensional               |
| Points inside the body | Masked, excluded from the decomposition |
| Row-major order        | `y` outer, `x` inner                    |

Proper orthogonal decomposition keeps the mean field plus 32 modes. Per-row modal coefficients
are stored as `pod_00` … `pod_31`. A consumer that only needs scalar performance data can ignore
these columns entirely.

## 5. Columns

`designs.parquet` and `designs-sample.csv` carry identical columns in this order.

### Identity

| Column      | Type  | Notes                                                                                                  |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `design_id` | int64 | Stable across regeneration for the same seed and bounds. Every alpha of one shape shares a `shape_id`. |
| `shape_id`  | int64 | Groups all angles of attack of the same geometry. Use this for train/test splits.                      |

### Inputs

| Column                | Type    | Notes                       |
| --------------------- | ------- | --------------------------- |
| `cst_u_0` … `cst_u_5` | float32 | Upper surface weights.      |
| `cst_l_0` … `cst_l_5` | float32 | Lower surface weights.      |
| `alpha_deg`           | float32 | Angle of attack in degrees. |
| `reynolds`            | float32 | `1e6` throughout version 1. |
| `mach`                | float32 | `0.0` throughout version 1. |

### Derived geometry

| Column            | Type    | Notes                                |
| ----------------- | ------- | ------------------------------------ |
| `thickness_max`   | float32 | Maximum thickness over chord.        |
| `thickness_max_x` | float32 | Station of maximum thickness, `x/c`. |
| `camber_max`      | float32 | Maximum camber over chord, signed.   |
| `camber_max_x`    | float32 | Station of maximum camber, `x/c`.    |
| `le_radius`       | float32 | Leading-edge radius over chord.      |
| `area`            | float32 | Enclosed area over chord squared.    |

### Outputs

| Column               | Type    | Notes                                                          |
| -------------------- | ------- | -------------------------------------------------------------- |
| `cl`                 | float32 | Lift coefficient.                                              |
| `cd`                 | float32 | Total profile drag coefficient, `cd_pressure + cd_friction`.   |
| `cd_pressure`        | float32 | Pressure component.                                            |
| `cd_friction`        | float32 | Friction component.                                            |
| `cm_quarter`         | float32 | Moment coefficient about quarter chord.                        |
| `cl_over_cd`         | float32 | Convenience column for the explorer's Pareto views.            |
| `x_transition_upper` | float32 | Transition station on the upper surface, `x/c`; `1.0` if none. |
| `x_transition_lower` | float32 | Transition station on the lower surface, `x/c`; `1.0` if none. |
| `cp_000` … `cp_127`  | float32 | Pressure coefficient at the stations in section 3.             |
| `pod_00` … `pod_31`  | float32 | Velocity-field modal coefficients.                             |

### Provenance

| Column           | Type   | Notes                                                                                                                                                                   |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solver_status`  | string | `ok`, `bl_not_converged` or `geometry_invalid`. **Only `ok` rows are valid for analysis or training.** Failures are kept so the failure rate is visible, never imputed. |
| `solver_version` | string | Semantic version of the solver that produced the row.                                                                                                                   |
| `panel_count`    | int16  | Number of panels used, 160 by default.                                                                                                                                  |

## 6. Release layout

Published as the GitHub Release `dataset-v1` on this repository.

| Asset              | Contents                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `designs.parquet`  | Every row, about 40 000 with `solver_status = ok`.                                                                          |
| `cp_stations.json` | The 128 station values and their surface tags.                                                                              |
| `pod_modes.npz`    | Mean field and 32 modes as float32, plus grid metadata.                                                                     |
| `pod_modes.bin`    | The same modes as an fp16 texture atlas for the browser, with a JSON sidecar describing the layout.                         |
| `manifest.json`    | Schema version, row counts, bounds actually sampled, solver version, generation date, SHA-256 of every asset, data licence. |
| `README.md`        | A standalone copy of this document.                                                                                         |

Committed in the repository, not in the Release: `data/sample/designs-sample.csv`, 2000 rows
with `solver_status = ok`, for tests and for consumers that do not want a 40 000-row download.

Stable URLs:

```
https://github.com/jaworskig00/neural-wind-tunnel/releases/download/dataset-v1/designs.parquet
https://raw.githubusercontent.com/jaworskig00/neural-wind-tunnel/main/data/sample/designs-sample.csv
```

## 7. Data licence

The dataset is published under CC BY 4.0. It is generated by this project's own solver, so no
third-party data licence applies. The solver's accuracy and its limits are documented in
`solver-validation.md`; anyone using the data for anything beyond visualisation should read it
first.

## 8. Notes for the design-space explorer

- Filter `solver_status == "ok"` before anything else.
- Good axes for parallel coordinates: `thickness_max`, `camber_max`, `thickness_max_x`,
  `alpha_deg`, `cl`, `cd`, `cl_over_cd`, `cm_quarter`.
- A sensible Pareto pair is maximise `cl`, minimise `cd`, filtered to one `alpha_deg` band at a
  time; across all angles the front is dominated by high-alpha rows and says little.
- The 128 `cp_*` columns reconstruct the surface pressure plot for a selected design, and the 12
  `cst_*` columns reconstruct its outline with the formula in section 2.
- To open a selected design in the wind tunnel, build the deep link described in
  [`URL-STATE.md`](URL-STATE.md).
