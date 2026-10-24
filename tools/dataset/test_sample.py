"""Tests for the shape sampler."""

import numpy as np
import pytest

from tools.dataset.sample import (
    ALPHA_BOUNDS,
    ALPHAS_PER_SHAPE,
    LE_RADIUS_BOUNDS,
    THICKNESS_BOUNDS,
    RejectionReason,
    accept,
    alphas_for_shape,
    generate_shapes,
    sobol_weights,
    surfaces_cross,
)
from tools.solver.geometry import CST_ORDER


class TestSobolWeights:
    def test_respects_the_published_bounds(self) -> None:
        weights = sobol_weights(256, seed=1)
        assert weights.shape == (256, 2 * CST_ORDER)
        from tools.dataset.sample import LOWER_BOUNDS, UPPER_BOUNDS

        for column, (low, high) in enumerate((*UPPER_BOUNDS, *LOWER_BOUNDS)):
            assert weights[:, column].min() >= low
            assert weights[:, column].max() <= high

    def test_covers_each_dimension_more_evenly_than_random_draws(self) -> None:
        # A Sobol sequence's whole point is low discrepancy; compare the worst gap in each
        # dimension against independent uniform draws of the same size.
        count = 512
        sobol = sobol_weights(count, seed=1)
        rng = np.random.default_rng(1)
        uniform = rng.random((count, 2 * CST_ORDER))
        sobol_unit = (sobol - sobol.min(axis=0)) / np.ptp(sobol, axis=0)
        worst_sobol = max(np.diff(np.sort(sobol_unit[:, d])).max() for d in range(2 * CST_ORDER))
        worst_uniform = max(np.diff(np.sort(uniform[:, d])).max() for d in range(2 * CST_ORDER))
        assert worst_sobol < worst_uniform

    def test_is_reproducible_for_a_seed(self) -> None:
        np.testing.assert_array_equal(sobol_weights(64, seed=7), sobol_weights(64, seed=7))


class TestFilters:
    def test_crossing_surfaces_are_detected(self) -> None:
        assert surfaces_cross(np.full(CST_ORDER, 0.05), np.full(CST_ORDER, 0.30))
        assert not surfaces_cross(np.full(CST_ORDER, 0.20), np.full(CST_ORDER, -0.15))

    def test_a_crossed_shape_is_rejected(self) -> None:
        shape, reason = accept(np.full(CST_ORDER, 0.05), np.full(CST_ORDER, 0.30))
        assert shape is None
        assert reason == RejectionReason.SURFACES_CROSS

    def test_a_section_that_is_too_thin_is_rejected(self) -> None:
        shape, reason = accept(np.full(CST_ORDER, 0.09), np.full(CST_ORDER, -0.04))
        assert shape is None
        assert reason == RejectionReason.THICKNESS_OUT_OF_RANGE

    def test_an_accepted_shape_satisfies_every_filter(self) -> None:
        shape, reason = accept(np.full(CST_ORDER, 0.20), np.full(CST_ORDER, -0.15))
        assert reason is None
        assert shape is not None
        assert THICKNESS_BOUNDS[0] <= shape.metrics.thickness_max <= THICKNESS_BOUNDS[1]
        assert LE_RADIUS_BOUNDS[0] <= shape.metrics.le_radius <= LE_RADIUS_BOUNDS[1]
        assert shape.metrics.area > 0.0

    def test_the_leading_edge_radius_is_the_exact_closed_form(self) -> None:
        # Not the coordinate fit; see ADR-013.
        shape, _ = accept(np.full(CST_ORDER, 0.20), np.full(CST_ORDER, -0.15))
        assert shape is not None
        assert shape.metrics.le_radius == pytest.approx(0.5 * 0.20**2, rel=1e-12)


class TestGenerateShapes:
    def test_returns_the_requested_count_with_a_rejection_tally(self) -> None:
        shapes, rejected = generate_shapes(64)
        assert len(shapes) == 64
        assert sum(rejected.values()) > 0, "some candidates should fail the filters"
        assert set(rejected) <= {
            RejectionReason.SURFACES_CROSS,
            RejectionReason.THICKNESS_OUT_OF_RANGE,
            RejectionReason.LE_RADIUS_OUT_OF_RANGE,
            RejectionReason.NON_POSITIVE_AREA,
        }

    def test_shape_ids_are_contiguous(self) -> None:
        shapes, _ = generate_shapes(32)
        assert [s.shape_id for s in shapes] == list(range(32))

    def test_the_accepted_set_spans_the_thickness_range(self) -> None:
        shapes, _ = generate_shapes(128)
        thickness = np.array([s.metrics.thickness_max for s in shapes])
        assert thickness.min() < 0.08
        assert thickness.max() > 0.18

    def test_the_accepted_set_covers_positive_and_negative_camber(self) -> None:
        shapes, _ = generate_shapes(128)
        camber = np.array([s.metrics.camber_max for s in shapes])
        assert camber.min() < 0.0 < camber.max()

    def test_generation_is_reproducible(self) -> None:
        first, _ = generate_shapes(16, seed=99)
        second, _ = generate_shapes(16, seed=99)
        for a, b in zip(first, second, strict=True):
            np.testing.assert_array_equal(a.upper_weights, b.upper_weights)


class TestAlphas:
    def test_one_angle_per_stratum_inside_the_bounds(self) -> None:
        alphas = alphas_for_shape(0)
        assert alphas.size == ALPHAS_PER_SHAPE
        assert alphas.min() >= ALPHA_BOUNDS[0]
        assert alphas.max() <= ALPHA_BOUNDS[1]
        edges = np.linspace(*ALPHA_BOUNDS, ALPHAS_PER_SHAPE + 1)
        for angle, low, high in zip(alphas, edges[:-1], edges[1:], strict=True):
            assert low <= angle <= high

    def test_different_shapes_get_different_angles(self) -> None:
        assert not np.array_equal(alphas_for_shape(0), alphas_for_shape(1))

    def test_angles_are_reproducible_per_shape(self) -> None:
        np.testing.assert_array_equal(alphas_for_shape(5), alphas_for_shape(5))
