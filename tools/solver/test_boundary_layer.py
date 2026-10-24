"""Verification of the integral boundary layer.

As in :mod:`tools.solver.test_panel`, every assertion has a derivable reference: the Blasius
flat-plate solution, the flat-plate turbulent power law, exact inverse-function identities, or
monotonic trends that follow from the physics.
"""

import math

import numpy as np
import pytest

from tools.solver.boundary_layer import (
    LAMINAR_SEPARATION_LAMBDA,
    TURBULENT_SEPARATION_H,
    SurfaceStatus,
    head_h1,
    head_shape_factor,
    ludwieg_tillmann_cf,
    march_surface,
    thwaites_shape_factor,
    thwaites_shear,
)

REYNOLDS = 1.0e6


def flat_plate(points: int = 2001, reynolds: float = REYNOLDS):
    """Zero-pressure-gradient flat plate: constant edge velocity along the chord."""
    s = np.linspace(0.0, 1.0, points)
    return march_surface(s, s.copy(), np.ones_like(s), reynolds)


class TestThwaitesCorrelations:
    def test_zero_gradient_values(self) -> None:
        # Thwaites' tabulated values at lambda = 0.
        assert thwaites_shape_factor(np.array([0.0]))[0] == pytest.approx(2.61)
        assert thwaites_shear(np.array([0.0]))[0] == pytest.approx(0.22)

    def test_shape_factor_rises_under_an_adverse_gradient(self) -> None:
        lam = np.array([0.08, 0.04, 0.0, -0.04, -0.08])
        shape = thwaites_shape_factor(lam)
        assert np.all(np.diff(shape) > 0), "H must grow as the gradient turns adverse"

    def test_shear_falls_under_an_adverse_gradient(self) -> None:
        lam = np.array([0.08, 0.04, 0.0, -0.04, -0.08])
        assert np.all(np.diff(thwaites_shear(lam)) < 0)

    def test_correlations_are_clipped_outside_the_tabulated_range(self) -> None:
        # The adverse fit has a pole at lambda = -0.14; clipping keeps it finite and monotone.
        extreme = thwaites_shape_factor(np.array([-5.0, -0.2, -0.1]))
        assert np.all(np.isfinite(extreme))
        np.testing.assert_allclose(extreme, extreme[0])

    def test_separation_threshold_is_inside_the_tabulated_range(self) -> None:
        assert -0.1 < LAMINAR_SEPARATION_LAMBDA < 0.0


class TestBlasius:
    """Thwaites on a flat plate reproduces Blasius to about one per cent, which is its known
    accuracy: the method gives ``theta = sqrt(0.45) * sqrt(nu x / U)`` against Blasius' 0.664."""

    def test_momentum_thickness_matches_blasius(self) -> None:
        layer = flat_plate()
        nu = 1.0 / REYNOLDS
        for station in (0.1, 0.3, 0.5, 0.9):
            index = int(np.argmin(np.abs(layer.x - station)))
            blasius = 0.664 * math.sqrt(nu * layer.x[index])
            assert layer.theta[index] / blasius == pytest.approx(1.0103, abs=2e-3)

    def test_skin_friction_matches_blasius(self) -> None:
        layer = flat_plate()
        for station in (0.1, 0.3, 0.5):
            index = int(np.argmin(np.abs(layer.x - station)))
            blasius = 0.664 / math.sqrt(REYNOLDS * layer.x[index])
            assert layer.cf[index] == pytest.approx(blasius, rel=0.02)

    def test_thickness_grows_as_the_square_root_of_distance(self) -> None:
        layer = flat_plate()
        near = int(np.argmin(np.abs(layer.x - 0.1)))
        far = int(np.argmin(np.abs(layer.x - 0.4)))
        assert layer.theta[far] / layer.theta[near] == pytest.approx(2.0, rel=0.01)

    def test_a_flat_plate_stays_laminar_at_this_reynolds_number(self) -> None:
        # Michel's criterion puts flat-plate transition near Re_x = 3e6, beyond the chord here.
        layer = flat_plate()
        assert layer.status is SurfaceStatus.OK
        assert layer.transition_x == 1.0
        assert not layer.separation_induced_transition

    def test_transition_appears_once_the_plate_is_long_enough_in_reynolds_number(self) -> None:
        layer = flat_plate(reynolds=1.0e7)
        assert layer.transition_x < 1.0
        assert not layer.separation_induced_transition


