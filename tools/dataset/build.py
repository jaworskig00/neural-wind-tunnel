"""Assemble the published dataset from the solved shards.

Takes the shards `tools.dataset.run` wrote and produces everything the Release carries:

* ``designs.parquet`` -- every row, with the geometry columns recomputed exactly from the CST
  weights and the 32 modal coefficients filled in.
* ``pod_modes.npz`` and ``pod_modes.bin`` -- the basis, for Python and for the browser.
* ``cp_stations.json`` -- the 128 station positions, so a consumer never recomputes them.
* ``manifest.json`` -- versions, counts, the bounds actually sampled, checksums.
* ``data/sample/designs-sample.csv`` -- 2000 converged rows, committed to the repository.
* ``docs/dataset.md`` -- the coverage report.

Run from the repository root::

    uv run python -m tools.dataset.build
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from tools.dataset.pod import (
    DEFAULT_MODE_COUNT,
    DEFAULT_SUBSAMPLE,
    compute_basis_streaming,
    project_streaming,
    save_basis,
    spatial_error,
)
from tools.dataset.run import DEFAULT_OUTPUT, SOLVER_VERSION, load_tables
from tools.dataset.sample import ALPHA_BOUNDS, LOWER_BOUNDS, UPPER_BOUNDS
from tools.solver.field import GRID_NX, GRID_NY, GRID_X_RANGE, GRID_Y_RANGE
from tools.solver.geometry import CST_ORDER, cst_metrics
from tools.solver.solve import cp_stations

SCHEMA_VERSION = 1
DATASET_VERSION = "dataset-v1"
DATA_LICENCE = "CC-BY-4.0"
#: Rows in the committed sample. 194 columns of full-precision floats make this file large fast:
#: 2000 rows is 7.6 MB, which has no business in a repository people clone to read the code.
#: 500 rows at six significant figures is 0.9 MB and still covers the design space well enough
#: for tests and for a consumer to develop against. ADR-012 keeps anything larger in Releases.
SAMPLE_ROWS = 500
SAMPLE_FLOAT_FORMAT = "%.6g"
SAMPLE_PATH = Path("data/sample/designs-sample.csv")
REPORT_PATH = Path("docs/dataset.md")

GEOMETRY_COLUMNS = (
    "thickness_max",
    "thickness_max_x",
    "camber_max",
    "camber_max_x",
    "le_radius",
    "area",
)


def recompute_geometry(frame: pd.DataFrame) -> pd.DataFrame:
    """Replace the geometry columns with the exact values from the CST formula.

    The sampler originally read them off an interpolation of the panel loop, which costs about
    2e-5 in peak thickness and a hundredth of chord in its station. Recomputing here means the
    published values match what the browser shows, since `src/geometry/cst.ts` evaluates the same
    formula; see ADR-013 and the T4.2 entry in `docs/PROGRESS.md`.
    """
    upper_columns = [f"cst_u_{i}" for i in range(CST_ORDER)]
    lower_columns = [f"cst_l_{i}" for i in range(CST_ORDER)]

    unique = frame.drop_duplicates("shape_id")[["shape_id", *upper_columns, *lower_columns]]
    recomputed = {}
    for row in unique.itertuples(index=False):
        values = np.asarray(row[1:], dtype=np.float64)
        metrics = cst_metrics(values[:CST_ORDER], values[CST_ORDER:])
        recomputed[int(row[0])] = (
            metrics.thickness_max,
            metrics.thickness_max_x,
            metrics.camber_max,
            metrics.camber_max_x,
            metrics.le_radius,
            metrics.area,
        )

    table = np.array([recomputed[int(shape_id)] for shape_id in frame["shape_id"]])
    for index, column in enumerate(GEOMETRY_COLUMNS):
        frame[column] = table[:, index]
    return frame


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def coverage_report(
    frame: pd.DataFrame,
    basis_energy: np.ndarray,
    error: dict[str, float],
    spatial: dict[str, float],
) -> str:
    """The contents of `docs/dataset.md`."""
    converged = frame[frame["solver_status"] == "ok"]
    status_counts = frame["solver_status"].value_counts()

    bins = np.arange(ALPHA_BOUNDS[0], ALPHA_BOUNDS[1] + 1e-9, 2.0)
    labels = [f"{low:+.0f} to {high:+.0f}" for low, high in itertools.pairwise(bins)]
    digitised = np.digitize(frame["alpha_deg"], bins) - 1
    alpha_rows = []
    for index, label in enumerate(labels):
        mask = digitised == index
        total = int(mask.sum())
        ok = int((mask & (frame["solver_status"] == "ok")).sum())
        share = 100.0 * ok / total if total else 0.0
        alpha_rows.append(f"| {label} | {total} | {ok} | {share:.0f} % |")

    thickness_bins = np.arange(0.06, 0.2001, 0.02)
    thickness_rows = []
    for low, high in itertools.pairwise(thickness_bins):
        mask = (converged["thickness_max"] >= low) & (converged["thickness_max"] < high)
        thickness_rows.append(f"| {low * 100:.0f} to {high * 100:.0f} % | {int(mask.sum())} |")

    def envelope(column: str, fmt: str) -> str:
        values = converged[column]
        low = f"{values.min():{fmt}}"
        mid = f"{values.median():{fmt}}"
        high = f"{values.max():{fmt}}"
        return f"| `{column}` | {low} | {mid} | {high} |"

    envelope_rows = "\n".join(
        [
            envelope("cl", "+.4f"),
            envelope("cd", ".5f"),
            envelope("cl_over_cd", "+.1f"),
            envelope("cm_quarter", "+.4f"),
        ]
    )
    converged_share = 100.0 * len(converged) / len(frame)
    shapes = int(frame["shape_id"].nunique())
    per_shape = len(frame) // max(shapes, 1)

    energy_rows = "\n".join(
        f"| {count} | {100 * basis_energy[count - 1]:.3f} % |" for count in (1, 2, 4, 8, 16, 32)
    )

    return f"""# Dataset coverage

