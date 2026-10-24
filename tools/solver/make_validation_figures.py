"""Generate the figures in ``docs/solver-validation.md``.

Run from the repository root::

    uv run python -m tools.solver.make_validation_figures

Figures are written to ``docs/screenshots/solver`` and committed. Nothing here is imported by the
solver itself; it exists so every number and curve in the validation document can be regenerated.
"""

from __future__ import annotations

import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np

from tools.solver.boundary_layer import march_surface
from tools.solver.geometry import Airfoil, naca4
from tools.solver.panel import solve_inviscid
from tools.solver.solve import cp_stations, solve

OUTPUT = Path("docs/screenshots/solver")
REYNOLDS = 1.0e6
TWO_PI = 2.0 * math.pi

plt.rcParams.update(
    {
        "figure.dpi": 140,
        "savefig.bbox": "tight",
        "axes.grid": True,
        "grid.alpha": 0.25,
        "font.size": 9,
    }
)


def circle(panel_count: int) -> Airfoil:
    t = np.linspace(0.0, TWO_PI, panel_count + 1)
    loop = np.column_stack([0.5 * np.cos(t) + 0.5, 0.5 * np.sin(t)])
    return Airfoil(name="circle", coordinates=np.ascontiguousarray(loop))


def figure_circle() -> None:
    """Panel method against the exact circle solution, and its convergence."""
    fig, (left, right) = plt.subplots(1, 2, figsize=(9, 3.4))

    solution = solve_inviscid(circle(200), 0.0)
    theta = np.arctan2(solution.y_control, solution.x_control - 0.5)
    order = np.argsort(theta)
    left.plot(
        np.degrees(theta[order]),
        1.0 - 4.0 * np.sin(theta[order]) ** 2,
        label="exact, $1-4\\sin^2\\theta$",
        linewidth=2.4,
        color="#b0b7c3",
    )
    left.plot(
        np.degrees(theta[order]),
        solution.cp[order],
        "o",
        markersize=2.2,
        label="panel method, 200 panels",
    )
    left.set_xlabel("angle from the rear stagnation point, degrees")
    left.set_ylabel("$C_p$")
    left.set_title("Circle in potential flow")
    left.legend()

    counts = np.array([50, 100, 200, 400, 800])
    errors = []
    for count in counts:
        sol = solve_inviscid(circle(int(count)), 0.0)
        ang = np.arctan2(sol.y_control, sol.x_control - 0.5)
        errors.append(float(np.sqrt(np.mean((sol.cp - (1.0 - 4.0 * np.sin(ang) ** 2)) ** 2))))
    right.loglog(counts, errors, "o-", label="rms error in $C_p$")
    right.loglog(counts, errors[0] * counts[0] / counts, "--", color="#b0b7c3", label="first order")
    right.set_xlabel("panels")
    right.set_ylabel("rms error")
    right.set_title("Grid convergence")
    right.legend()

    fig.savefig(OUTPUT / "circle-verification.png")
    plt.close(fig)


def figure_lift_slope() -> None:
    """Lift-curve slope against the classical thickness correction."""
    fig, axes = plt.subplots(figsize=(5, 3.4))
    thickness = np.array([0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.18])
    slopes = []
    for t in thickness:
        airfoil = naca4(f"00{round(t * 100):02d}", panel_count=320)
        low = solve_inviscid(airfoil, -2.0).cl
        high = solve_inviscid(airfoil, 2.0).cl
        slopes.append((high - low) / math.radians(4.0))
    axes.plot(thickness * 100, slopes, "o-", label="panel method")
    axes.plot(
        thickness * 100,
        TWO_PI * (1.0 + 0.77 * thickness),
        "--",
        color="#b0b7c3",
        label=r"$2\pi(1 + 0.77\,t/c)$",
    )
    axes.axhline(TWO_PI, color="#d08770", linestyle=":", label=r"thin aerofoil, $2\pi$")
    axes.set_xlabel("thickness, per cent of chord")
    axes.set_ylabel(r"$dC_l/d\alpha$, per radian")
    axes.set_title("Lift-curve slope, symmetric sections")
    axes.legend()
    fig.savefig(OUTPUT / "lift-slope.png")
    plt.close(fig)


