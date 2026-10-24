"""Proper orthogonal decomposition of the velocity perturbation fields.

The surrogate does not predict a velocity field point by point. The fields are reduced here to a
mean plus a handful of spatial modes, and the network predicts only the modal coefficients. The
browser then rebuilds the field in one shader pass as

    u = cos(alpha) + mean_u + sum_i a_i * phi_u_i
    v = sin(alpha) + mean_v + sum_i a_i * phi_v_i

This is the project's central idea, and ADR-007 explains why: it keeps the model tiny, it makes
the field error measurable, and it is the same reduced-order modelling that production simulation
tools use -- not procedural noise dressed up as a solution.

**Method.** Snapshot POD. With ``m`` snapshots of ``n`` points and ``m`` far smaller than ``n``,
the eigenvectors of the ``m`` by ``m`` correlation matrix ``A A^T`` give the modes without ever
forming an ``n`` by ``n`` matrix. The basis is built from a subsample -- a few thousand snapshots
already span the space -- and every row is then projected onto it in chunks, because the full set
of fields runs to several gigabytes.
"""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from tools.dataset.run import DEFAULT_OUTPUT, FIELD_LENGTH
from tools.solver.field import GRID_NX, GRID_NY

Array = NDArray[np.float64]

#: Modes kept. docs/DATASET-SCHEMA.md publishes 32 coefficient columns.
DEFAULT_MODE_COUNT = 32

#: Snapshots used to build the basis. Beyond a few thousand the leading modes stop moving, and the
#: correlation matrix is quadratic in this number.
DEFAULT_SUBSAMPLE = 3000

#: Rows projected per chunk, to bound peak memory during projection.
PROJECTION_CHUNK = 2048


@dataclass(frozen=True)
class PodBasis:
    """Mean field and orthonormal modes, in the stored flat layout."""

    mean: NDArray[np.float32]
    """Mean perturbation field, shape ``(FIELD_LENGTH,)``."""
    modes: NDArray[np.float32]
    """Orthonormal modes, shape ``(mode_count, FIELD_LENGTH)``."""
    singular_values: Array
    """Singular values from the subsample, largest first."""
    captured_energy: Array
    """Cumulative fraction of subsample variance captured by the first ``k`` modes."""
    subsample_size: int

    @property
    def mode_count(self) -> int:
        return self.modes.shape[0]

    def as_grids(self) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
        """Mean and modes reshaped to ``(2, GRID_NY, GRID_NX)`` and ``(k, 2, GRID_NY, GRID_NX)``."""
        shape = (2, GRID_NY, GRID_NX)
        return (
            self.mean.reshape(shape),
            self.modes.reshape((self.mode_count, *shape)),
        )


