"""Airfoil geometry: NACA 4-digit sections, CST parametrisation and derived metrics.

Conventions, all of which are part of the dataset contract in ``docs/DATASET-SCHEMA.md``:

* Coordinates are non-dimensional with chord ``c = 1``, leading edge at ``x = 0`` and a sharp
  trailing edge at ``x = 1``.
* A section is stored as a closed loop ordered trailing edge -> upper surface -> leading edge ->
  lower surface -> trailing edge, with the first and last point identical. This is XFOIL's
  ordering and the panel method in :mod:`tools.solver.panel` depends on it.
* Panels are cosine-clustered toward both edges, where the pressure gradient is steepest.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

#: Default panel count. 160 panels resolves the suction peak without making the 40 000-case
#: dataset run expensive.
DEFAULT_PANEL_COUNT = 160

#: Number of Bernstein weights per surface in the CST parametrisation.
CST_ORDER = 6

#: Class-function exponents for a round-nosed section with a sharp trailing edge.
CST_N1 = 0.5
CST_N2 = 1.0

Array = NDArray[np.float64]


def cosine_spacing(count: int) -> Array:
    """``count`` chordwise stations clustered toward ``x = 0`` and ``x = 1``.

    psi_j = 0.5 * (1 - cos(pi * j / (count - 1)))
    """
    if count < 2:
        raise ValueError(f"need at least two stations, got {count}")
    j = np.arange(count, dtype=np.float64)
    return 0.5 * (1.0 - np.cos(np.pi * j / (count - 1)))


def bernstein_basis(psi: Array) -> Array:
    """Bernstein polynomials of order ``CST_ORDER - 1`` evaluated at ``psi``.

    Returns an array shaped ``(len(psi), CST_ORDER)`` so that a surface is a matrix product
    with the weight vector, which is also what the least-squares fit in :func:`fit_cst` needs.
    """
    from math import comb

    n = CST_ORDER - 1
    psi = np.asarray(psi, dtype=np.float64)
    out = np.empty((psi.size, CST_ORDER), dtype=np.float64)
    for i in range(CST_ORDER):
        out[:, i] = comb(n, i) * psi**i * (1.0 - psi) ** (n - i)
    return out


def class_function(psi: Array) -> Array:
    """``C(psi) = psi**N1 * (1 - psi)**N2``: the round nose and sharp tail."""
    psi = np.asarray(psi, dtype=np.float64)
    return psi**CST_N1 * (1.0 - psi) ** CST_N2


def cst_surface(weights: Array, psi: Array) -> Array:
    """Surface ordinate ``z(psi)`` for one surface of a CST section.

    ``z = C(psi) * S(psi)`` with ``S`` the Bernstein expansion of ``weights``. The trailing-edge
    thickness term is omitted because the dataset uses sharp trailing edges throughout.
    """
    weights = np.asarray(weights, dtype=np.float64)
    if weights.shape != (CST_ORDER,):
        raise ValueError(f"expected {CST_ORDER} weights, got {weights.shape}")
    return class_function(psi) * (bernstein_basis(psi) @ weights)


def cst_leading_edge_radius(first_weight: float) -> float:
    """Leading-edge radius over chord.

    With ``N1 = 0.5`` the surface behaves as ``z ~ A_0 * sqrt(psi)`` at the nose, and a parabola
    ``z^2 = 2 r x`` gives ``r = A_0^2 / 2`` directly.
    """
    return 0.5 * float(first_weight) ** 2


@dataclass(frozen=True)
class Airfoil:
    """A section as a closed coordinate loop, plus the parameters it came from."""

    name: str
    coordinates: Array
    """``(n_panels + 1, 2)`` loop, trailing edge -> upper -> leading edge -> lower -> trailing
    edge, first point repeated at the end."""

    @property
    def panel_count(self) -> int:
        return self.coordinates.shape[0] - 1

    def surfaces(self) -> tuple[Array, Array]:
        """Upper and lower surfaces as ``(m, 2)`` arrays ordered leading edge to trailing edge."""
        x = self.coordinates[:, 0]
        nose = int(np.argmin(x))
        upper = self.coordinates[: nose + 1][::-1]
        lower = self.coordinates[nose:]
        return upper, lower


def _close_loop(upper: Array, lower: Array) -> Array:
    """Join leading-edge-first surfaces into the stored loop ordering."""
    # Upper reversed gives trailing edge -> leading edge; the lower surface then runs back out,
    # skipping the duplicated nose point.
    return np.vstack([upper[::-1], lower[1:]])


def naca4(designation: str, panel_count: int = DEFAULT_PANEL_COUNT) -> Airfoil:
    """A NACA four-digit section with a sharp trailing edge.

    The thickness distribution is the standard polynomial with the last coefficient set to
    ``-0.1036`` instead of ``-0.1015``, which closes the trailing edge exactly. Camber follows
    the two-segment parabola of the original definition.
    """
    if len(designation) != 4 or not designation.isdigit():
        raise ValueError(f"expected four digits, got {designation!r}")
    if panel_count % 2 != 0:
        raise ValueError(f"panel count must be even, got {panel_count}")

    max_camber = int(designation[0]) / 100.0
    camber_position = int(designation[1]) / 10.0
    thickness = int(designation[2:]) / 100.0

    x = cosine_spacing(panel_count // 2 + 1)

    half_thickness = (
        5.0
        * thickness
        * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 + 0.2843 * x**3 - 0.1036 * x**4)
    )

    if max_camber == 0.0 or camber_position == 0.0:
        camber = np.zeros_like(x)
        camber_slope = np.zeros_like(x)
    else:
        p, m = camber_position, max_camber
        fore = x < p
        camber = np.where(
            fore,
            m / p**2 * (2 * p * x - x**2),
            m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x**2),
        )
        camber_slope = np.where(
            fore,
            2 * m / p**2 * (p - x),
            2 * m / (1 - p) ** 2 * (p - x),
        )

    theta = np.arctan(camber_slope)
    upper = np.column_stack(
        [x - half_thickness * np.sin(theta), camber + half_thickness * np.cos(theta)]
    )
    lower = np.column_stack(
        [x + half_thickness * np.sin(theta), camber - half_thickness * np.cos(theta)]
    )
    # Force exact closure; the thickness polynomial leaves a rounding residue at both ends.
    upper[0] = lower[0] = [0.0, float(camber[0])]
    upper[-1] = lower[-1] = [1.0, float(camber[-1])]

    return Airfoil(name=f"NACA {designation}", coordinates=_close_loop(upper, lower))


def cst(
    upper_weights: Array, lower_weights: Array, panel_count: int = DEFAULT_PANEL_COUNT
) -> Airfoil:
    """A section from twelve CST weights, six per surface."""
    if panel_count % 2 != 0:
        raise ValueError(f"panel count must be even, got {panel_count}")

    psi = cosine_spacing(panel_count // 2 + 1)
    upper = np.column_stack([psi, cst_surface(np.asarray(upper_weights), psi)])
    lower = np.column_stack([psi, cst_surface(np.asarray(lower_weights), psi)])
    upper[0] = lower[0] = [0.0, 0.0]
    upper[-1] = lower[-1] = [1.0, 0.0]

    return Airfoil(name="CST", coordinates=_close_loop(upper, lower))


def fit_cst(airfoil: Airfoil) -> tuple[Array, Array]:
    """Least-squares CST weights for an existing section.

    ``z = C(psi) * (B(psi) @ A)`` is linear in the weights, so each surface is one least-squares
    solve. The endpoints are excluded because ``C`` vanishes there and carries no information.
    Used to express a NACA section in the dataset's own parametrisation, and to accept uploaded
    coordinates later.
    """
    weights: list[Array] = []
    for surface in airfoil.surfaces():
        psi, z = surface[:, 0], surface[:, 1]
        interior = (psi > 1e-9) & (psi < 1.0 - 1e-9)
        design = class_function(psi[interior])[:, None] * bernstein_basis(psi[interior])
        solution, *_ = np.linalg.lstsq(design, z[interior], rcond=None)
        weights.append(solution)
    return weights[0], weights[1]


@dataclass(frozen=True)
class GeometryMetrics:
    """Derived geometry columns of the dataset."""

    thickness_max: float
    thickness_max_x: float
    camber_max: float
    camber_max_x: float
    le_radius: float
    area: float


def _refine_extremum(x: Array, y: Array, index: int) -> tuple[float, float]:
    """Parabolic refinement of a discrete extremum.

    Fits a parabola through the sample at ``index`` and its two neighbours and returns the
    vertex, so a maximum that falls between samples is not reported at a grid point. Flat
    regions -- which a cosine grid produces around the thickness peak -- would otherwise make
    the reported station jump around.
    """
    if index <= 0 or index >= x.size - 1:
        return float(y[index]), float(x[index])

    x0, x1, x2 = x[index - 1], x[index], x[index + 1]
    y0, y1, y2 = y[index - 1], y[index], y[index + 1]
    denominator = (x0 - x1) * (x0 - x2) * (x1 - x2)
    if denominator == 0.0:
        return float(y[index]), float(x[index])

    a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denominator
    b = (x2**2 * (y0 - y1) + x1**2 * (y2 - y0) + x0**2 * (y1 - y2)) / denominator
    if a == 0.0:
        return float(y[index]), float(x[index])

    vertex = -b / (2.0 * a)
    if not (x0 <= vertex <= x2):
        return float(y[index]), float(x[index])

    c = (
        x1 * x2 * (x1 - x2) * y0 + x2 * x0 * (x2 - x0) * y1 + x0 * x1 * (x0 - x1) * y2
    ) / denominator
    return float(a * vertex**2 + b * vertex + c), float(vertex)


def geometry_metrics(
    airfoil: Airfoil, samples: int = 2001, le_radius: float | None = None
) -> GeometryMetrics:
    """Thickness, camber, leading-edge radius and enclosed area.

    Both surfaces are interpolated onto a common fine chordwise grid first, because a cambered
    section has different ``x`` on the two surfaces at the same panel index. The extrema are then
    refined with a parabola through the three samples around the discrete maximum, so the
    reported station is not quantised to the sample grid.

    ``le_radius`` should be passed whenever the parametrisation gives it in closed form -- for a
    CST section that is :func:`cst_leading_edge_radius`, and for a NACA four-digit section it is
    ``1.1019 * t**2``. Every dataset row takes that route. Without it the radius falls back to a
    least-squares fit of ``z**2 = 2 r x`` over the first two per cent of chord, which reads about
    10 % low on a symmetric section and worse on a strongly cambered one, because thickness is
    applied perpendicular to the camber line rather than vertically. See ADR-013.
    """
    upper, lower = airfoil.surfaces()
    x = cosine_spacing(samples)
    z_upper = np.interp(x, upper[:, 0], upper[:, 1])
    z_lower = np.interp(x, lower[:, 0], lower[:, 1])

    thickness = z_upper - z_lower
    camber = 0.5 * (z_upper + z_lower)

    thickness_peak, thickness_at = _refine_extremum(x, thickness, int(np.argmax(thickness)))
    camber_peak, camber_at = _refine_extremum(x, camber, int(np.argmax(np.abs(camber))))

    if le_radius is None:
        nose = (x > 1e-6) & (x < 0.02)
        half = 0.5 * thickness[nose]
        # Least squares on z^2 = 2 r x through the origin.
        le_radius = float(np.sum(x[nose] * half**2) / (2.0 * np.sum(x[nose] ** 2)))

    return GeometryMetrics(
        thickness_max=thickness_peak,
        thickness_max_x=thickness_at,
        camber_max=camber_peak,
        camber_max_x=camber_at,
        le_radius=float(le_radius),
        area=float(np.trapezoid(thickness, x)),
    )