Generated by `uv run python -m tools.dataset.run` and `uv run python -m tools.dataset.build`.
Schema and conventions: [`DATASET-SCHEMA.md`](DATASET-SCHEMA.md). Solver accuracy and its limits:
[`solver-validation.md`](solver-validation.md).

## Size

| | |
|---|---|
| Rows | {len(frame)} |
| Converged (`solver_status = "ok"`) | {len(converged)} ({converged_share:.1f} %) |
| Distinct shapes | {shapes} |
| Incidences per shape | {per_shape} |
| Solver version | {SOLVER_VERSION} |

Status breakdown: {", ".join(f"`{name}` {count}" for name, count in status_counts.items())}.

**Only `ok` rows are valid for analysis or training.** Failures are published rather than dropped so
the failure rate is visible; they carry `nan` for every drag column.

## Coverage by incidence

The solver is an uncoupled integral method with no separated-flow model, so convergence falls away
as the adverse gradient strengthens. This is the measured consequence, and it is why the surrogate
will be weakest at the edges of the range.

| `alpha_deg` | rows | converged | share |
|---|---|---|---|
{chr(10).join(alpha_rows)}

## Coverage by thickness

Converged rows only.

| maximum thickness | rows |
|---|---|
{chr(10).join(thickness_rows)}

## Performance envelope

Converged rows only.

| | minimum | median | maximum |
|---|---|---|---|
{envelope_rows}

## Reduced-order basis

Proper orthogonal decomposition of the velocity *perturbation* fields -- the total minus the
freestream, with the body zeroed. See ADR-007 and `tools/dataset/pod.py`.

| modes | variance captured |
|---|---|
{energy_rows}

Reconstruction against every row in the dataset, not just the subsample the basis was built from:
relative rms error **{100 * error["relative_rms"]:.2f} %**, worst single row
**{100 * error["worst_row_relative"]:.1f} %**.

That single figure is misleading on its own, so here is where the error actually sits. The section
covers a different set of grid points in every row, which makes the masked body a moving
discontinuity -- exactly the structure a linear basis cannot compress. Split by region, over
{int(spatial["rows"])} rows:

"Near the section" means `-0.08 < x/c < 1.08` and `abs(y/c) < 0.14`.

| region | grid points | relative rms error |
|---|---|---|
| Everywhere | {GRID_NX * GRID_NY} | {100 * spatial["overall"]:.2f} % |
| Near the section | {int(spatial["near_body_points"])} | {100 * spatial["near_body"]:.1f} % |
| Away from the section | {int(spatial["away_points"])} | {100 * spatial["away_from_body"]:.2f} % |

Over the {100 * spatial["away_points"] / (GRID_NX * GRID_NY):.0f} % of the domain the particles and
streamlines actually traverse, the reconstruction is accurate to about one per cent of the
freestream -- an absolute velocity error of {spatial["away_absolute_rms"]:.4f}. Close to the surface
it is far worse, and that is where the renderer masks the body with a signed distance field anyway.
Raising the mode count does not fix this: 48 modes give 8.7 % overall and 64 give 7.8 %, for an
atlas of 3.6 MB and 4.8 MB against 2.4 MB. ADR-017 records the decision to keep 32.

Grid: {GRID_NX} by {GRID_NY} points over `x/c` {GRID_X_RANGE[0]} to {GRID_X_RANGE[1]} and `y/c`
{GRID_Y_RANGE[0]} to {GRID_Y_RANGE[1]}.

