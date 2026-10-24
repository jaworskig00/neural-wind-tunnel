"""The public solver entry point: inviscid pressure plus the viscous boundary layer.

``solve`` takes a section and a flow condition and returns everything the dataset needs for one
row. It is the only function the dataset pipeline calls.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from numpy.typing import NDArray

from tools.solver.boundary_layer import (
    TRAILING_EDGE_CUTOFF_X,
    SurfaceBoundaryLayer,
    SurfaceStatus,
    march_surface,
)
from tools.solver.field import VelocityField, sample_field
from tools.solver.geometry import Airfoil
from tools.solver.panel import PanelSolution, solve_inviscid

Array = NDArray[np.float64]

#: Stations per surface at which pressure is reported; see docs/DATASET-SCHEMA.md section 3.
CP_STATIONS_PER_SURFACE = 64


class SolverStatus(StrEnum):
    """Row status as published in the dataset's ``solver_status`` column."""

    OK = "ok"
    BL_NOT_CONVERGED = "bl_not_converged"
    GEOMETRY_INVALID = "geometry_invalid"


@dataclass(frozen=True)
class SolverResult:
    """One solved flow condition. Maps one-to-one onto a dataset row."""

    status: SolverStatus
    alpha_deg: float
    reynolds: float
    cl: float
    cd: float
    cd_pressure: float
    cd_friction: float
    cm_quarter: float
    cp_upper: Array
    """Pressure coefficient at the 64 upper-surface stations, leading edge first."""
    cp_lower: Array
    x_transition_upper: float
    x_transition_lower: float
    panel: PanelSolution
    upper: SurfaceBoundaryLayer | None
    lower: SurfaceBoundaryLayer | None
    field: VelocityField | None
    """Sampled velocity field, present only when ``with_field`` was requested."""

    @property
    def cp_stations(self) -> Array:
        """The 128 values in dataset column order: upper surface, then lower."""
        return np.concatenate([self.cp_upper, self.cp_lower])


def cp_stations() -> Array:
    """The 64 per-surface station positions from the schema."""
    j = np.arange(CP_STATIONS_PER_SURFACE, dtype=np.float64)
    return 0.5 * (1.0 - np.cos(np.pi * j / (CP_STATIONS_PER_SURFACE - 1)))


def _split_geometric_surfaces(panel: PanelSolution) -> tuple[Array, Array, Array, Array]:
    """Chordwise stations and pressures for the lower and upper surfaces.

    The panel solver works in the order trailing edge, lower surface, nose, upper surface,
    trailing edge, so the nose index splits the two.

    Control points past :data:`TRAILING_EDGE_CUTOFF_X` are dropped. At a sharp trailing edge the
    inviscid edge velocity collapses into the rear stagnation point and the panel solution there is
    badly conditioned -- on a few per cent of sampled sections it produces a pressure coefficient of
    1e15, which is not large, it is meaningless. The boundary layer already stops at the same
    station for the same reason (ADR-015); dropping these points means the interpolation in
    :func:`solve` clamps, holding the last trustworthy value across the final two per cent of chord
    rather than extrapolating a singularity into the dataset. See ADR-018.
    """
    nose = int(np.argmin(panel.x_control))
    lower_x = panel.x_control[: nose + 1][::-1]
    lower_cp = panel.cp[: nose + 1][::-1]
    upper_x = panel.x_control[nose:]
    upper_cp = panel.cp[nose:]

    lower_keep = lower_x <= TRAILING_EDGE_CUTOFF_X
    upper_keep = upper_x <= TRAILING_EDGE_CUTOFF_X
    return lower_x[lower_keep], lower_cp[lower_keep], upper_x[upper_keep], upper_cp[upper_keep]


