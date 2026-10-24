"""Velocity field sampling on the fixed grid the browser's reduced-order model reconstructs.

The panel solution gives nodal vortex strengths; this module evaluates the velocity those
strengths induce anywhere in the plane, and samples it on the grid declared in
``docs/DATASET-SCHEMA.md`` section 4.

For one panel running from local ``(0, 0)`` to ``(S, 0)`` with strength varying linearly from
``gamma_1`` to ``gamma_2``, write ``gamma(xi) = a + b * xi`` with ``a = gamma_1`` and
``b = (gamma_2 - gamma_1) / S``. A sheet element induces

    du = -gamma(xi) d_xi / (2 pi) * y / ((x - xi)^2 + y^2)
    dv = +gamma(xi) d_xi / (2 pi) * (x - xi) / ((x - xi)^2 + y^2)

and integrating over the panel gives, with ``r1`` and ``r2`` the distances to the two nodes and
``theta1``, ``theta2`` the angles they subtend,

    u = -1/(2 pi) * [ a (theta2 - theta1) + b ( x (theta2 - theta1) - y ln(r1/r2) ) ]
    v = +1/(2 pi) * [ a ln(r1/r2) + b ( x ln(r1/r2) - S + y (theta2 - theta1) ) ]

Both expressions are free of the ``1/y`` that appears in the intermediate integrals, so they are
evaluated directly rather than special-cased near the panel line.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from tools.solver.geometry import Airfoil
from tools.solver.panel import PanelSolution

Array = NDArray[np.float64]

#: Grid declared in docs/DATASET-SCHEMA.md section 4. Changing any of these is a schema change.
GRID_NX = 192
GRID_NY = 96
GRID_X_RANGE = (-1.0, 2.0)
GRID_Y_RANGE = (-0.75, 0.75)

#: Field points evaluated per chunk. The influence evaluation builds a dense points-by-panels
#: array, so the whole 192x96 grid against 160 panels would allocate several hundred megabytes of
#: intermediates at once -- fine alone, ruinous across the dataset run's worker processes.
FIELD_CHUNK = 2048


@dataclass(frozen=True)
class VelocityField:
    """Sampled velocity on the fixed grid, with the body masked out."""

    x: Array
    """Grid abscissae, shape ``(GRID_NX,)``."""
    y: Array
    """Grid ordinates, shape ``(GRID_NY,)``."""
    u: Array
    """Streamwise component, shape ``(GRID_NY, GRID_NX)``, row-major with ``y`` outermost."""
    v: Array
    inside: NDArray[np.bool_]
    """True where the point lies inside the section and the velocity is not meaningful."""

    @property
    def speed(self) -> Array:
        return np.hypot(self.u, self.v)


def grid_coordinates() -> tuple[Array, Array]:
    """The schema's grid abscissae and ordinates."""
    x = np.linspace(GRID_X_RANGE[0], GRID_X_RANGE[1], GRID_NX)
    y = np.linspace(GRID_Y_RANGE[0], GRID_Y_RANGE[1], GRID_NY)
    return x, y


