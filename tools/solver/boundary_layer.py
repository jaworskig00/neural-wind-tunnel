"""Integral boundary layer: Thwaites, Michel transition, Head's method, Squire-Young drag.

Marching from the stagnation point along each surface in turn:

1. **Laminar.** Thwaites' one-parameter method. With ``theta`` the momentum thickness and
   ``nu`` the kinematic viscosity,

       theta^2(s) = 0.45 * nu / Ue(s)^6 * integral of Ue^5 ds

   and the local pressure-gradient parameter ``lambda = theta^2/nu * dUe/ds`` closes the shape
   factor and the skin friction through the standard correlations. Laminar separation is
   declared at ``lambda = -0.09``.

2. **Transition.** Michel's criterion: transition where the momentum-thickness Reynolds number
   reaches ``1.174 * (1 + 22400/Re_s) * Re_s**0.46``.

3. **Turbulent.** Head's entrainment method, two coupled ordinary differential equations in
   ``theta`` and the entrainment shape factor ``H1``, with the Ludwieg-Tillmann skin-friction
   law. Turbulent separation is declared at ``H = 2.4``.

4. **Drag.** The Squire-Young formula applied at the trailing edge of each surface,

       cd = 2 * theta_te * Ue_te ** ((H_te + 5) / 2)

   summed over both surfaces.

What this cannot do, stated plainly because the surrogate inherits every one of these limits:
there is no separated-flow model, so anything past the separation flag is reported as a failure
rather than extrapolated; there is no transitional region, transition is a point; there is no
compressibility; and the laminar correlations are least reliable very close to the stagnation
point, where the method starts.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from numpy.typing import NDArray

Array = NDArray[np.float64]

#: Thwaites' laminar separation threshold for the pressure-gradient parameter.
LAMINAR_SEPARATION_LAMBDA = -0.09

#: Shape factor at which Head's method is taken to have separated.
TURBULENT_SEPARATION_H = 2.4

#: Michel's criterion is calibrated for this range of length Reynolds numbers.
MICHEL_RE_MIN = 1.0e5

#: The march stops here. At a sharp trailing edge the inviscid edge velocity collapses toward
#: the rear stagnation point, which drives the momentum equation's pressure-gradient term to
#: infinity. An uncoupled integral method cannot represent that; a viscous-inviscid coupled one
#: would. Squire-Young is evaluated at this station instead, and the remaining 2 % of chord
#: contributes a fraction of a percent of the drag.
TRAILING_EDGE_CUTOFF_X = 0.98

#: Momentum thickness beyond which the march is declared divergent.
#:
#: Forward Euler on the momentum equation can run away before the shape factor reaches the
#: separation threshold, and the result is a Squire-Young drag of any magnitude at all -- one
#: sampled row reached 2.2e9 while still being reported as converged. A momentum thickness above a
#: twentieth of the chord at Reynolds one million is not attached flow by any reading, so it is
#: treated as a failed march rather than a number. See ADR-020.
MAX_MOMENTUM_THICKNESS = 0.05

#: Laminar separation is not looked for inside this arc length. The first panels after the
#: stagnation point have unreliable velocity gradients on a cosine-clustered grid, and Thwaites'
#: similarity start is only valid a little downstream.
STAGNATION_GUARD_S = 0.005


class SurfaceStatus(StrEnum):
    """Outcome of the march along one surface."""

    OK = "ok"
    LAMINAR_SEPARATION = "laminar_separation"
    TURBULENT_SEPARATION = "turbulent_separation"
    NOT_CONVERGED = "not_converged"


@dataclass(frozen=True)
class SurfaceBoundaryLayer:
    """Boundary-layer march along one surface, stagnation point to trailing edge."""

    status: SurfaceStatus
    s: Array
    """Arc length from the stagnation point."""
    x: Array
    theta: Array
    shape_factor: Array
    cf: Array
    transition_x: float
    """Chordwise station where transition was declared, or 1.0 if the surface stayed laminar."""
    separation_induced_transition: bool
    """True when transition was triggered by laminar separation rather than Michel's criterion."""
    separation_x: float
    """Chordwise station where separation was declared, or NaN if it did not."""
    theta_te: float
    shape_factor_te: float
    edge_velocity_te: float

    @property
    def cd_squire_young(self) -> float:
        """Profile drag contribution of this surface."""
        if not np.isfinite(self.theta_te) or self.theta_te <= 0.0:
            return float("nan")
        exponent = 0.5 * (self.shape_factor_te + 5.0)
        return 2.0 * self.theta_te * self.edge_velocity_te**exponent


