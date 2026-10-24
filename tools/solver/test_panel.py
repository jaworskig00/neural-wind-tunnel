"""Verification of the inviscid panel method.

The checks here are deliberately ones with an independent truth: an exact analytic solution, a
closed-form result from thin-airfoil theory, an internal consistency identity, or a symmetry.
No digitised reference tables are bundled, so nothing is asserted against a number whose
provenance cannot be stated.
"""

import itertools
import math

import numpy as np
import pytest

from tools.solver.geometry import Airfoil, naca4
from tools.solver.panel import solve_inviscid

TWO_PI = 2.0 * math.pi


def circle(panel_count: int) -> Airfoil:
    """Unit-diameter circle centred at ``x = 0.5``, wound counter-clockwise."""
    t = np.linspace(0.0, TWO_PI, panel_count + 1)
    loop = np.column_stack([0.5 * np.cos(t) + 0.5, 0.5 * np.sin(t)])
    return Airfoil(name="circle", coordinates=np.ascontiguousarray(loop))


def lift_slope(designation: str, panel_count: int = 320) -> float:
    """``dCl/dalpha`` per radian from a small finite difference about zero incidence."""
    airfoil = naca4(designation, panel_count=panel_count)
    low = solve_inviscid(airfoil, -2.0).cl
    high = solve_inviscid(airfoil, 2.0).cl
    return (high - low) / math.radians(4.0)


class TestExactCircle:
    """A circle in potential flow has ``Cp = 1 - 4 sin^2(theta)``, with no lift and no moment."""

    @pytest.mark.parametrize(
        ("panel_count", "tolerance"), [(100, 6e-2), (200, 3e-2), (400, 1.5e-2)]
    )
    def test_pressure_matches_the_closed_form(self, panel_count: int, tolerance: float) -> None:
        solution = solve_inviscid(circle(panel_count), 0.0)
        theta = np.arctan2(solution.y_control, solution.x_control - 0.5)
        exact = 1.0 - 4.0 * np.sin(theta) ** 2
        assert np.abs(solution.cp - exact).max() < tolerance

    def test_error_halves_when_the_panel_count_doubles(self) -> None:
        errors = []
        for panel_count in (100, 200, 400):
            solution = solve_inviscid(circle(panel_count), 0.0)
            theta = np.arctan2(solution.y_control, solution.x_control - 0.5)
            exact = 1.0 - 4.0 * np.sin(theta) ** 2
            errors.append(float(np.sqrt(np.mean((solution.cp - exact) ** 2))))
        # First-order convergence: the control points sit on panel chords, not on the circle.
        for coarse, fine in itertools.pairwise(errors):
            assert 1.8 < coarse / fine < 2.2

    def test_a_closed_body_carries_no_lift_or_moment(self) -> None:
        solution = solve_inviscid(circle(200), 0.0)
        assert abs(solution.cl) < 1e-10
        assert abs(solution.cm_quarter) < 1e-10