class TestHeadsMethod:
    def test_the_shape_factor_relations_are_inverse(self) -> None:
        for shape_factor in (1.3, 1.5, 1.8, 2.2):
            assert head_shape_factor(head_h1(shape_factor)) == pytest.approx(shape_factor, abs=1e-3)

    def test_entrainment_shape_factor_falls_as_the_layer_fills_out(self) -> None:
        assert head_h1(1.3) > head_h1(1.6) > head_h1(2.0)

    def test_skin_friction_falls_with_reynolds_number_and_shape_factor(self) -> None:
        assert ludwieg_tillmann_cf(1.4, 1000.0) > ludwieg_tillmann_cf(1.4, 10000.0)
        assert ludwieg_tillmann_cf(1.4, 1000.0) > ludwieg_tillmann_cf(2.0, 1000.0)
        assert ludwieg_tillmann_cf(1.4, 0.0) == 0.0

    def test_turbulent_plate_thickness_matches_the_power_law(self) -> None:
        # Forced turbulent from the leading edge by running at a Reynolds number where Michel
        # transitions early, then compared with theta/x = 0.036 Re_x^-0.2 downstream.
        layer = flat_plate(reynolds=2.0e7)
        assert layer.transition_x < 0.3
        index = int(np.argmin(np.abs(layer.x - 0.9)))
        power_law = 0.036 * layer.x[index] * (2.0e7 * layer.x[index]) ** -0.2
        assert layer.theta[index] == pytest.approx(power_law, rel=0.35)


class TestAdverseGradient:
    def _decelerating(self, exponent: float, points: int = 1501):
        """A Howarth-like decelerating edge velocity, which drives the layer to separation."""
        s = np.linspace(0.0, 1.0, points)
        return march_surface(s, s.copy(), 1.0 - exponent * s, REYNOLDS)

    def test_a_strong_deceleration_separates(self) -> None:
        layer = self._decelerating(0.9)
        assert (
            layer.status
            in {
                SurfaceStatus.TURBULENT_SEPARATION,
                SurfaceStatus.NOT_CONVERGED,
            }
            or layer.separation_induced_transition
        )

    def test_a_mild_deceleration_survives(self) -> None:
        layer = self._decelerating(0.1)
        assert layer.status is SurfaceStatus.OK
        assert layer.shape_factor_te < TURBULENT_SEPARATION_H

    def test_a_failed_march_reports_no_drag(self) -> None:
        layer = self._decelerating(0.95)
        if layer.status is not SurfaceStatus.OK:
            assert math.isnan(layer.theta_te)
            assert math.isnan(layer.cd_squire_young)


class TestSquireYoung:
    def test_laminar_drag_scales_as_the_inverse_root_of_reynolds_number(self) -> None:
        # Both plates stay laminar -- Michel puts flat-plate transition near Re_x = 1.7e6 -- so
        # theta goes as Re^-0.5 and so does the Squire-Young drag.
        low = flat_plate(reynolds=5.0e5)
        high = flat_plate(reynolds=1.0e6)
        assert low.transition_x == 1.0
        assert high.transition_x == 1.0
        assert low.cd_squire_young / high.cd_squire_young == pytest.approx(math.sqrt(2.0), rel=0.01)

    def test_a_turbulent_layer_drags_more_than_a_laminar_one(self) -> None:
        # Not a Reynolds-number effect: at Re = 1e7 the plate transitions, and the turbulent
        # layer is thicker in absolute terms than the laminar layer at a tenth the speed.
        laminar = flat_plate(reynolds=1.0e6)
        transitioned = flat_plate(reynolds=1.0e7)
        assert laminar.transition_x == 1.0
        assert transitioned.transition_x < 1.0
        assert transitioned.cd_squire_young > laminar.cd_squire_young

    def test_drag_is_positive_and_small_for_a_plate(self) -> None:
        layer = flat_plate()
        assert 0.0 < layer.cd_squire_young < 0.01