def thwaites_shape_factor(lam: Array) -> Array:
    """Shape factor ``H`` from the Thwaites correlation.

    ``lambda`` is clipped into ``[-0.1, 0.1]``, the range Thwaites tabulated. Outside it the
    adverse-gradient fit has a pole at ``lambda = -0.14`` and returns nonsense; separation is
    detected on the unclipped value before these correlations are consulted.
    """
    lam = np.clip(np.asarray(lam, dtype=np.float64), -0.1, 0.1)
    favourable = lam >= 0.0
    # Cebeci and Bradshaw's piecewise fit to Thwaites' tabulated data.
    positive = 2.61 - 3.75 * lam + 5.24 * lam**2
    adverse = 2.088 + 0.0731 / (np.where(favourable, 1.0, lam) + 0.14)
    return np.where(favourable, positive, adverse)


def thwaites_shear(lam: Array) -> Array:
    """Shear correlation ``l(lambda) = tau * theta / (mu * Ue)``, clipped as above."""
    lam = np.clip(np.asarray(lam, dtype=np.float64), -0.1, 0.1)
    favourable = lam >= 0.0
    positive = 0.22 + 1.57 * lam - 1.8 * lam**2
    safe = np.where(favourable, 1.0, lam)
    adverse = 0.22 + 1.402 * lam + (0.018 * lam) / (safe + 0.107)
    return np.where(favourable, positive, adverse)


def head_h1(shape_factor: float) -> float:
    """Entrainment shape factor ``H1`` from ``H``."""
    if shape_factor <= 1.1:
        shape_factor = 1.1 + 1e-6
    if shape_factor <= 1.6:
        return 3.3 + 0.8234 * (shape_factor - 1.1) ** -1.287
    return 3.3 + 1.5501 * (shape_factor - 0.6778) ** -3.064


def head_shape_factor(h1: float) -> float:
    """``H`` from the entrainment shape factor ``H1``, the inverse of :func:`head_h1`."""
    if h1 <= 3.3:
        return TURBULENT_SEPARATION_H
    if h1 < 5.3:
        return 0.6778 + 1.1538 * (h1 - 3.3) ** -0.326
    return 1.1 + 0.86 * (h1 - 3.3) ** -0.777


def ludwieg_tillmann_cf(shape_factor: float, re_theta: float) -> float:
    """Turbulent skin friction from the Ludwieg-Tillmann correlation."""
    if re_theta <= 0.0:
        return 0.0
    return 0.246 * re_theta**-0.268 * 10.0 ** (-0.678 * shape_factor)


def _michel_transition_index(s: Array, theta: Array, reynolds: float) -> int | None:
    """First index where Michel's criterion is met, or ``None``."""
    re_s = reynolds * s
    re_theta = reynolds * theta
    usable = re_s > MICHEL_RE_MIN
    if not np.any(usable):
        return None
    threshold = 1.174 * (1.0 + 22400.0 / np.maximum(re_s, MICHEL_RE_MIN)) * re_s**0.46
    met = usable & (re_theta >= threshold)
    if not np.any(met):
        return None
    return int(np.argmax(met))


