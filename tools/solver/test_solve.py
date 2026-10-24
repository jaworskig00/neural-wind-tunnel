"""Tests for the combined inviscid-plus-viscous solver entry point."""

import math

import numpy as np
import pytest

from tools.solver.geometry import naca4
from tools.solver.solve import CP_STATIONS_PER_SURFACE, SolverStatus, cp_stations, solve


class TestStations:
    def test_station_grid_matches_the_schema(self) -> None:
        stations = cp_stations()
        assert stations.size == CP_STATIONS_PER_SURFACE
        assert stations[0] == 0.0
        assert stations[-1] == pytest.approx(1.0, abs=1e-12)
        assert np.all(np.diff(stations) > 0)

    def test_pressure_is_reported_at_every_station(self) -> None:
        result = solve(naca4("0012", panel_count=200), 2.0)
        assert result.cp_upper.size == CP_STATIONS_PER_SURFACE
        assert result.cp_lower.size == CP_STATIONS_PER_SURFACE
        assert result.cp_stations.size == 2 * CP_STATIONS_PER_SURFACE
        assert np.all(np.isfinite(result.cp_stations))


class TestConvergedSolutions:
    def test_naca_0012_drag_is_in_the_published_range(self) -> None:
        # Published profile drag for NACA 0012 at Re = 1e6 with free transition is about 0.0055
        # to 0.0060. An uncoupled integral method landing within ten per cent of that is the
        # most this solver claims; see docs/solver-validation.md.
        result = solve(naca4("0012", panel_count=200), 0.0)
        assert result.status is SolverStatus.OK
        assert 0.0050 < result.cd < 0.0070

    def test_drag_rises_with_incidence(self) -> None:
        airfoil = naca4("0012", panel_count=200)
        drags = [solve(airfoil, alpha).cd for alpha in (0.0, 2.0, 4.0, 6.0)]
        assert all(np.diff(drags) > 0)

    def test_the_drag_split_sums_to_the_total(self) -> None:
        result = solve(naca4("0012", panel_count=200), 2.0)
        assert result.cd_friction + result.cd_pressure == pytest.approx(result.cd, rel=1e-12)
        assert result.cd_friction > 0.0
        assert result.cd_pressure > 0.0

    def test_friction_dominates_at_low_incidence(self) -> None:
        result = solve(naca4("0012", panel_count=200), 0.0)
        assert result.cd_friction > result.cd_pressure

    def test_transition_moves_forward_with_incidence_on_the_suction_side(self) -> None:
        airfoil = naca4("0012", panel_count=200)
        stations = [solve(airfoil, alpha).x_transition_upper for alpha in (0.0, 2.0, 4.0, 6.0)]
        assert all(np.diff(stations) < 0)

    def test_transition_moves_aft_on_the_pressure_side(self) -> None:
        airfoil = naca4("0012", panel_count=200)
        stations = [solve(airfoil, alpha).x_transition_lower for alpha in (0.0, 2.0, 4.0)]
        assert all(np.diff(stations) > 0)

    def test_a_symmetric_section_is_symmetric_at_zero_incidence(self) -> None:
        result = solve(naca4("0012", panel_count=200), 0.0)
        np.testing.assert_allclose(result.cp_upper, result.cp_lower, atol=1e-9)
        assert result.x_transition_upper == pytest.approx(result.x_transition_lower, abs=0.03)


class TestFailedSolutions:
    def test_high_incidence_is_reported_as_not_converged(self) -> None:
        result = solve(naca4("0012", panel_count=200), 14.0)
        assert result.status is SolverStatus.BL_NOT_CONVERGED
        assert math.isnan(result.cd)
        assert math.isnan(result.cd_pressure)
        assert math.isnan(result.cd_friction)

    def test_a_failed_row_still_carries_the_inviscid_result(self) -> None:
        # Lift and pressure come from the panel method and stay valid when the march fails.
        result = solve(naca4("0012", panel_count=200), 14.0)
        assert result.cl > 1.0
        assert np.all(np.isfinite(result.cp_stations))


class TestSeparationInducedTransition:
    def test_low_incidence_transitions_naturally(self) -> None:
        result = solve(naca4("0012", panel_count=200), 0.0)
        assert result.upper is not None
        assert not result.upper.separation_induced_transition

    def test_higher_incidence_transitions_through_separation(self) -> None:
        result = solve(naca4("0012", panel_count=200), 5.0)
        assert result.upper is not None
        assert result.upper.separation_induced_transition


class TestPressureIsPhysical:
    """Regression guard for ADR-018.

    The reported stations originally interpolated across the panel control points nearest the sharp
    trailing edge, where the inviscid solution is badly conditioned. On a few per cent of sampled
    sections that produced pressure coefficients of 1e15 in the published dataset — plausible-looking
    columns full of nonsense, which is the worst kind of error this project can ship.
    """

    @staticmethod
    def _sections():
        from tools.dataset.sample import generate_shapes

        shapes, _ = generate_shapes(40)
        return [shape.airfoil for shape in shapes]

    def test_pressure_never_exceeds_stagnation(self) -> None:
        for airfoil in self._sections():
            for alpha in (-6.0, 0.0, 5.0, 10.0):
                stations = solve(airfoil, alpha).cp_stations
                assert stations.max() <= 1.0 + 1e-6, "Cp cannot exceed the stagnation value"

    def test_suction_stays_within_a_physical_bound(self) -> None:
        # A suction peak of -25 already means five times the freestream speed locally. Anything
        # beyond that is the trailing-edge singularity leaking back in.
        for airfoil in self._sections():
            for alpha in (-6.0, 0.0, 5.0, 10.0):
                stations = solve(airfoil, alpha).cp_stations
                assert stations.min() > -25.0, "suction peak is non-physical"

    def test_trailing_edge_stations_are_held_not_extrapolated(self) -> None:
        # The last two per cent of chord takes the value at the cut-off, so the final stations on
        # each surface sit close together rather than diverging.
        result = solve(naca4("2412", panel_count=200), 4.0)
        assert abs(result.cp_upper[-1] - result.cp_upper[-2]) < 0.1
        assert abs(result.cp_lower[-1] - result.cp_lower[-2]) < 0.1


class TestPhysicalPressureGate:
    """ADR-019: an inviscid suction peak beyond the floor invalidates the row, not just the drag."""

    def test_the_floor_is_where_the_measured_tail_thins_out(self) -> None:
        from tools.solver.solve import CP_SUCTION_FLOOR

        assert CP_SUCTION_FLOOR == -25.0

    def test_accepts_an_ordinary_distribution(self) -> None:
        from tools.solver.solve import pressure_is_physical

        assert pressure_is_physical(solve(naca4("2412", panel_count=200), 4.0).cp_stations)

    def test_rejects_a_peak_beyond_the_floor(self) -> None:
        from tools.solver.solve import pressure_is_physical

        stations = np.full(128, -1.0)
        assert pressure_is_physical(stations)
        stations[17] = -25.5
        assert not pressure_is_physical(stations)

    def test_a_rejected_row_reports_geometry_invalid_and_no_drag(self, monkeypatch) -> None:
        import tools.solver.solve as solve_module

        monkeypatch.setattr(solve_module, "CP_SUCTION_FLOOR", 0.0)
        result = solve_module.solve(naca4("2412", panel_count=200), 4.0)
        assert result.status is SolverStatus.GEOMETRY_INVALID
        assert math.isnan(result.cd)
        # The inviscid pressure and lift are still returned; the status says not to trust them.
        assert np.all(np.isfinite(result.cp_stations))