def induced_velocity(
    panel: PanelSolution, points: Array, coordinates: Array
) -> tuple[Array, Array]:
    """Velocity induced at ``points`` by the panel distribution, excluding the freestream.

    ``points`` is ``(m, 2)``. ``coordinates`` is the section loop in the panel solver's own
    ordering, which :func:`sample_field` takes from the same place the solution came from.
    """
    start = coordinates[:-1]
    end = coordinates[1:]
    delta = end - start
    length = np.hypot(delta[:, 0], delta[:, 1])
    angle = np.arctan2(delta[:, 1], delta[:, 0])

    # The panel solver's nodal strengths follow Kuethe and Chow's rotational convention, which is
    # opposite to the point-vortex convention the integrals above are derived in: there, a
    # positive vortex turns counter-clockwise. Negating here makes positive lift correspond to
    # clockwise circulation, which is what test_field asserts with a signed line integral. The
    # formulae themselves are exact -- they match direct quadrature of point vortices to six
    # decimals -- so this sign is the only place the two conventions meet.
    gamma_1 = -panel.gamma[:-1]
    gamma_2 = -panel.gamma[1:]
    a = gamma_1
    b = (gamma_2 - gamma_1) / length

    # Field points in each panel's local frame: rows are points, columns are panels.
    offset_x = points[:, 0][:, None] - start[:, 0][None, :]
    offset_y = points[:, 1][:, None] - start[:, 1][None, :]
    cos_angle = np.cos(angle)[None, :]
    sin_angle = np.sin(angle)[None, :]
    local_x = offset_x * cos_angle + offset_y * sin_angle
    local_y = -offset_x * sin_angle + offset_y * cos_angle

    r1_squared = local_x**2 + local_y**2
    r2_squared = (local_x - length[None, :]) ** 2 + local_y**2
    # A field point sitting exactly on a node would give log(0); nudge it instead of masking,
    # since the grid can coincide with a node and the body is masked separately anyway.
    tiny = 1e-24
    log_ratio = 0.5 * np.log(np.maximum(r1_squared, tiny) / np.maximum(r2_squared, tiny))
    subtended = np.arctan2(local_y, local_x - length[None, :]) - np.arctan2(local_y, local_x)

    local_u = -(a * subtended + b * (local_x * subtended - local_y * log_ratio)) / (2.0 * np.pi)
    local_v = (
        a * log_ratio + b * (local_x * log_ratio - length[None, :] + local_y * subtended)
    ) / (2.0 * np.pi)

    # Rotate each panel's contribution back into global axes and sum.
    u = np.sum(local_u * cos_angle - local_v * sin_angle, axis=1)
    v = np.sum(local_u * sin_angle + local_v * cos_angle, axis=1)
    return u, v


def points_inside(coordinates: Array, points: Array) -> NDArray[np.bool_]:
    """Vectorised crossing-number test against the closed section loop."""
    x = points[:, 0][:, None]
    y = points[:, 1][:, None]
    x1 = coordinates[:-1, 0][None, :]
    y1 = coordinates[:-1, 1][None, :]
    x2 = coordinates[1:, 0][None, :]
    y2 = coordinates[1:, 1][None, :]

    straddles = (y1 > y) != (y2 > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        crossing_x = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
    crossings = straddles & (x < crossing_x)
    return np.sum(crossings, axis=1) % 2 == 1


def sample_field(airfoil: Airfoil, panel: PanelSolution, alpha_deg: float) -> VelocityField:
    """Sample the total velocity on the schema grid.

    The section loop is reversed here for the same reason :func:`tools.solver.panel.solve_inviscid`
    reverses it: the nodal strengths in ``panel.gamma`` are indexed in the solver's ordering, and
    the geometry has to match them.
    """
    coordinates = np.ascontiguousarray(airfoil.coordinates[::-1])
    x, y = grid_coordinates()
    mesh_x, mesh_y = np.meshgrid(x, y)
    points = np.column_stack([mesh_x.ravel(), mesh_y.ravel()])

    induced_u = np.empty(points.shape[0])
    induced_v = np.empty(points.shape[0])
    for begin in range(0, points.shape[0], FIELD_CHUNK):
        end = begin + FIELD_CHUNK
        chunk = np.ascontiguousarray(points[begin:end])
        induced_u[begin:end], induced_v[begin:end] = induced_velocity(panel, chunk, coordinates)

    alpha = np.radians(alpha_deg)
    total_u = np.cos(alpha) + induced_u
    total_v = np.sin(alpha) + induced_v

    inside = points_inside(coordinates, points)
    total_u[inside] = np.nan
    total_v[inside] = np.nan

    shape = (GRID_NY, GRID_NX)
    return VelocityField(
        x=x,
        y=y,
        u=total_u.reshape(shape),
        v=total_v.reshape(shape),
        inside=inside.reshape(shape),
    )