def compute_basis(
    fields: NDArray[np.float16],
    mode_count: int = DEFAULT_MODE_COUNT,
    subsample: int = DEFAULT_SUBSAMPLE,
    seed: int = 20261024,
) -> PodBasis:
    """Build the basis from ``fields``, a ``(rows, FIELD_LENGTH)`` array of perturbations."""
    if fields.ndim != 2 or fields.shape[1] != FIELD_LENGTH:
        raise ValueError(f"expected (rows, {FIELD_LENGTH}), got {fields.shape}")
    if fields.shape[0] < mode_count + 1:
        raise ValueError(f"need more than {mode_count} snapshots, got {fields.shape[0]}")

    mean = fields.astype(np.float32).mean(axis=0)

    rng = np.random.default_rng(seed)
    take = min(subsample, fields.shape[0])
    chosen = rng.choice(fields.shape[0], size=take, replace=False)
    chosen.sort()
    snapshots = fields[chosen].astype(np.float32) - mean

    # Snapshot POD: eigenvectors of the small correlation matrix carry the same information as
    # the right singular vectors of the tall snapshot matrix.
    correlation = snapshots @ snapshots.T
    eigenvalues, eigenvectors = np.linalg.eigh(correlation)
    order = np.argsort(eigenvalues)[::-1]
    eigenvalues = np.clip(eigenvalues[order], 0.0, None)
    eigenvectors = eigenvectors[:, order]

    total = float(eigenvalues.sum())
    captured = np.cumsum(eigenvalues) / total if total > 0 else np.zeros_like(eigenvalues)

    kept = eigenvectors[:, :mode_count]
    modes = (kept.T @ snapshots).astype(np.float32)
    # Normalise to unit length; the eigenvalue scaling would otherwise make mode amplitudes
    # depend on the subsample size.
    norms = np.linalg.norm(modes, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    modes /= norms

    return PodBasis(
        mean=mean,
        modes=modes,
        singular_values=np.sqrt(eigenvalues[:mode_count]),
        captured_energy=captured,
        subsample_size=take,
    )


def project(fields: NDArray[np.float16], basis: PodBasis) -> Array:
    """Modal coefficients for every row, shape ``(rows, mode_count)``."""
    coefficients = np.empty((fields.shape[0], basis.mode_count), dtype=np.float64)
    for begin in range(0, fields.shape[0], PROJECTION_CHUNK):
        end = begin + PROJECTION_CHUNK
        chunk = fields[begin:end].astype(np.float32) - basis.mean
        coefficients[begin:end] = chunk @ basis.modes.T
    return coefficients


def reconstruct(coefficients: Array, basis: PodBasis) -> NDArray[np.float32]:
    """Rebuild perturbation fields from coefficients -- the browser's shader pass, in numpy."""
    return (basis.mean + np.atleast_2d(coefficients).astype(np.float32) @ basis.modes).astype(
        np.float32
    )


def reconstruction_error(fields: NDArray[np.float16], basis: PodBasis) -> dict[str, float]:
    """Relative error of the truncated reconstruction, over every row."""
    squared_error = 0.0
    squared_signal = 0.0
    worst = 0.0
    for begin in range(0, fields.shape[0], PROJECTION_CHUNK):
        end = begin + PROJECTION_CHUNK
        chunk = fields[begin:end].astype(np.float32)
        rebuilt = reconstruct(project(fields[begin:end], basis), basis)
        residual = chunk - rebuilt
        squared_error += float(np.sum(residual**2))
        squared_signal += float(np.sum(chunk**2))
        row_relative = np.linalg.norm(residual, axis=1) / np.maximum(
            np.linalg.norm(chunk, axis=1), 1e-12
        )
        worst = max(worst, float(row_relative.max()))
    return {
        "relative_rms": float(np.sqrt(squared_error / max(squared_signal, 1e-30))),
        "worst_row_relative": worst,
    }


def save_basis(basis: PodBasis, output: Path) -> tuple[Path, Path]:
    """Write the basis twice: float32 for Python, float16 for the browser's texture atlas."""
    output.mkdir(parents=True, exist_ok=True)
    mean_grid, mode_grids = basis.as_grids()

    archive = output / "pod_modes.npz"
    np.savez_compressed(
        archive,
        mean=mean_grid,
        modes=mode_grids,
        singular_values=basis.singular_values,
        captured_energy=basis.captured_energy,
        grid_nx=GRID_NX,
        grid_ny=GRID_NY,
        subsample_size=basis.subsample_size,
    )

    # Browser layout: the mean first, then each mode, each as u then v, row-major in y then x.
    atlas = output / "pod_modes.bin"
    stacked = np.concatenate([basis.mean[None, :], basis.modes]).astype(np.float16)
    atlas.write_bytes(stacked.tobytes())
    return archive, atlas


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--modes", type=int, default=DEFAULT_MODE_COUNT)
    parser.add_argument("--subsample", type=int, default=DEFAULT_SUBSAMPLE)
    args = parser.parse_args()

    from tools.dataset.run import load_fields

    fields = load_fields(args.output)
    print(f"loaded {fields.shape[0]} fields ({fields.nbytes / 1e9:.2f} GB)", flush=True)

    basis = compute_basis(fields, mode_count=args.modes, subsample=args.subsample)
    for count in (1, 4, 8, 16, args.modes):
        print(
            f"  {count:3d} modes capture {100 * basis.captured_energy[count - 1]:.3f} % of variance"
        )
    error = reconstruction_error(fields, basis)
    print(
        f"  reconstruction: relative rms {error['relative_rms']:.4f}, "
        f"worst row {error['worst_row_relative']:.4f}"
    )

    archive, atlas = save_basis(basis, args.output)
    print(f"wrote {archive} and {atlas} ({atlas.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# --- Streaming variants -------------------------------------------------------------------------
# The full set of fields for a production run is several gigabytes, so nothing below ever holds
# more than one shard plus the basis in memory. Each shard file is memory-mapped and read in one
# pass; the subsample that builds the basis is strided across every shard so it stays representative
# rather than favouring whichever shapes happened to be solved first.


def _shard_rows(path: Path) -> int:
    return int(np.load(path, mmap_mode="r").shape[0])


def streaming_mean(paths: Sequence[Path]) -> NDArray[np.float32]:
    """Mean perturbation field across every shard."""
    total = np.zeros(FIELD_LENGTH, dtype=np.float64)
    rows = 0
    for path in paths:
        shard = np.load(path, mmap_mode="r")
        for begin in range(0, shard.shape[0], PROJECTION_CHUNK):
            block = np.asarray(shard[begin : begin + PROJECTION_CHUNK], dtype=np.float32)
            total += block.sum(axis=0, dtype=np.float64)
        rows += shard.shape[0]
    if rows == 0:
        raise ValueError("no field shards")
    return (total / rows).astype(np.float32)


def streaming_subsample(paths: Sequence[Path], target: int, seed: int) -> NDArray[np.float32]:
    """A strided subsample drawn evenly from every shard."""
    per_shard = max(1, target // max(len(paths), 1))
    rng = np.random.default_rng(seed)
    chosen: list[NDArray[np.float32]] = []
    for path in paths:
        shard = np.load(path, mmap_mode="r")
        count = min(per_shard, shard.shape[0])
        indices = np.sort(rng.choice(shard.shape[0], size=count, replace=False))
        chosen.append(np.asarray(shard[indices], dtype=np.float32))
    return np.concatenate(chosen)


def compute_basis_streaming(
    paths: Sequence[Path],
    mode_count: int = DEFAULT_MODE_COUNT,
    subsample: int = DEFAULT_SUBSAMPLE,
    seed: int = 20261024,
) -> PodBasis:
    """Build the basis without ever loading every field at once."""
    mean = streaming_mean(paths)
    snapshots = streaming_subsample(paths, subsample, seed) - mean

    correlation = snapshots @ snapshots.T
    eigenvalues, eigenvectors = np.linalg.eigh(correlation)
    order = np.argsort(eigenvalues)[::-1]
    eigenvalues = np.clip(eigenvalues[order], 0.0, None)
    eigenvectors = eigenvectors[:, order]

    total = float(eigenvalues.sum())
    captured = np.cumsum(eigenvalues) / total if total > 0 else np.zeros_like(eigenvalues)

    modes = (eigenvectors[:, :mode_count].T @ snapshots).astype(np.float32)
    norms = np.linalg.norm(modes, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    modes /= norms

    return PodBasis(
        mean=mean,
        modes=modes,
        singular_values=np.sqrt(eigenvalues[:mode_count]),
        captured_energy=captured,
        subsample_size=snapshots.shape[0],
    )


def project_streaming(paths: Sequence[Path], basis: PodBasis) -> tuple[Array, dict[str, float]]:
    """Coefficients for every row in shard order, with the reconstruction error alongside."""
    coefficients: list[Array] = []
    squared_error = 0.0
    squared_signal = 0.0
    worst = 0.0

    for path in paths:
        shard = np.load(path, mmap_mode="r")
        for begin in range(0, shard.shape[0], PROJECTION_CHUNK):
            block = np.asarray(shard[begin : begin + PROJECTION_CHUNK], dtype=np.float32)
            centred = block - basis.mean
            chunk_coefficients = centred @ basis.modes.T
            coefficients.append(chunk_coefficients.astype(np.float64))

            residual = centred - chunk_coefficients @ basis.modes
            squared_error += float(np.sum(residual**2))
            squared_signal += float(np.sum(block**2))
            row_relative = np.linalg.norm(residual, axis=1) / np.maximum(
                np.linalg.norm(block, axis=1), 1e-12
            )
            worst = max(worst, float(row_relative.max()))

    error = {
        "relative_rms": float(np.sqrt(squared_error / max(squared_signal, 1e-30))),
        "worst_row_relative": worst,
    }
    return np.concatenate(coefficients), error


def spatial_error(paths: Sequence[Path], basis: PodBasis, shards: int = 10) -> dict[str, float]:
    """Where the truncation error actually lives.

    A single relative-rms figure hides the thing that matters here. The body occupies a different
    set of grid points in every row, so the masked region is a moving discontinuity -- precisely the
    structure a linear basis cannot compress. Splitting the error by region shows whether the
    remainder of the field, which is what the particles and streamlines actually traverse, is
    reconstructed well. Measured over the first ``shards`` shards, which is ample.
    """
    from tools.solver.field import grid_coordinates

    points = GRID_NY * GRID_NX
    squared_error = np.zeros(2 * points)
    squared_signal = np.zeros(2 * points)
    rows = 0

    for path in paths[:shards]:
        shard = np.load(path, mmap_mode="r")
        for begin in range(0, shard.shape[0], PROJECTION_CHUNK):
            block = np.asarray(shard[begin : begin + PROJECTION_CHUNK], dtype=np.float32)
            coefficients = (block - basis.mean) @ basis.modes.T
            residual = block - (basis.mean + coefficients @ basis.modes)
            squared_error += np.sum(residual.astype(np.float64) ** 2, axis=0)
            squared_signal += np.sum(block.astype(np.float64) ** 2, axis=0)
            rows += block.shape[0]

    def fold(values: NDArray[np.float64]) -> NDArray[np.float64]:
        return (values[:points] + values[points:]).reshape((GRID_NY, GRID_NX))

    error_grid = fold(squared_error)
    signal_grid = fold(squared_signal)

    x, y = grid_coordinates()
    mesh_x, mesh_y = np.meshgrid(x, y)
    # The band the section and its immediate wake occupy, generously drawn.
    near_body = (mesh_x > -0.08) & (mesh_x < 1.08) & (np.abs(mesh_y) < 0.14)

    def ratio(mask: NDArray[np.bool_]) -> float:
        return float(np.sqrt(error_grid[mask].sum() / max(signal_grid[mask].sum(), 1e-30)))

    everywhere = np.ones_like(near_body)
    return {
        "rows": float(rows),
        "overall": ratio(everywhere),
        "near_body": ratio(near_body),
        "away_from_body": ratio(~near_body),
        "near_body_points": float(near_body.sum()),
        "away_points": float((~near_body).sum()),
        "away_absolute_rms": float(np.sqrt((error_grid[~near_body] / rows).mean())),
    }