def _branch_from_stagnation(
    panel: PanelSolution, stagnation: int, forward: bool
) -> tuple[Array, Array, Array]:
    """Arc length, chordwise station and edge-velocity magnitude along one branch.

    ``forward`` walks from the stagnation point toward the end of the panel ordering, which is
    the upper-surface trailing edge; otherwise it walks toward index zero, the lower-surface
    trailing edge.
    """
    indices = (
        np.arange(stagnation, panel.x_control.size) if forward else np.arange(stagnation, -1, -1)
    )
    x = panel.x_control[indices]
    y = panel.y_control[indices]
    step = np.hypot(np.diff(x), np.diff(y))
    s = np.concatenate([[0.0], np.cumsum(step)])
    ue = np.abs(panel.edge_velocity[indices])
    return s, x, ue


def _friction_drag(
    panel: PanelSolution, branches: tuple[SurfaceBoundaryLayer, ...], alpha_deg: float
) -> float:
    """Skin-friction drag from the marched ``cf`` distributions.

    The shear acts along the surface tangent, so only its freestream-aligned component
    contributes. This is an estimate used to split the Squire-Young total into a friction and a
    pressure part for the dataset; the total is the trustworthy number, the split is indicative.
    """
    del panel  # tangent directions come from the branch stations below
    alpha = np.radians(alpha_deg)
    total = 0.0
    for branch in branches:
        if branch.s.size < 2:
            continue
        ds = np.diff(branch.s)
        cf = 0.5 * (branch.cf[1:] + branch.cf[:-1])
        dx = np.diff(branch.x)
        # cos of the angle between the local tangent and the freestream.
        with np.errstate(divide="ignore", invalid="ignore"):
            cosine = np.where(ds > 0.0, dx / ds, 0.0)
        total += float(np.nansum(cf * ds * np.abs(cosine * np.cos(alpha))))
    return total


def solve(
    airfoil: Airfoil,
    alpha_deg: float,
    reynolds: float = 1.0e6,
    *,
    with_field: bool = False,
) -> SolverResult:
    """Solve one section at one flow condition.

    Returns a result whose ``status`` says whether the viscous march succeeded. A result that is
    not ``ok`` carries ``nan`` for the drag so a failed case can never be mistaken for a
    converged one.

    ``with_field`` additionally samples the velocity field on the schema grid, which the dataset
    pipeline needs for the proper orthogonal decomposition. It roughly triples the cost of a
    solve, so it is off by default.
    """
    panel = solve_inviscid(airfoil, alpha_deg)

    lower_x, lower_cp, upper_x, upper_cp = _split_geometric_surfaces(panel)
    stations = cp_stations()
    cp_upper = np.interp(stations, upper_x, upper_cp)
    cp_lower = np.interp(stations, lower_x, lower_cp)

    # The stagnation point is where the surface pressure peaks.
    stagnation = int(np.argmax(panel.cp))
    lower_s, lower_station, lower_ue = _branch_from_stagnation(panel, stagnation, forward=False)
    upper_s, upper_station, upper_ue = _branch_from_stagnation(panel, stagnation, forward=True)

    lower_bl = march_surface(lower_s, lower_station, lower_ue, reynolds)
    upper_bl = march_surface(upper_s, upper_station, upper_ue, reynolds)

    if lower_bl.status is SurfaceStatus.OK and upper_bl.status is SurfaceStatus.OK:
        status = SolverStatus.OK
        cd = lower_bl.cd_squire_young + upper_bl.cd_squire_young
        cd_friction = _friction_drag(panel, (lower_bl, upper_bl), alpha_deg)
        cd_pressure = cd - cd_friction
    else:
        status = SolverStatus.BL_NOT_CONVERGED
        cd = cd_friction = cd_pressure = float("nan")

    return SolverResult(
        status=status,
        alpha_deg=alpha_deg,
        reynolds=reynolds,
        cl=panel.cl,
        cd=cd,
        cd_pressure=cd_pressure,
        cd_friction=cd_friction,
        cm_quarter=panel.cm_quarter,
        cp_upper=cp_upper,
        cp_lower=cp_lower,
        x_transition_upper=upper_bl.transition_x,
        x_transition_lower=lower_bl.transition_x,
        panel=panel,
        upper=upper_bl,
        lower=lower_bl,
        field=sample_field(airfoil, panel, alpha_deg) if with_field else None,
    )
