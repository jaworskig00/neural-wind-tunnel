"""Shape sampling over the CST design space.

A scrambled Sobol sequence covers the thirteen-dimensional space of twelve CST weights plus
incidence far more evenly than independent uniform draws, which matters because the surrogate has
to interpolate across it. Samples that do not describe a usable aerofoil are rejected before any
solving happens; the rejection rate is reported so the bounds can be judged rather than guessed
at.

Bounds and filters are the ones published in ``docs/DATASET-SCHEMA.md`` section 2.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from scipy.stats import qmc

from tools.solver.geometry import (
    CST_ORDER,
    Airfoil,
    GeometryMetrics,
    cst,
    cst_leading_edge_radius,
    geometry_metrics,
)

Array = NDArray[np.float64]

#: Per-weight sampling bounds, upper surface then lower; see docs/DATASET-SCHEMA.md section 2.
UPPER_BOUNDS = ((0.08, 0.30), (0.00, 0.40), (0.00, 0.40), (0.00, 0.40), (0.00, 0.40), (0.00, 0.30))
LOWER_BOUNDS = (
    (-0.30, -0.05),
    (-0.40, 0.15),
    (-0.40, 0.15),
    (-0.40, 0.15),
    (-0.40, 0.15),
    (-0.25, 0.20),
)
#: Measured against the solver's convergence, not guessed: the viscous march converges for
#: 90 % of sampled shapes at zero incidence, 45 % at six degrees, 15 % at ten and essentially
#: none at fourteen. Sampling past ten degrees would spend compute on rows that fail and leave
#: coverage too thin to train on. See ADR-016.
ALPHA_BOUNDS = (-6.0, 10.0)

#: Validity filters.
THICKNESS_BOUNDS = (0.06, 0.20)
LE_RADIUS_BOUNDS = (0.002, 0.05)

#: Angles of attack solved per accepted shape. Sharing a shape across several incidences cuts the
#: geometry cost and gives the surrogate the incidence sweep it needs to learn a lift curve.
ALPHAS_PER_SHAPE = 8


@dataclass(frozen=True)
class Shape:
    """One accepted geometry and everything derived from it."""

    shape_id: int
    upper_weights: Array
    lower_weights: Array
    airfoil: Airfoil
    metrics: GeometryMetrics


class RejectionReason:
    """Why a sampled point was discarded. Counted, not raised."""

    SURFACES_CROSS = "surfaces_cross"
    THICKNESS_OUT_OF_RANGE = "thickness_out_of_range"
    LE_RADIUS_OUT_OF_RANGE = "le_radius_out_of_range"
    NON_POSITIVE_AREA = "non_positive_area"


def _bounds_arrays() -> tuple[Array, Array]:
    lower = np.array([b[0] for b in (*UPPER_BOUNDS, *LOWER_BOUNDS)], dtype=np.float64)
    upper = np.array([b[1] for b in (*UPPER_BOUNDS, *LOWER_BOUNDS)], dtype=np.float64)
    return lower, upper


def sobol_weights(count: int, seed: int) -> Array:
    """``count`` by 12 array of CST weights from a scrambled Sobol sequence."""
    sampler = qmc.Sobol(d=2 * CST_ORDER, scramble=True, seed=seed)
    unit = sampler.random(count)
    low, high = _bounds_arrays()
    return low + unit * (high - low)


def surfaces_cross(upper_weights: Array, lower_weights: Array, samples: int = 200) -> bool:
    """True when the two surfaces touch or cross anywhere strictly inside the chord."""
    from tools.solver.geometry import cst_surface

    psi = np.linspace(0.0, 1.0, samples + 2)[1:-1]
    thickness = cst_surface(upper_weights, psi) - cst_surface(lower_weights, psi)
    return bool(np.any(thickness <= 0.0))


def accept(upper_weights: Array, lower_weights: Array) -> tuple[Shape | None, str | None]:
    """Build a shape, or say why it was rejected.

    Returns ``(shape, None)`` on acceptance and ``(None, reason)`` otherwise. ``shape_id`` is left
    at zero; :func:`generate_shapes` assigns it.
    """
    if surfaces_cross(upper_weights, lower_weights):
        return None, RejectionReason.SURFACES_CROSS

    airfoil = cst(upper_weights, lower_weights)
    le_radius = cst_leading_edge_radius(float(upper_weights[0]))
    metrics = geometry_metrics(airfoil, le_radius=le_radius)

    if not THICKNESS_BOUNDS[0] <= metrics.thickness_max <= THICKNESS_BOUNDS[1]:
        return None, RejectionReason.THICKNESS_OUT_OF_RANGE
    if not LE_RADIUS_BOUNDS[0] <= metrics.le_radius <= LE_RADIUS_BOUNDS[1]:
        return None, RejectionReason.LE_RADIUS_OUT_OF_RANGE
    if metrics.area <= 0.0:
        return None, RejectionReason.NON_POSITIVE_AREA

    return (
        Shape(
            shape_id=0,
            upper_weights=np.asarray(upper_weights, dtype=np.float64),
            lower_weights=np.asarray(lower_weights, dtype=np.float64),
            airfoil=airfoil,
            metrics=metrics,
        ),
        None,
    )


def generate_shapes(count: int, seed: int = 20261024) -> tuple[list[Shape], dict[str, int]]:
    """Accept ``count`` shapes, returning them with a tally of why candidates were rejected.

    The Sobol sequence is drawn in powers-of-two blocks, which is what keeps its balance
    properties, and extended until enough candidates have been accepted.
    """
    accepted: list[Shape] = []
    rejected: dict[str, int] = {}
    block = max(1024, 1 << int(np.ceil(np.log2(max(count, 1)))))
    drawn = 0

    while len(accepted) < count:
        weights = sobol_weights(block, seed=seed + drawn)
        drawn += block
        for row in weights:
            if len(accepted) >= count:
                break
            shape, reason = accept(row[:CST_ORDER], row[CST_ORDER:])
            if shape is None:
                rejected[reason] = rejected.get(reason, 0) + 1
                continue
            accepted.append(
                Shape(
                    shape_id=len(accepted),
                    upper_weights=shape.upper_weights,
                    lower_weights=shape.lower_weights,
                    airfoil=shape.airfoil,
                    metrics=shape.metrics,
                )
            )

    return accepted, rejected


def alphas_for_shape(shape_id: int, seed: int = 20261024) -> Array:
    """Incidences to solve for one shape.

    A stratified draw: the range is divided into equal bins and one angle is drawn inside each, so
    every shape covers the whole range without every shape sharing the same grid of angles.
    """
    rng = np.random.default_rng(seed + shape_id)
    edges = np.linspace(ALPHA_BOUNDS[0], ALPHA_BOUNDS[1], ALPHAS_PER_SHAPE + 1)
    return edges[:-1] + rng.random(ALPHAS_PER_SHAPE) * np.diff(edges)