def figure_blasius() -> None:
    """Thwaites' laminar method against the Blasius flat-plate solution."""
    fig, (left, right) = plt.subplots(1, 2, figsize=(9, 3.4))
    s = np.linspace(0.0, 1.0, 2001)
    layer = march_surface(s, s.copy(), np.ones_like(s), REYNOLDS)
    nu = 1.0 / REYNOLDS
    blasius = 0.664 * np.sqrt(nu * s)

    left.plot(
        s, blasius * 1e3, label="Blasius, $0.664\\sqrt{\\nu x/U}$", linewidth=2.4, color="#b0b7c3"
    )
    left.plot(s, layer.theta * 1e3, label="Thwaites", linestyle="--")
    left.set_xlabel("$x/c$")
    left.set_ylabel(r"momentum thickness $\theta/c \times 10^{3}$")
    left.set_title("Flat plate, $Re = 10^{6}$")
    left.legend()

    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = layer.theta / blasius
    right.plot(s[1:], ratio[1:])
    right.axhline(1.0103, color="#d08770", linestyle=":", label=r"$\sqrt{0.45}/0.664 = 1.0103$")
    right.set_ylim(0.99, 1.03)
    right.set_xlabel("$x/c$")
    right.set_ylabel("Thwaites / Blasius")
    right.set_title("Ratio: the method's known 1 % error")
    right.legend()

    fig.savefig(OUTPUT / "blasius-verification.png")
    plt.close(fig)


def figure_sections() -> None:
    """Pressure distributions and the viscous polar for NACA 0012."""
    fig, (left, right) = plt.subplots(1, 2, figsize=(9, 3.4))

    x = cp_stations()
    for alpha in (0.0, 5.0):
        result = solve(naca4("0012", panel_count=320), alpha)
        left.plot(x, result.cp_upper, label=rf"upper, $\alpha={alpha:.0f}^\circ$")
        left.plot(x, result.cp_lower, "--", label=rf"lower, $\alpha={alpha:.0f}^\circ$")
    left.invert_yaxis()
    left.set_xlabel("$x/c$")
    left.set_ylabel("$C_p$")
    left.set_title("NACA 0012 pressure distribution")
    left.legend(fontsize=7)

    alphas = np.arange(-6.0, 11.0, 0.5)
    converged_alpha, converged_cd, converged_cl = [], [], []
    for alpha in alphas:
        result = solve(naca4("0012", panel_count=200), float(alpha))
        if result.status.value == "ok":
            converged_alpha.append(alpha)
            converged_cd.append(result.cd)
            converged_cl.append(result.cl)
    right.plot(converged_cd, converged_cl, "o-", markersize=3)
    right.axvspan(
        0.0055, 0.0060, color="#d08770", alpha=0.25, label="published $C_d$ at low $\\alpha$"
    )
    right.set_xlabel("$C_d$")
    right.set_ylabel("$C_l$")
    right.set_title(f"NACA 0012 polar, $Re=10^6$\nconverged to ${max(converged_alpha):.1f}^\\circ$")
    right.legend(fontsize=7)

    fig.savefig(OUTPUT / "naca0012-pressure-and-polar.png")
    plt.close(fig)


def figure_field() -> None:
    """The sampled velocity field the reduced-order model will reconstruct."""
    result = solve(naca4("2412", panel_count=200), 4.0, with_field=True)
    assert result.field is not None
    field = result.field

    fig, axes = plt.subplots(figsize=(7, 3.6))
    mesh = axes.pcolormesh(field.x, field.y, field.speed, shading="nearest", cmap="viridis")
    axes.streamplot(
        field.x,
        field.y,
        np.nan_to_num(field.u, nan=1.0),
        np.nan_to_num(field.v),
        density=1.1,
        color="white",
        linewidth=0.5,
        arrowsize=0.6,
    )
    airfoil = naca4("2412", panel_count=200)
    axes.fill(airfoil.coordinates[:, 0], airfoil.coordinates[:, 1], color="#1b2430", zorder=5)
    axes.set_xlim(field.x[0], field.x[-1])
    axes.set_ylim(field.y[0], field.y[-1])
    axes.set_aspect("equal")
    axes.set_title(r"NACA 2412 at $\alpha=4^\circ$: sampled speed on the 192 $\times$ 96 grid")
    axes.set_xlabel("$x/c$")
    axes.set_ylabel("$y/c$")
    fig.colorbar(mesh, ax=axes, label=r"$|V|/U_\infty$")
    fig.savefig(OUTPUT / "velocity-field.png")
    plt.close(fig)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    figure_circle()
    figure_lift_slope()
    figure_blasius()
    figure_sections()
    figure_field()
    print(f"wrote figures to {OUTPUT}")


if __name__ == "__main__":
    main()