class TestThinAirfoilTheory:
    def test_symmetric_section_has_no_lift_at_zero_incidence(self) -> None:
        solution = solve_inviscid(naca4("0012", panel_count=320), 0.0)
        assert abs(solution.cl) < 1e-6
        assert abs(solution.cm_quarter) < 1e-6

    def test_thin_symmetric_lift_slope_is_two_pi(self) -> None:
        # Thickness raises the slope by roughly 0.77 * t/c, so "within 5 % of 2*pi" only holds
        # for a genuinely thin section: NACA 0004 lands 3.3 % high, NACA 0006 already 5.0 %.
        slope = lift_slope("0004")
        assert abs(slope / TWO_PI - 1.0) < 0.05

    def test_lift_slope_rises_with_thickness(self) -> None:
        slopes = [lift_slope(d) for d in ("0006", "0012", "0018")]
        assert slopes[0] < slopes[1] < slopes[2]
        # The classical estimate is 2*pi*(1 + 0.77 t/c); check the trend's magnitude, not a digit.
        for designation, slope in zip(("0006", "0012", "0018"), slopes, strict=True):
            thickness = int(designation[2:]) / 100.0
            assert abs(slope / (TWO_PI * (1.0 + 0.77 * thickness)) - 1.0) < 0.03

    def test_lift_scales_exactly_with_the_sine_of_incidence(self) -> None:
        # The right-hand side is sin(theta - alpha) = sin(theta) cos(alpha) - cos(theta) sin(alpha),
        # so the solution is a combination of a camber part and an incidence part:
        # Cl = A cos(alpha) + B sin(alpha). A symmetric section has A = 0, which makes
        # Cl / sin(alpha) exactly constant -- a much sharper identity than "roughly linear".
        airfoil = naca4("0012", panel_count=320)
        ratios = [
            solve_inviscid(airfoil, alpha).cl / math.sin(math.radians(alpha))
            for alpha in (1.0, 2.0, 4.0, 8.0)
        ]
        np.testing.assert_allclose(ratios, ratios[0], rtol=1e-9)

    def test_camber_shifts_the_zero_lift_angle_negative(self) -> None:
        for designation in ("2412", "4412"):
            assert solve_inviscid(naca4(designation, panel_count=320), 0.0).cl > 0.0

    def test_cambered_sections_pitch_nose_down(self) -> None:
        # Positive camber gives a negative quarter-chord moment, and more camber gives more of it.
        moments = [
            solve_inviscid(naca4(d, panel_count=320), 0.0).cm_quarter for d in ("2412", "4412")
        ]
        assert moments[0] < 0.0
        assert moments[1] < moments[0]


class TestInternalConsistency:
    def test_the_two_lift_routes_agree(self) -> None:
        solution = solve_inviscid(naca4("2412", panel_count=320), 5.0)
        assert abs(solution.cl / solution.cl_pressure - 1.0) < 0.01

    def test_the_two_lift_routes_converge_together(self) -> None:
        gaps = []
        for panel_count in (80, 160, 320):
            solution = solve_inviscid(naca4("2412", panel_count=panel_count), 5.0)
            gaps.append(abs(solution.cl - solution.cl_pressure))
        for coarse, fine in itertools.pairwise(gaps):
            assert 1.7 < coarse / fine < 2.3

    def test_stagnation_pressure_is_reached(self) -> None:
        # Control points straddle the stagnation point, so Cp approaches but never equals 1.
        for alpha in (0.0, 5.0):
            solution = solve_inviscid(naca4("0012", panel_count=320), alpha)
            assert 0.99 < solution.cp.max() <= 1.0

    def test_symmetric_section_has_a_symmetric_pressure_field(self) -> None:
        solution = solve_inviscid(naca4("0012", panel_count=160), 0.0)
        upper = solution.y_control > 0
        lower = solution.y_control < 0
        # The two surfaces are mirror images, so sorting by station must give the same curve.
        upper_cp = solution.cp[upper][np.argsort(solution.x_control[upper])]
        lower_cp = solution.cp[lower][np.argsort(solution.x_control[lower])]
        np.testing.assert_allclose(upper_cp, lower_cp, atol=1e-12)

    def test_suction_peak_moves_forward_with_incidence(self) -> None:
        peaks = []
        for alpha in (0.0, 4.0, 8.0):
            solution = solve_inviscid(naca4("0012", panel_count=320), alpha)
            peaks.append(float(solution.x_control[int(np.argmin(solution.cp))]))
        assert peaks[0] > peaks[1] > peaks[2]


class TestGuards:
    def test_a_clockwise_loop_is_rejected(self) -> None:
        airfoil = naca4("0012")
        reversed_loop = Airfoil(
            name="reversed", coordinates=np.ascontiguousarray(airfoil.coordinates[::-1])
        )
        with pytest.raises(ValueError, match="counter-clockwise"):
            solve_inviscid(reversed_loop, 5.0)

    def test_coincident_points_are_rejected(self) -> None:
        airfoil = naca4("0012")
        broken = airfoil.coordinates.copy()
        broken[5] = broken[4]
        with pytest.raises(ValueError, match="degenerate panel"):
            solve_inviscid(Airfoil(name="broken", coordinates=broken), 0.0)
