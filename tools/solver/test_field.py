"""Verification of the sampled velocity field."""

import itertools

import numpy as np
import pytest

from tools.solver.field import (
    GRID_NX,
    GRID_NY,
    GRID_X_RANGE,
    GRID_Y_RANGE,
    grid_coordinates,
    induced_velocity,
    points_inside,
    sample_field,
)
from tools.solver.geometry import naca4
from tools.solver.panel import solve_inviscid

ALPHA = 5.0


def solved(designation: str = "0012", alpha_deg: float = ALPHA, panel_count: int = 200):
    airfoil = naca4(designation, panel_count=panel_count)
    panel = solve_inviscid(airfoil, alpha_deg)
    loop = np.ascontiguousarray(airfoil.coordinates[::-1])
    return airfoil, panel, loop


class TestGrid:
    def test_matches_the_schema(self) -> None:
        x, y = grid_coordinates()
        assert (x.size, y.size) == (GRID_NX, GRID_NY)
        assert (x[0], x[-1]) == GRID_X_RANGE
        assert (y[0], y[-1]) == GRID_Y_RANGE
        assert np.allclose(np.diff(x), x[1] - x[0])
        assert np.allclose(np.diff(y), y[1] - y[0])

    def test_field_is_shaped_row_major_with_y_outermost(self) -> None:
        airfoil, panel, _ = solved()
        field = sample_field(airfoil, panel, ALPHA)
        assert field.u.shape == (GRID_NY, GRID_NX)
        assert field.v.shape == (GRID_NY, GRID_NX)
        assert field.inside.shape == (GRID_NY, GRID_NX)


class TestFarField:
    def test_induced_velocity_decays_as_one_over_distance(self) -> None:
        _, panel, loop = solved()
        magnitudes = []
        for distance in (10.0, 100.0, 1000.0):
            u, v = induced_velocity(panel, np.array([[-distance, 0.0]]), loop)
            magnitudes.append(float(np.hypot(u, v)[0]))
        for near, far in itertools.pairwise(magnitudes):
            assert near / far == pytest.approx(10.0, rel=0.03)

    def test_induced_velocity_approaches_the_point_vortex_limit(self) -> None:
        # A long way out the section looks like a single vortex of strength Gamma = cl / 2.
        _, panel, loop = solved()
        distance = 1000.0
        u, v = induced_velocity(panel, np.array([[-distance, 0.0]]), loop)
        expected = abs(panel.cl) / 2.0 / (2.0 * np.pi * distance)
        assert float(np.hypot(u, v)[0]) == pytest.approx(expected, rel=0.01)

    def test_total_velocity_returns_to_the_freestream(self) -> None:
        _, panel, loop = solved()
        u, v = induced_velocity(panel, np.array([[-1000.0, 0.0]]), loop)
        alpha = np.radians(ALPHA)
        assert float(np.cos(alpha) + u[0]) == pytest.approx(np.cos(alpha), rel=1e-3)
        assert float(np.sin(alpha) + v[0]) == pytest.approx(np.sin(alpha), rel=1e-2)


class TestCirculation:
    def test_the_enclosed_circulation_equals_half_the_lift_coefficient(self) -> None:
        """Kutta-Joukowski, checked by a line integral rather than by the solver's own sum.

        The velocity field is integrated counter-clockwise around a rectangle three chords on a
        side. Positive lift means clockwise circulation about the section, so the integral must
        come out at ``-cl / 2``. This is the sharpest end-to-end check available: it exercises the
        nodal strengths, the analytic panel integrals, the coordinate transforms and the sign
        convention all at once -- and the sign is what caught a genuine inversion, which a
        magnitude-only assertion had passed.
        """
        _, panel, loop = solved()
        half = 3.0
        samples = 2000
        t = np.linspace(-half, half, samples)
        arc = np.linspace(0.0, 2.0 * half, samples)
        edges = (
            (np.column_stack([t, np.full_like(t, -half)]), (1.0, 0.0)),
            (np.column_stack([np.full_like(t, half), t]), (0.0, 1.0)),
            (np.column_stack([t[::-1], np.full_like(t, half)]), (-1.0, 0.0)),
            (np.column_stack([np.full_like(t, -half), t[::-1]]), (0.0, -1.0)),
        )
        total = 0.0
        for points, tangent in edges:
            u, v = induced_velocity(panel, np.ascontiguousarray(points), loop)
            total += float(np.trapezoid(u * tangent[0] + v * tangent[1], arc))
        assert total == pytest.approx(-panel.cl / 2.0, rel=1e-3)

    def test_a_symmetric_section_at_zero_incidence_has_no_circulation(self) -> None:
        _, panel, loop = solved(alpha_deg=0.0)
        u, v = induced_velocity(panel, np.array([[-50.0, 0.0]]), loop)
        # Discretisation leaves a residue of a few parts in a million, not exactly zero.
        assert float(np.hypot(u, v)[0]) < 1e-5


class TestMasking:
    def test_the_body_is_masked_and_nothing_else_is(self) -> None:
        airfoil, panel, _ = solved()
        field = sample_field(airfoil, panel, ALPHA)
        assert field.inside.any(), "the section should cover some grid points"
        assert np.all(np.isnan(field.u[field.inside]))
        assert np.all(np.isfinite(field.u[~field.inside]))
        assert np.all(np.isfinite(field.v[~field.inside]))

    def test_masked_points_lie_within_the_section_envelope(self) -> None:
        airfoil, panel, _ = solved()
        field = sample_field(airfoil, panel, ALPHA)
        mesh_x, mesh_y = np.meshgrid(field.x, field.y)
        assert mesh_x[field.inside].min() >= 0.0
        assert mesh_x[field.inside].max() <= 1.0
        assert np.abs(mesh_y[field.inside]).max() <= 0.07

    def test_the_crossing_test_agrees_with_obvious_cases(self) -> None:
        _, _, loop = solved()
        probes = np.array([[0.5, 0.0], [0.5, 0.5], [-0.5, 0.0], [2.0, 0.0], [0.3, 0.02]])
        np.testing.assert_array_equal(
            points_inside(loop, probes), [True, False, False, False, True]
        )


class TestSymmetry:
    def test_a_symmetric_section_gives_a_symmetric_field(self) -> None:
        airfoil, panel, _ = solved(alpha_deg=0.0)
        field = sample_field(airfoil, panel, 0.0)
        # The grid is symmetric about y = 0, so mirroring must map the field onto itself with u
        # even and v odd.
        np.testing.assert_allclose(field.u, field.u[::-1], atol=1e-9, equal_nan=True)
        np.testing.assert_allclose(field.v, -field.v[::-1], atol=1e-9, equal_nan=True)

    def test_the_section_accelerates_the_flow_over_its_shoulder(self) -> None:
        """Thickness speeds the flow up near the shoulder and the effect decays with distance.

        This is the check that exposed an inverted vortex sign: the far field and the circulation
        magnitude were both right while the near field was slowing the flow down.
        """
        airfoil, panel, _ = solved(alpha_deg=0.0)
        field = sample_field(airfoil, panel, 0.0)
        shoulder = int(np.argmin(np.abs(field.x - 0.3)))
        heights = [int(np.argmin(np.abs(field.y - h))) for h in (0.1, 0.2, 0.5)]
        speeds = [float(field.speed[row, shoulder]) for row in heights]
        assert speeds[0] > 1.1, "flow just above the shoulder must be faster than the freestream"
        assert speeds[0] > speeds[1] > speeds[2] > 1.0, "and the excess must decay with distance"
