"""Tests for the proper orthogonal decomposition."""

import numpy as np
import pytest

from tools.dataset.pod import (
    compute_basis,
    project,
    reconstruct,
    reconstruction_error,
    save_basis,
)
from tools.dataset.run import FIELD_LENGTH
from tools.solver.field import GRID_NX, GRID_NY


def synthetic_fields(rows: int = 200, rank: int = 5, seed: int = 3) -> np.ndarray:
    """Snapshots that live exactly in a ``rank``-dimensional subspace, plus a constant offset."""
    rng = np.random.default_rng(seed)
    basis = rng.standard_normal((rank, FIELD_LENGTH)).astype(np.float32)
    weights = rng.standard_normal((rows, rank)).astype(np.float32)
    offset = rng.standard_normal(FIELD_LENGTH).astype(np.float32) * 0.1
    return (weights @ basis * 0.05 + offset).astype(np.float16)


class TestBasis:
    def test_shapes_follow_the_schema(self) -> None:
        basis = compute_basis(synthetic_fields(), mode_count=8, subsample=100)
        assert basis.mean.shape == (FIELD_LENGTH,)
        assert basis.modes.shape == (8, FIELD_LENGTH)
        mean_grid, mode_grids = basis.as_grids()
        assert mean_grid.shape == (2, GRID_NY, GRID_NX)
        assert mode_grids.shape == (8, 2, GRID_NY, GRID_NX)

    def test_modes_are_orthonormal(self) -> None:
        basis = compute_basis(synthetic_fields(), mode_count=5, subsample=150)
        gram = basis.modes @ basis.modes.T
        np.testing.assert_allclose(gram, np.eye(5), atol=2e-3)

    def test_captured_energy_is_monotone_and_reaches_one(self) -> None:
        basis = compute_basis(synthetic_fields(), mode_count=8, subsample=100)
        assert np.all(np.diff(basis.captured_energy) >= -1e-12)
        assert basis.captured_energy[-1] == pytest.approx(1.0, abs=1e-6)

    def test_a_rank_five_set_is_captured_by_five_modes(self) -> None:
        # The mean absorbs the constant offset, leaving exactly five directions of variance.
        basis = compute_basis(synthetic_fields(rank=5), mode_count=8, subsample=150)
        assert basis.captured_energy[4] == pytest.approx(1.0, abs=1e-4)

    def test_singular_values_are_sorted(self) -> None:
        basis = compute_basis(synthetic_fields(), mode_count=8, subsample=100)
        assert np.all(np.diff(basis.singular_values) <= 1e-9)

    def test_rejects_a_wrong_field_length(self) -> None:
        with pytest.raises(ValueError, match="expected"):
            compute_basis(np.zeros((10, 7), dtype=np.float16))

    def test_rejects_too_few_snapshots(self) -> None:
        with pytest.raises(ValueError, match="need more than"):
            compute_basis(np.zeros((4, FIELD_LENGTH), dtype=np.float16), mode_count=8)


class TestProjection:
    def test_round_trip_recovers_a_low_rank_set(self) -> None:
        fields = synthetic_fields(rank=5)
        basis = compute_basis(fields, mode_count=8, subsample=150)
        rebuilt = reconstruct(project(fields, basis), basis)
        relative = np.linalg.norm(rebuilt - fields.astype(np.float32)) / np.linalg.norm(
            fields.astype(np.float32)
        )
        assert relative < 0.02

    def test_truncation_error_falls_as_modes_are_added(self) -> None:
        fields = synthetic_fields(rank=12)
        errors = [
            reconstruction_error(fields, compute_basis(fields, mode_count=k, subsample=150))[
                "relative_rms"
            ]
            for k in (2, 4, 8)
        ]
        assert errors[0] > errors[1] > errors[2]

    def test_coefficients_have_one_column_per_mode(self) -> None:
        fields = synthetic_fields()
        basis = compute_basis(fields, mode_count=6, subsample=120)
        assert project(fields, basis).shape == (fields.shape[0], 6)

    def test_projection_is_chunk_invariant(self) -> None:
        fields = synthetic_fields(rows=120)
        basis = compute_basis(fields, mode_count=4, subsample=100)
        whole = project(fields, basis)
        halves = np.vstack([project(fields[:60], basis), project(fields[60:], basis)])
        np.testing.assert_allclose(whole, halves, rtol=1e-10)


class TestSaving:
    def test_writes_both_artifacts(self, tmp_path) -> None:
        basis = compute_basis(synthetic_fields(), mode_count=8, subsample=100)
        archive, atlas = save_basis(basis, tmp_path)
        assert archive.exists() and atlas.exists()

        loaded = np.load(archive)
        np.testing.assert_allclose(loaded["mean"], basis.as_grids()[0])
        assert loaded["grid_nx"] == GRID_NX
        assert loaded["grid_ny"] == GRID_NY

        # The browser atlas is the mean followed by each mode, float16, nothing else.
        raw = np.frombuffer(atlas.read_bytes(), dtype=np.float16)
        assert raw.size == (basis.mode_count + 1) * FIELD_LENGTH
        np.testing.assert_allclose(raw[:FIELD_LENGTH], basis.mean.astype(np.float16))
