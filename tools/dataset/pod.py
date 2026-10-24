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
