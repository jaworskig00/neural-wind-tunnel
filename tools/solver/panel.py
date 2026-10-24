"""Linear-strength vortex panel method for a two-dimensional section.

Inviscid, incompressible potential flow. The section is discretised into ``N`` straight panels
whose vortex strength varies linearly along each panel and is continuous at the nodes, giving
``N + 1`` unknown nodal strengths. ``N`` flow-tangency conditions at the panel control points
plus the Kutta condition -- equal and opposite strength at the two trailing-edge nodes -- close
the system.

The influence coefficients follow the formulation in Kuethe and Chow, *Foundations of
Aerodynamics*, chapter 11, vectorised over both panel indices. It needs the loop ordered so that
``(-sin theta, cos theta)`` is the *outward* normal, which is clockwise traversal.
:mod:`tools.solver.geometry` stores the loop counter-clockwise -- trailing edge, upper surface,
nose, lower surface, trailing edge -- so it is reversed on entry. Pass coordinates in that same
stored orientation; handing this function a clockwise loop silently solves the interior problem
and returns a nearly motionless field.

Two independent lift values are computed: one from the circulation via the Kutta-Joukowski
theorem and one from integrating the surface pressure. They converge toward each other as the
panel count rises, and :mod:`tools.solver.test_panel` asserts both the agreement and its
convergence -- a sign slip anywhere in the assembly breaks that immediately. The same suite
checks the method against the exact solution for a circle, where ``Cp = 1 - 4 sin^2(theta)``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from tools.solver.geometry import Airfoil

Array = NDArray[np.float64]

#: Guards against a degenerate panel. Panels shorter than this relative to the chord are a sign
#: of a broken geometry, not something to work around silently.
MIN_PANEL_LENGTH = 1e-10

#: Chordwise station past which panels are excluded from the force and moment integrals.
#:
#: The same cut-off, for the same reason, as the pressure stations in `tools.solver.solve` and the
#: viscous march in `tools.solver.boundary_layer`: at a sharp trailing edge the inviscid solution is
#: badly conditioned, and the moment integral amplifies it because the lever arm there is three
#: quarters of a chord. Left in, the quarter-chord moment reached -11 770 on 0.87 % of sampled rows.
#: The omitted panels carry little real load on an attached section -- NACA 2412 and 4412 still
#: match
#: their published moments after the change -- and the alternative is publishing nonsense. See
#: ADR-020.
FORCE_INTEGRATION_CUTOFF_X = 0.98


@dataclass(frozen=True)
class PanelSolution:
    """Inviscid solution on the panelled section."""

    alpha_deg: float
    x_control: Array
    """Chordwise position of each panel control point, in solver (clockwise) order."""
    y_control: Array
    """Ordinate of each panel control point, same ordering."""
    panel_angle: Array
    """Panel inclination `theta`, same ordering. The outward normal is `(-sin, cos)`."""
    panel_length: Array
    edge_velocity: Array
    """Tangential velocity at each control point, non-dimensionalised by the freestream."""
    cp: Array
    cl: float
    """From the circulation, via Kutta-Joukowski."""
    cl_pressure: float
    """From integrating the surface pressure. A cross-check on the circulation value."""
    cm_quarter: float
    gamma: Array
    """Nodal vortex strengths, non-dimensionalised by the freestream."""


def _panel_geometry(points: Array) -> tuple[Array, Array, Array, Array]:
    """Control points, panel lengths, panel angles and node coordinates."""
    start = points[:-1]
    end = points[1:]
    delta = end - start
    length = np.hypot(delta[:, 0], delta[:, 1])
    if np.any(length < MIN_PANEL_LENGTH):
        raise ValueError("degenerate panel: two coincident points in the section loop")
    theta = np.arctan2(delta[:, 1], delta[:, 0])
    control = 0.5 * (start + end)
    return control, length, theta, start


def _influence_coefficients(
    control: Array, length: Array, theta: Array, node: Array
) -> tuple[Array, Array]:
    """Normal and tangential influence of each nodal strength on each control point.

    Returns ``(normal, tangential)``, both shaped ``(N, N + 1)``. Index ``[i, j]`` is the
    velocity component induced at control point ``i`` by a unit strength at node ``j``.
    """
    n = length.size

    # Pairwise quantities: row i is the control point, column j the influencing panel.
    dx = control[:, 0][:, None] - node[:, 0][None, :]
    dy = control[:, 1][:, None] - node[:, 1][None, :]
    theta_i = theta[:, None]
    theta_j = theta[None, :]
    s_j = length[None, :]

    a = -dx * np.cos(theta_j) - dy * np.sin(theta_j)
    b = dx**2 + dy**2
    c = np.sin(theta_i - theta_j)
    d = np.cos(theta_i - theta_j)
    e = dx * np.sin(theta_j) - dy * np.cos(theta_j)
    f = np.log1p((s_j**2 + 2.0 * a * s_j) / b)
    g = np.arctan2(e * s_j, b + a * s_j)
    p = dx * np.sin(theta_i - 2.0 * theta_j) + dy * np.cos(theta_i - 2.0 * theta_j)
    q = dx * np.cos(theta_i - 2.0 * theta_j) - dy * np.sin(theta_i - 2.0 * theta_j)

    cn2 = d + 0.5 * q * f / s_j - (a * c + d * e) * g / s_j
    cn1 = 0.5 * d * f + c * g - cn2
    ct2 = c + 0.5 * p * f / s_j + (a * d - c * e) * g / s_j
    ct1 = 0.5 * c * f - d * g - ct2

    # Self-influence: the integrals above are singular on the diagonal and take these limits.
    diagonal = np.arange(n)
    cn1[diagonal, diagonal] = -1.0
    cn2[diagonal, diagonal] = 1.0
    ct1[diagonal, diagonal] = 0.5 * np.pi
    ct2[diagonal, diagonal] = 0.5 * np.pi

    # Fold the per-panel pair of coefficients onto shared nodes.
    normal = np.zeros((n, n + 1))
    tangential = np.zeros((n, n + 1))
    normal[:, :n] += cn1
    normal[:, 1:] += cn2
    tangential[:, :n] += ct1
    tangential[:, 1:] += ct2
    return normal, tangential


def _require_counter_clockwise(points: Array) -> None:
    """Reject a loop wound the wrong way.

    A clockwise loop flips every normal inward, which makes the tangency conditions describe the
    interior problem. That has an almost trivial solution, so the solver would return a
    plausible-looking, nearly motionless field instead of failing. Checked by the shoelace area,
    which is positive for counter-clockwise traversal.
    """
    x, y = points[:, 0], points[:, 1]
    area = 0.5 * float(np.sum(x[:-1] * y[1:] - x[1:] * y[:-1]))
    if area <= 0.0:
        raise ValueError(
            "section loop must be wound counter-clockwise -- trailing edge, upper surface, nose, "
            f"lower surface, trailing edge -- but the signed area is {area:+.4g}"
        )


def solve_inviscid(airfoil: Airfoil, alpha_deg: float) -> PanelSolution:
    """Solve potential flow around ``airfoil`` at ``alpha_deg`` degrees of incidence."""
    _require_counter_clockwise(airfoil.coordinates)
    # Reverse the stored counter-clockwise loop into the clockwise ordering this formulation
    # expects, where (-sin theta, cos theta) points out of the body.
    points = np.ascontiguousarray(airfoil.coordinates[::-1])
    control, length, theta, node = _panel_geometry(points)
    n = length.size

    alpha = np.radians(alpha_deg)
    normal, tangential = _influence_coefficients(control, length, theta, node)

    matrix = np.zeros((n + 1, n + 1))
    matrix[:n] = normal
    # Kutta condition: the strengths at the two trailing-edge nodes cancel.
    matrix[n, 0] = 1.0
    matrix[n, n] = 1.0

    rhs = np.zeros(n + 1)
    rhs[:n] = np.sin(theta - alpha)

    gamma = np.linalg.solve(matrix, rhs)

    edge_velocity = np.cos(theta - alpha) + tangential @ gamma
    cp = 1.0 - edge_velocity**2

    # Kutta-Joukowski on the piecewise-linear circulation distribution. The nodal strengths
    # solved for above are non-dimensionalised by 2*pi*V_inf, which is where that factor comes
    # from; `gamma` is rescaled before it leaves this function so callers see V_inf units.
    gamma = 2.0 * np.pi * gamma
    circulation = float(np.sum(0.5 * (gamma[:-1] + gamma[1:]) * length))
    cl = 2.0 * circulation

    # Pressure integration. (-sin theta, cos theta) is the outward normal in this ordering, so
    # the force coefficient is -sum(cp * n * ds). Panels inside the trailing-edge cut-off only.
    integrate = control[:, 0] <= FORCE_INTEGRATION_CUTOFF_X
    normal_x = -np.sin(theta)
    normal_y = np.cos(theta)
    force_x = -float(np.sum((cp * normal_x * length)[integrate]))
    force_y = -float(np.sum((cp * normal_y * length)[integrate]))
    cl_pressure = force_y * np.cos(alpha) - force_x * np.sin(alpha)

    # Moment about the quarter-chord point. The cross product gives the mathematically
    # positive (counter-clockwise) moment, which with x aft and y up is nose-DOWN, so it is
    # negated to match the aerodynamic convention of positive nose-up.
    lever_x = control[:, 0] - 0.25
    lever_y = control[:, 1]
    moment = cp * (normal_x * lever_y - normal_y * lever_x) * length
    cm_quarter = -float(np.sum(moment[integrate]))

    return PanelSolution(
        alpha_deg=alpha_deg,
        x_control=control[:, 0],
        y_control=control[:, 1],
        panel_angle=theta,
        panel_length=length,
        edge_velocity=edge_velocity,
        cp=cp,
        cl=cl,
        cl_pressure=cl_pressure,
        cm_quarter=cm_quarter,
        gamma=gamma,
    )