def march_surface(
    s: Array, x: Array, edge_velocity: Array, reynolds: float
) -> SurfaceBoundaryLayer:
    """March one surface from the stagnation point to the trailing edge.

    ``s`` is arc length from the stagnation point, ``x`` the chordwise station of each point and
    ``edge_velocity`` the magnitude of the inviscid edge velocity, all at the same points and all
    non-dimensional.
    """
    nu = 1.0 / reynolds
    count = s.size
    ue = np.maximum(edge_velocity, 1e-9)

    # A branch of one or two points means the stagnation point landed on or next to the trailing
    # edge, which happens at extreme incidence or on a degenerate section. There is nothing to
    # march, and reporting failure is better than letting a gradient of an empty array raise.
    if count < 3:
        return SurfaceBoundaryLayer(
            status=SurfaceStatus.NOT_CONVERGED,
            s=s,
            x=x,
            theta=np.zeros(count),
            shape_factor=np.zeros(count),
            cf=np.zeros(count),
            transition_x=1.0,
            separation_induced_transition=False,
            separation_x=float("nan"),
            theta_te=float("nan"),
            shape_factor_te=float("nan"),
            edge_velocity_te=float(ue[-1]) if count else float("nan"),
        )

    # --- Laminar: Thwaites ------------------------------------------------------------------
    integrand = ue**5
    integral = np.concatenate(
        [[0.0], np.cumsum(0.5 * (integrand[1:] + integrand[:-1]) * np.diff(s))]
    )
    theta = np.sqrt(0.45 * nu * integral / ue**6)
    # The stagnation point itself has zero thickness; Thwaites' similarity solution gives the
    # correct non-zero start one step downstream, which is what the march below uses.
    theta[0] = 0.0

    gradient = np.gradient(ue, s)
    lam = theta**2 / nu * gradient
    shape_factor = thwaites_shape_factor(lam)
    cf = np.zeros(count)
    # cf = 2 l nu / (Ue theta) is singular as theta goes to zero at the stagnation point, so the
    # guard region is reported as zero rather than as an arbitrarily large number. It spans a few
    # thousandths of chord and contributes nothing to the integrated friction.
    resolved = (theta > 0.0) & (s > STAGNATION_GUARD_S)
    cf[resolved] = 2.0 * thwaites_shear(lam[resolved]) * nu / (ue[resolved] * theta[resolved])

    # The station every return path reports from. Computed once, before the march branches: the
    # fully-laminar path used to report from the branch end instead, where the inviscid edge
    # velocity is collapsing into the rear stagnation point. On two sampled rows that gave an edge
    # velocity of 26 663, which Squire-Young raises to the power 3.6 -- a drag of 2.2e9 published as
    # a converged result. One cut-off, applied once. See ADR-020.
    inside_cutoff = np.flatnonzero(x <= TRAILING_EDGE_CUTOFF_X)
    cutoff = int(inside_cutoff[-1]) if inside_cutoff.size else count - 1

    separated = np.flatnonzero((lam <= LAMINAR_SEPARATION_LAMBDA) & (s > STAGNATION_GUARD_S))
    natural_transition = _michel_transition_index(s, theta, reynolds)
    laminar_separation_index = int(separated[0]) if separated.size else None

    # Separation-induced transition. A laminar boundary layer that separates under an adverse
    # gradient at this Reynolds number normally forms a short bubble and reattaches turbulent
    # within a few per cent of chord. Rather than model the bubble -- which needs a coupled
    # method -- the march transitions at the separation point and continues turbulent. This is
    # standard practice in integral methods and it is the single largest approximation in this
    # solver; see ADR-015 and docs/solver-validation.md.
    candidates = [i for i in (natural_transition, laminar_separation_index) if i is not None]
    transition = min(candidates) if candidates else None
    separation_induced = (
        laminar_separation_index is not None and transition == laminar_separation_index
    )

    if transition is None:
        # Fully laminar to the trailing edge. Physically unlikely at Re = 1e6, but it is the
        # honest outcome for a short run of attached favourable-gradient flow.
        return SurfaceBoundaryLayer(
            status=SurfaceStatus.OK,
            s=s,
            x=x,
            theta=theta,
            shape_factor=shape_factor,
            cf=cf,
            transition_x=1.0,
            separation_induced_transition=False,
            separation_x=float("nan"),
            theta_te=float(theta[cutoff]),
            shape_factor_te=float(shape_factor[cutoff]),
            edge_velocity_te=float(ue[cutoff]),
        )

    # --- Turbulent: Head --------------------------------------------------------------------
    status = SurfaceStatus.OK
    separation_x = float("nan")
    current_theta = float(theta[transition])
    current_h = float(min(shape_factor[transition], 1.8))
    current_h1 = head_h1(current_h)

    # Squire-Young needs theta, H and Ue at one consistent station, and it is the same station
    # every other return path reports from.
    last = max(transition, cutoff)
    edge_velocity_at_cutoff = float(ue[cutoff])

    for i in range(transition, last):
        ds = float(s[i + 1] - s[i])
        if ds <= 0.0:
            continue
        ue_i = float(ue[i])
        due_ds = float(gradient[i])
        re_theta = reynolds * ue_i * current_theta
        cf_i = ludwieg_tillmann_cf(current_h, re_theta)

        # von Karman momentum integral and Head's entrainment equation, forward Euler. The
        # panel distribution is fine enough near the trailing edge that a higher-order scheme
        # changes the drag by less than a tenth of a percent; the march is kept simple instead.
        dtheta = 0.5 * cf_i - (current_h + 2.0) * current_theta / ue_i * due_ds
        entrainment = 0.0306 * (max(current_h1 - 3.0, 1e-6)) ** -0.6169
        dh1 = (ue_i * entrainment - current_h1 * (ue_i * dtheta + current_theta * due_ds)) / (
            ue_i * current_theta
        )

        current_theta += dtheta * ds
        current_h1 += dh1 * ds
        if (
            current_theta <= 0.0
            or current_theta > MAX_MOMENTUM_THICKNESS
            or not np.isfinite(current_theta)
            or not np.isfinite(current_h1)
        ):
            status = SurfaceStatus.NOT_CONVERGED
            break

        current_h = head_shape_factor(current_h1)
        theta[i + 1] = current_theta
        shape_factor[i + 1] = current_h
        cf[i + 1] = cf_i

        if current_h >= TURBULENT_SEPARATION_H:
            status = SurfaceStatus.TURBULENT_SEPARATION
            separation_x = float(x[i + 1])
            break

    converged = status is SurfaceStatus.OK
    return SurfaceBoundaryLayer(
        status=status,
        s=s,
        x=x,
        theta=theta,
        shape_factor=shape_factor,
        cf=cf,
        transition_x=float(x[transition]),
        separation_induced_transition=separation_induced,
        separation_x=separation_x,
        theta_te=current_theta if converged else float("nan"),
        shape_factor_te=current_h if converged else float("nan"),
        edge_velocity_te=edge_velocity_at_cutoff,
    )
