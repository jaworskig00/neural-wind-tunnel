"""Tests for airfoil geometry.

These hold the geometry module to published NACA values and to the CST conventions declared in
``docs/DATASET-SCHEMA.md`` section 2.
"""

import math

import numpy as np

from tools.solver.geometry import (
    CST_ORDER,
    DEFAULT_PANEL_COUNT,
    Airfoil,
    cosine_spacing,
    cst,
    cst_leading_edge_radius,
    cst_metrics,
    cst_surface,
    fit_cst,
    geometry_metrics,
    naca4,
)


def naca_leading_edge_radius(thickness: float) -> float:
    """Published closed form for the NACA four-digit nose."""
    return 1.1019 * thickness**2


class TestCosineSpacing:
    def test_spans_the_chord(self) -> None:
        x = cosine_spacing(65)
        assert x[0] == 0.0
        assert math.isclose(x[-1], 1.0, abs_tol=1e-12)

    def test_is_monotonic_and_symmetric(self) -> None:
        x = cosine_spacing(65)
        assert np.all(np.diff(x) > 0)
        np.testing.assert_allclose(x, 1.0 - x[::-1], atol=1e-12)

    def test_clusters_toward_both_edges(self) -> None:
        gaps = np.diff(cosine_spacing(65))
        assert gaps[0] < gaps[len(gaps) // 2] / 4
        assert math.isclose(gaps[0], gaps[-1], abs_tol=1e-12)

    def test_rejects_degenerate_counts(self) -> None:
        for count in (-1, 0, 1):
            try:
                cosine_spacing(count)
            except ValueError:
                continue
            raise AssertionError(f"cosine_spacing({count}) should have raised")


class TestNaca4:
    def test_loop_is_closed_and_has_the_requested_panels(self) -> None:
        airfoil = naca4("0012")
        assert airfoil.panel_count == DEFAULT_PANEL_COUNT
        np.testing.assert_allclose(airfoil.coordinates[0], airfoil.coordinates[-1], atol=0)
        np.testing.assert_allclose(airfoil.coordinates[0], [1.0, 0.0], atol=1e-12)

    def test_loop_runs_trailing_edge_upper_nose_lower(self) -> None:
        airfoil = naca4("2412")
        nose = int(np.argmin(airfoil.coordinates[:, 0]))
        # First half is the upper surface, so its ordinates are the higher ones.
        assert airfoil.coordinates[: nose + 1, 1].max() > 0
        assert airfoil.coordinates[nose:, 1].min() < 0
        upper, lower = airfoil.surfaces()
        assert np.all(np.diff(upper[:, 0]) > 0), "surfaces run leading edge to trailing edge"
        assert np.all(np.diff(lower[:, 0]) > 0)

    def test_symmetric_section_has_no_camber(self) -> None:
        metrics = geometry_metrics(naca4("0012"))
        assert abs(metrics.camber_max) < 1e-12

    def test_thickness_matches_the_designation(self) -> None:
        # The plan's acceptance criterion is 1e-4 on NACA 0012.
        assert abs(geometry_metrics(naca4("0012")).thickness_max - 0.12) < 1e-4

        # Thicker and cambered sections carry a little more error: the metrics are read off a
        # linear interpolation of 80 panels per surface, and the thickness peak sits in a flat
        # region where that interpolation is least faithful. 3e-4 is the measured bound.
        for designation in ("0008", "2412", "4421"):
            expected = int(designation[2:]) / 100.0
            metrics = geometry_metrics(naca4(designation))
            assert abs(metrics.thickness_max - expected) < 3e-4, designation

    def test_camber_matches_the_designation(self) -> None:
        metrics = geometry_metrics(naca4("2412"))
        assert abs(metrics.camber_max - 0.02) < 1e-4
        assert abs(metrics.camber_max_x - 0.40) < 5e-3

    def test_rejects_bad_input(self) -> None:
        for bad in ("012", "abcd", "00122"):
            try:
                naca4(bad)
            except ValueError:
                continue
            raise AssertionError(f"naca4({bad!r}) should have raised")
        try:
            naca4("0012", panel_count=61)
        except ValueError:
            pass
        else:
            raise AssertionError("an odd panel count should have raised")


class TestCst:
    def test_surface_closes_at_both_edges(self) -> None:
        weights = np.full(CST_ORDER, 0.2)
        assert cst_surface(weights, np.array([0.0]))[0] == 0.0
        assert abs(cst_surface(weights, np.array([1.0]))[0]) < 1e-15
        assert cst_surface(weights, np.array([0.5]))[0] > 0.0

    def test_surface_rejects_the_wrong_weight_count(self) -> None:
        try:
            cst_surface(np.full(CST_ORDER + 1, 0.2), np.array([0.5]))
        except ValueError:
            return
        raise AssertionError("a wrong weight count should have raised")

    def test_leading_edge_radius_follows_the_first_weight(self) -> None:
        # z ~ A_0 sqrt(psi) at the nose, and z^2 = 2 r x gives r = A_0^2 / 2.
        assert math.isclose(cst_leading_edge_radius(0.2), 0.02, rel_tol=1e-12)

    def test_uniform_weights_give_a_plausible_section(self) -> None:
        airfoil = cst(np.full(CST_ORDER, 0.2), np.full(CST_ORDER, -0.15))
        metrics = geometry_metrics(airfoil, le_radius=cst_leading_edge_radius(0.2))
        assert 0.06 < metrics.thickness_max < 0.20
        assert metrics.area > 0
        np.testing.assert_allclose(airfoil.coordinates[0], [1.0, 0.0], atol=1e-12)


class TestFitCst:
    """A six-weight CST cannot reproduce a NACA nose exactly; the residual is bounded and local."""

    def test_round_trip_of_naca_2412(self) -> None:
        original = naca4("2412")
        upper_weights, lower_weights = fit_cst(original)
        refit = cst(upper_weights, lower_weights)

        for source, target in zip(original.surfaces(), refit.surfaces(), strict=True):
            error = np.abs(np.interp(source[:, 0], target[:, 0], target[:, 1]) - source[:, 1])
            outboard = source[:, 0] > 0.005
            # Measured: 3.1e-3 on the upper surface at x = 4e-5, falling below 1e-3 by
            # x = 0.005 and below 3e-4 by x = 0.01. See ADR-013.
            assert error.max() < 4e-3, "overall residual"
            assert error[outboard].max() < 1e-3, "residual outside the first 0.5 % of chord"

    def test_round_trip_preserves_the_derived_metrics(self) -> None:
        original = naca4("2412")
        refit = cst(*fit_cst(original))
        before = geometry_metrics(original)
        after = geometry_metrics(refit)
        assert abs(after.thickness_max - before.thickness_max) < 1e-3
        assert abs(after.camber_max - before.camber_max) < 1e-3


class TestGeometryMetrics:
    def test_exact_leading_edge_radius_is_used_when_given(self) -> None:
        metrics = geometry_metrics(naca4("0012"), le_radius=naca_leading_edge_radius(0.12))
        assert math.isclose(metrics.le_radius, 0.01587, abs_tol=1e-5)

    def test_estimated_radius_is_in_the_right_ballpark(self) -> None:
        # The fallback estimator reads low because thickness is applied perpendicular to the
        # camber line; see ADR-013. It must still land within a factor of two.
        metrics = geometry_metrics(naca4("0012"))
        exact = naca_leading_edge_radius(0.12)
        assert 0.5 * exact < metrics.le_radius < 1.5 * exact

    def test_area_is_positive_and_sane(self) -> None:
        metrics = geometry_metrics(naca4("0012"))
        # A NACA four-digit section encloses roughly 0.68 * t * c.
        assert math.isclose(metrics.area, 0.68 * 0.12, rel_tol=0.05)

    def test_handles_a_flat_plate_without_crashing(self) -> None:
        x = cosine_spacing(21)
        loop = np.vstack(
            [
                np.column_stack([x[::-1], np.zeros_like(x)]),
                np.column_stack([x[1:], np.zeros_like(x[1:])]),
            ]
        )
        metrics = geometry_metrics(Airfoil(name="flat", coordinates=loop))
        assert metrics.thickness_max == 0.0
        assert metrics.area == 0.0


class TestCstMetrics:
    """The exact metrics path, which the TypeScript port mirrors."""

    def test_agrees_with_the_interpolated_path_to_within_its_known_bias(self) -> None:
        upper, lower = fit_cst(naca4("2412", panel_count=320))
        exact = cst_metrics(upper, lower)
        interpolated = geometry_metrics(cst(upper, lower))
        # Reading metrics off a linear interpolation of 80 panels per surface costs about 3e-5 in
        # peak thickness and a hundredth of chord in its station; see ADR-013.
        assert abs(exact.thickness_max - interpolated.thickness_max) < 5e-5
        assert abs(exact.thickness_max_x - interpolated.thickness_max_x) < 0.02

    def test_is_more_accurate_on_a_known_section(self) -> None:
        upper, lower = fit_cst(naca4("0012", panel_count=640))
        exact = cst_metrics(upper, lower)
        # A CST fit of NACA 0012 should peak near 12 % of chord at 30 % of chord.
        assert abs(exact.thickness_max - 0.12) < 1e-3
        assert abs(exact.thickness_max_x - 0.30) < 0.02

    def test_uses_the_closed_form_leading_edge_radius(self) -> None:
        weights = np.full(CST_ORDER, 0.2)
        assert math.isclose(cst_metrics(weights, -weights).le_radius, 0.02, rel_tol=1e-12)
