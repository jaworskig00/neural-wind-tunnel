"""Batch solver: turn sampled shapes into dataset shards.

Work is split into shards of shapes. Each shard writes two files, a parquet table of the scalar
and pressure columns and a float16 array of the velocity perturbation fields, and a shard whose
two files already exist is skipped -- so an interrupted run resumes by being started again.

The *perturbation* field is stored, not the total: ``(u - cos(alpha), v - sin(alpha))``, with
points inside the body set to zero. Two reasons, and both matter. The perturbation decays to zero
far from the section, which makes it far more compressible by proper orthogonal decomposition than
a field dominated by a constant freestream. And incidence then enters the browser's reconstruction
analytically -- ``u = cos(alpha) + sum(a_i phi_i)`` -- instead of having to be learnt.

Run from the repository root::

    uv run python -m tools.dataset.run --shapes 8400
    uv run python -m tools.dataset.run --shapes 8400 --workers 8      # resume after an interrupt
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from numpy.typing import NDArray

from tools.dataset.sample import Shape, alphas_for_shape, generate_shapes
from tools.solver.field import GRID_NX, GRID_NY
from tools.solver.geometry import CST_ORDER, DEFAULT_PANEL_COUNT
from tools.solver.solve import CP_STATIONS_PER_SURFACE, solve

Array = NDArray[np.float64]

#: Version stamped into every row. Bump it when the solver's numerical output changes.
SOLVER_VERSION = "1.0.0"

#: Shapes per shard. Small enough that an interrupted run loses little, large enough that process
#: startup and parquet overhead stay negligible.
SHAPES_PER_SHARD = 100

#: Length of one flattened perturbation field: two components over the sampling grid.
FIELD_LENGTH = 2 * GRID_NY * GRID_NX

DEFAULT_OUTPUT = Path("data/generated")


@dataclass(frozen=True)
class ShardPaths:
    table: Path
    fields: Path

    @property
    def complete(self) -> bool:
        return self.table.exists() and self.fields.exists()


def shard_paths(output: Path, index: int) -> ShardPaths:
    shards = output / "shards"
    return ShardPaths(
        table=shards / f"shard_{index:05d}.parquet",
        fields=shards / f"shard_{index:05d}.f16.npy",
    )


def column_names() -> list[str]:
    """Dataset columns in the order docs/DATASET-SCHEMA.md section 5 publishes them."""
    columns = ["design_id", "shape_id"]
    columns += [f"cst_u_{i}" for i in range(CST_ORDER)]
    columns += [f"cst_l_{i}" for i in range(CST_ORDER)]
    columns += ["alpha_deg", "reynolds", "mach"]
    columns += [
        "thickness_max",
        "thickness_max_x",
        "camber_max",
        "camber_max_x",
        "le_radius",
        "area",
    ]
    columns += ["cl", "cd", "cd_pressure", "cd_friction", "cm_quarter", "cl_over_cd"]
    columns += ["x_transition_upper", "x_transition_lower"]
    columns += [f"cp_{j:03d}" for j in range(2 * CP_STATIONS_PER_SURFACE)]
    columns += ["solver_status", "solver_version", "panel_count"]
    return columns


def perturbation_field(result, alpha_deg: float) -> NDArray[np.float16]:
    """Flatten one solved field into the stored perturbation vector."""
    field = result.field
    if field is None:
        raise ValueError("solve must be called with with_field=True")
    alpha = np.radians(alpha_deg)
    u = np.nan_to_num(field.u - np.cos(alpha), nan=0.0)
    v = np.nan_to_num(field.v - np.sin(alpha), nan=0.0)
    return np.concatenate([u.ravel(), v.ravel()]).astype(np.float16)


def solve_shape(shape: Shape, reynolds: float, seed: int) -> tuple[list[dict], NDArray[np.float16]]:
    """Solve every incidence for one shape."""
    rows: list[dict] = []
    fields = np.zeros((0, FIELD_LENGTH), dtype=np.float16)
    collected: list[NDArray[np.float16]] = []

    for alpha_deg in alphas_for_shape(shape.shape_id, seed=seed):
        result = solve(shape.airfoil, float(alpha_deg), reynolds, with_field=True)
        metrics = shape.metrics
        row: dict[str, float | int | str] = {"design_id": 0, "shape_id": shape.shape_id}
        for i in range(CST_ORDER):
            row[f"cst_u_{i}"] = float(shape.upper_weights[i])
            row[f"cst_l_{i}"] = float(shape.lower_weights[i])
        row |= {
            "alpha_deg": float(alpha_deg),
            "reynolds": reynolds,
            "mach": 0.0,
            "thickness_max": metrics.thickness_max,
            "thickness_max_x": metrics.thickness_max_x,
            "camber_max": metrics.camber_max,
            "camber_max_x": metrics.camber_max_x,
            "le_radius": metrics.le_radius,
            "area": metrics.area,
            "cl": result.cl,
            "cd": result.cd,
            "cd_pressure": result.cd_pressure,
            "cd_friction": result.cd_friction,
            "cm_quarter": result.cm_quarter,
            "cl_over_cd": result.cl / result.cd if result.cd > 0 else float("nan"),
            "x_transition_upper": result.x_transition_upper,
            "x_transition_lower": result.x_transition_lower,
            "solver_status": result.status.value,
            "solver_version": SOLVER_VERSION,
            "panel_count": DEFAULT_PANEL_COUNT,
        }
        for j, value in enumerate(result.cp_stations):
            row[f"cp_{j:03d}"] = float(value)
        rows.append(row)
        collected.append(perturbation_field(result, float(alpha_deg)))

    if collected:
        fields = np.stack(collected)
    return rows, fields


def _solve_shard(args: tuple[list[Shape], float, int]) -> tuple[list[dict], NDArray[np.float16]]:
    shapes, reynolds, seed = args
    rows: list[dict] = []
    fields: list[NDArray[np.float16]] = []
    for shape in shapes:
        shape_rows, shape_fields = solve_shape(shape, reynolds, seed)
        rows.extend(shape_rows)
        fields.append(shape_fields)
    return rows, np.concatenate(fields) if fields else np.zeros((0, FIELD_LENGTH), np.float16)


def _shards(shapes: list[Shape]) -> Iterator[tuple[int, list[Shape]]]:
    for index, begin in enumerate(range(0, len(shapes), SHAPES_PER_SHARD)):
        yield index, shapes[begin : begin + SHAPES_PER_SHARD]


def run(
    shape_count: int,
    output: Path = DEFAULT_OUTPUT,
    workers: int | None = None,
    reynolds: float = 1.0e6,
    seed: int = 20261024,
) -> dict[str, int]:
    """Solve every sampled shape, writing shards. Returns a summary tally."""
    (output / "shards").mkdir(parents=True, exist_ok=True)

    started = time.perf_counter()
    shapes, rejected = generate_shapes(shape_count, seed=seed)
    print(
        f"sampled {len(shapes)} shapes, rejected {sum(rejected.values())} candidates "
        f"({rejected}) in {time.perf_counter() - started:.1f}s",
        flush=True,
    )

    pending = [
        (index, chunk)
        for index, chunk in _shards(shapes)
        if not shard_paths(output, index).complete
    ]
    done = sum(1 for index, _ in _shards(shapes) if shard_paths(output, index).complete)
    print(f"{done} shards already complete, {len(pending)} to solve", flush=True)

    columns = column_names()
    solved = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_solve_shard, (chunk, reynolds, seed)): index for index, chunk in pending
        }
        for future in as_completed(futures):
            index = futures[future]
            rows, fields = future.result()
            paths = shard_paths(output, index)
            frame = pd.DataFrame(rows)[columns]
            frame.to_parquet(paths.table, index=False)
            np.save(paths.fields, fields)
            solved += 1
            elapsed = time.perf_counter() - started
            print(
                f"shard {index:05d}: {len(rows)} rows "
                f"({solved}/{len(pending)}, {elapsed:.0f}s elapsed)",
                flush=True,
            )

    return {"shapes": len(shapes), "shards": done + solved, "rejected": sum(rejected.values())}


def load_tables(output: Path = DEFAULT_OUTPUT) -> pd.DataFrame:
    """Concatenate every shard table, assigning the final contiguous ``design_id``."""
    tables = sorted((output / "shards").glob("shard_*.parquet"))
    if not tables:
        raise FileNotFoundError(f"no shards in {output / 'shards'}")
    frame = pd.concat([pd.read_parquet(path) for path in tables], ignore_index=True)
    frame = frame.sort_values(["shape_id", "alpha_deg"], ignore_index=True)
    frame["design_id"] = np.arange(len(frame), dtype=np.int64)
    return frame


def load_fields(output: Path = DEFAULT_OUTPUT) -> NDArray[np.float16]:
    """Concatenate every shard's perturbation fields, in the same order as :func:`load_tables`."""
    arrays = sorted((output / "shards").glob("shard_*.f16.npy"))
    if not arrays:
        raise FileNotFoundError(f"no field shards in {output / 'shards'}")
    return np.concatenate([np.load(path) for path in arrays])


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--shapes", type=int, default=8400, help="shapes to accept and solve")
    parser.add_argument("--workers", type=int, default=None, help="worker processes")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--reynolds", type=float, default=1.0e6)
    parser.add_argument("--seed", type=int, default=20261024)
    args = parser.parse_args()

    summary = run(
        shape_count=args.shapes,
        output=args.output,
        workers=args.workers,
        reynolds=args.reynolds,
        seed=args.seed,
    )
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
