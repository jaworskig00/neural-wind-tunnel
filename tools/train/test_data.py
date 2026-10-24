"""Tests for the training data pipeline.

These use a synthetic frame rather than the real parquet so they run without the dataset present,
which keeps continuous integration independent of a 109 MB Release asset.
"""

import numpy as np
import pandas as pd
import pytest

from tools.train.data import (
    INPUT_COLUMNS,
    MASKED_OUTPUT,
    OUTPUT_COLUMNS,
    TEST_FRACTION,
    VALIDATION_FRACTION,
    load,
)


def synthetic_parquet(path, shapes: int = 200, alphas: int = 8, converged: float = 0.6):
    """A frame with the real column set, written to parquet."""
    rng = np.random.default_rng(5)
    rows = []
    for shape_id in range(shapes):
        design = rng.normal(size=len(INPUT_COLUMNS) - 1) * 0.1
        for index in range(alphas):
            alpha = -6.0 + 16.0 * index / (alphas - 1)
            is_ok = rng.random() < converged
            row: dict[str, float | int | str] = {"design_id": len(rows), "shape_id": shape_id}
            for name, value in zip(INPUT_COLUMNS[:-1], design, strict=True):
                row[name] = float(value)
            row["alpha_deg"] = alpha
            for name in OUTPUT_COLUMNS:
                row[name] = float(rng.normal())
            if not is_ok:
                row["cd"] = float("nan")
            row["solver_status"] = "ok" if is_ok else "bl_not_converged"
            rows.append(row)
    frame = pd.DataFrame(rows)
    target = path / "designs.parquet"
    frame.to_parquet(target, index=False)
    return target


class TestSplits:
    def test_no_shape_appears_in_two_splits(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path))
        train = set(data.train.shape_ids.tolist())
        validation = set(data.validation.shape_ids.tolist())
        test = set(data.test.shape_ids.tolist())
        assert not (train & validation)
        assert not (train & test)
        assert not (validation & test)

    def test_split_sizes_follow_the_fractions(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path, shapes=200))
        total_shapes = 200
        assert len(set(data.test.shape_ids.tolist())) == int(total_shapes * TEST_FRACTION)
        assert len(set(data.validation.shape_ids.tolist())) == int(
            total_shapes * VALIDATION_FRACTION
        )

    def test_every_incidence_of_a_shape_stays_together(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path, alphas=8))
        for split in (data.train, data.validation, data.test):
            counts = pd.Series(split.shape_ids).value_counts()
            assert set(counts.unique()) == {8}

    def test_the_split_is_reproducible(self, tmp_path) -> None:
        source = synthetic_parquet(tmp_path)
        first = load(source, seed=11)
        second = load(source, seed=11)
        np.testing.assert_array_equal(first.test.shape_ids, second.test.shape_ids)

    def test_a_different_seed_gives_a_different_split(self, tmp_path) -> None:
        source = synthetic_parquet(tmp_path)
        assert not np.array_equal(
            load(source, seed=1).test.shape_ids, load(source, seed=2).test.shape_ids
        )


class TestMasking:
    def test_only_drag_is_masked(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path))
        for split in (data.train, data.validation, data.test):
            columns_with_zeros = np.flatnonzero((split.mask == 0).any(axis=0))
            assert columns_with_zeros.tolist() == [MASKED_OUTPUT]

    def test_the_mask_matches_the_converged_fraction(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path, converged=0.6))
        share = data.train.mask[:, MASKED_OUTPUT].mean()
        assert 0.5 < share < 0.7

    def test_no_non_finite_values_survive(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path))
        for split in (data.train, data.validation, data.test):
            assert np.all(np.isfinite(split.outputs))
            assert np.all(np.isfinite(split.inputs))


class TestNormalisation:
    def test_round_trips(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path))
        normalisation = data.normalisation
        encoded = normalisation.encode_inputs(data.train.inputs)
        assert encoded.mean(axis=0) == pytest.approx(np.zeros(len(INPUT_COLUMNS)), abs=1e-5)
        assert encoded.std(axis=0) == pytest.approx(np.ones(len(INPUT_COLUMNS)), abs=1e-4)

    def test_decoding_inverts_encoding_for_outputs(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path))
        normalisation = data.normalisation
        outputs = data.test.outputs
        normalised = (outputs - normalisation.output_mean) / normalisation.output_scale
        np.testing.assert_allclose(normalisation.decode_outputs(normalised), outputs, rtol=1e-5)

    def test_scales_are_never_degenerate(self, tmp_path) -> None:
        data = load(synthetic_parquet(tmp_path))
        assert np.all(data.normalisation.input_scale > 0)
        assert np.all(data.normalisation.output_scale > 0)

    def test_drag_statistics_ignore_masked_rows(self, tmp_path) -> None:
        # Masked rows carry a zeroed drag; including them would pull the mean toward zero.
        data = load(synthetic_parquet(tmp_path, converged=0.5))
        assert abs(data.normalisation.output_mean[MASKED_OUTPUT]) < 0.5
        assert data.normalisation.output_scale[MASKED_OUTPUT] > 0.5