## Reproducing it

```bash
uv run python -m tools.dataset.run --shapes {shapes}
uv run python -m tools.dataset.build
```

The run is resumable: a shard whose two files already exist is skipped, so an interrupted run
continues by being started again. Expect roughly {len(frame) // 60} seconds of solving per core.
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--modes", type=int, default=DEFAULT_MODE_COUNT)
    parser.add_argument("--subsample", type=int, default=DEFAULT_SUBSAMPLE)
    args = parser.parse_args()

    print("loading shard tables", flush=True)
    frame = load_tables(args.output)
    frame = recompute_geometry(frame)
    print(f"  {len(frame)} rows, {frame['shape_id'].nunique()} shapes", flush=True)

    field_paths = sorted((args.output / "shards").glob("shard_*.f16.npy"))
    print(f"building the basis from {len(field_paths)} field shards", flush=True)
    basis = compute_basis_streaming(field_paths, mode_count=args.modes, subsample=args.subsample)
    for count in (1, 4, 8, 16, args.modes):
        print(
            f"  {count:3d} modes capture {100 * basis.captured_energy[count - 1]:.3f} %", flush=True
        )

    print("projecting every row", flush=True)
    coefficients, error = project_streaming(field_paths, basis)
    if coefficients.shape[0] != len(frame):
        raise RuntimeError(
            f"{coefficients.shape[0]} coefficient rows against {len(frame)} table rows"
        )
    print(
        f"  relative rms {error['relative_rms']:.4f}, worst row {error['worst_row_relative']:.4f}",
        flush=True,
    )

    print("measuring where the truncation error sits", flush=True)
    spatial = spatial_error(field_paths, basis)
    print(
        f"  overall {100 * spatial['overall']:.2f} %, "
        f"near body {100 * spatial['near_body']:.1f} %, "
        f"away {100 * spatial['away_from_body']:.2f} %",
        flush=True,
    )

    for index in range(args.modes):
        frame[f"pod_{index:02d}"] = coefficients[:, index]

    archive, atlas = save_basis(basis, args.output)

    stations = cp_stations()
    station_path = args.output / "cp_stations.json"
    station_path.write_text(
        json.dumps(
            {
                "schemaVersion": SCHEMA_VERSION,
                "perSurface": int(stations.size),
                "stations": [float(value) for value in stations],
                "order": [
                    "upper leading edge to trailing edge",
                    "lower leading edge to trailing edge",
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    table_path = args.output / "designs.parquet"
    frame.to_parquet(table_path, index=False)

    converged = frame[frame["solver_status"] == "ok"]
    SAMPLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    converged.sample(n=min(SAMPLE_ROWS, len(converged)), random_state=0).sort_values(
        "design_id"
    ).to_csv(SAMPLE_PATH, index=False, float_format=SAMPLE_FLOAT_FORMAT)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "datasetVersion": DATASET_VERSION,
        "generated": datetime.now(UTC).isoformat(timespec="seconds"),
        "solverVersion": SOLVER_VERSION,
        "licence": DATA_LICENCE,
        "rows": len(frame),
        "convergedRows": len(converged),
        "shapes": int(frame["shape_id"].nunique()),
        "bounds": {
            "cstUpper": [list(bound) for bound in UPPER_BOUNDS],
            "cstLower": [list(bound) for bound in LOWER_BOUNDS],
            "alphaDeg": list(ALPHA_BOUNDS),
            "reynolds": 1.0e6,
            "mach": 0.0,
        },
        "grid": {
            "nx": GRID_NX,
            "ny": GRID_NY,
            "xRange": list(GRID_X_RANGE),
            "yRange": list(GRID_Y_RANGE),
        },
        "pod": {
            "modes": int(basis.mode_count),
            "subsampleSize": int(basis.subsample_size),
            "capturedEnergy": float(basis.captured_energy[basis.mode_count - 1]),
            "reconstructionRelativeRms": error["relative_rms"],
            "worstRowRelative": error["worst_row_relative"],
            "relativeRmsNearBody": spatial["near_body"],
            "relativeRmsAwayFromBody": spatial["away_from_body"],
        },
        "files": {
            path.name: {"bytes": path.stat().st_size, "sha256": checksum(path)}
            for path in (table_path, archive, atlas, station_path)
        },
    }
    manifest_path = args.output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    REPORT_PATH.write_text(
        coverage_report(frame, basis.captured_energy, error, spatial), encoding="utf-8"
    )

    print(f"wrote {table_path} ({table_path.stat().st_size / 1e6:.1f} MB)")
    print(f"wrote {SAMPLE_PATH} ({len(converged.head(SAMPLE_ROWS))} rows)")
    print(f"wrote {manifest_path} and {REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
