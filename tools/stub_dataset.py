#!/usr/bin/env python3
"""Generate schema-conformant PLACEHOLDER data for the design-space explorer.

This is NOT physics. It exists for exactly one reason: the sister project
(design-space-explorer) is built in parallel with this one and needs data shaped like
``docs/DATASET-SCHEMA.md`` before this repository's real solver and dataset land in M1/M2.
Every row is produced by crude analytic proxies -- thin-airfoil lift, a fabricated drag
polar, a hand-shaped pressure curve -- so the *distributions* are plausible and the *columns*
are exact, while the *numbers* are worthless.

Rows are tagged ``solver_version = "stub-0.0.0"`` so placeholder data can never be mistaken
for a real run. Switching a consumer to the real dataset means changing a URL and nothing else.

Pure standard library, no dependencies, so any consumer can run it immediately:

    python3 tools/stub_dataset.py --rows 5000 --out data/sample/stub.csv
"""

from __future__ import annotations

import argparse
import csv
import math
import random
import sys
from pathlib import Path

SCHEMA_VERSION = 1
STUB_SOLVER_VERSION = "stub-0.0.0"
PANEL_COUNT = 160
REYNOLDS = 1.0e6
MACH = 0.0
N_STATIONS_PER_SURFACE = 64
N_POD = 32
N_CST = 6

# Sampling bounds, section 2 of docs/DATASET-SCHEMA.md.
BOUNDS_UPPER = [(0.08, 0.30), (0.00, 0.40), (0.00, 0.40), (0.00, 0.40), (0.00, 0.40), (0.00, 0.30)]
BOUNDS_LOWER = [(-0.30, -0.05), (-0.40, 0.15), (-0.40, 0.15), (-0.40, 0.15), (-0.40, 0.15), (-0.25, 0.20)]
ALPHA_RANGE = (-6.0, 14.0)
ALPHAS_PER_SHAPE = 5

# Validity filters, section 2 of docs/DATASET-SCHEMA.md.
THICKNESS_RANGE = (0.06, 0.20)
LE_RADIUS_RANGE = (0.002, 0.05)

# Cosine-clustered surface stations, section 3 of docs/DATASET-SCHEMA.md.
STATIONS = [
    0.5 * (1.0 - math.cos(math.pi * j / (N_STATIONS_PER_SURFACE - 1)))
    for j in range(N_STATIONS_PER_SURFACE)
]


def bernstein(n: int, i: int, psi: float) -> float:
    return math.comb(n, i) * psi**i * (1.0 - psi) ** (n - i)


def cst_surface(weights: list[float], psi: float) -> float:
    """Kulfan class-shape transformation with N1 = 0.5, N2 = 1.0 and a sharp trailing edge."""
    if psi <= 0.0 or psi >= 1.0:
        return 0.0
    klass = psi**0.5 * (1.0 - psi)
    shape = sum(w * bernstein(N_CST - 1, i, psi) for i, w in enumerate(weights))
    return klass * shape


def geometry_metrics(upper: list[float], lower: list[float]) -> dict[str, float] | None:
    """Derived geometry columns, or None if the shape fails the validity filters."""
    n = 200
    t_max = t_max_x = 0.0
    c_max = c_max_x = 0.0
    area = 0.0
    prev_psi = prev_t = 0.0
    for k in range(n + 1):
        psi = k / n
        zu = cst_surface(upper, psi)
        zl = cst_surface(lower, psi)
        thickness = zu - zl
        if 0.0 < psi < 1.0 and thickness <= 0.0:
            return None  # surfaces cross
        if thickness > t_max:
            t_max, t_max_x = thickness, psi
        camber = 0.5 * (zu + zl)
        if abs(camber) > abs(c_max):
            c_max, c_max_x = camber, psi
        area += 0.5 * (thickness + prev_t) * (psi - prev_psi)
        prev_psi, prev_t = psi, thickness

    if not THICKNESS_RANGE[0] <= t_max <= THICKNESS_RANGE[1]:
        return None
    # For N1 = 0.5 the leading-edge radius follows from the first weight: r/c = A_0^2 / 2.
    le_radius = 0.5 * upper[0] ** 2
    if not LE_RADIUS_RANGE[0] <= le_radius <= LE_RADIUS_RANGE[1]:
        return None
    if area <= 0.0:
        return None

    return {
        "thickness_max": t_max,
        "thickness_max_x": t_max_x,
        "camber_max": c_max,
        "camber_max_x": c_max_x,
        "le_radius": le_radius,
        "area": area,
    }


def fake_aero(geom: dict[str, float], alpha_deg: float) -> dict[str, float]:
    """Crude analytic proxies. Plausible magnitudes, no physical validity."""
    alpha = math.radians(alpha_deg)
    alpha_zero_lift = -2.0 * geom["camber_max"]  # rough thin-airfoil stand-in
    cl = 2.0 * math.pi * (alpha - alpha_zero_lift)
    # Soft saturation so the stub does not hand the explorer a straight line to infinity.
    cl = 1.6 * math.tanh(cl / 1.6)

    cd_friction = 0.0045 + 0.010 * geom["thickness_max"]
    cd_pressure = 0.0015 + 0.030 * geom["thickness_max"] ** 2 + 0.009 * cl**2
    cd = cd_friction + cd_pressure
    cm_quarter = -0.02 - 0.95 * geom["camber_max"]

    x_tr_upper = max(0.02, min(1.0, 0.60 - 0.35 * max(cl, 0.0)))
    x_tr_lower = max(0.02, min(1.0, 0.65 + 0.20 * min(cl, 0.0)))

    return {
        "cl": cl,
        "cd": cd,
        "cd_pressure": cd_pressure,
        "cd_friction": cd_friction,
        "cm_quarter": cm_quarter,
        "cl_over_cd": cl / cd,
        "x_transition_upper": x_tr_upper,
        "x_transition_lower": x_tr_lower,
    }


def fake_cp(geom: dict[str, float], cl: float) -> list[float]:
    """A hand-shaped pressure curve: stagnation at the nose, a suction peak scaling with lift."""
    out: list[float] = []
    for sign in (1.0, -1.0):  # upper surface first, then lower
        for j, psi in enumerate(STATIONS):
            if j == 0:
                out.append(1.0)  # stagnation point
                continue
            thickness_term = 1.2 * geom["thickness_max"] * math.sin(math.pi * psi**0.6)
            lift_term = sign * 0.42 * cl * (1.0 - psi) ** 0.8
            edge_velocity = 1.0 + thickness_term + lift_term
            out.append(1.0 - edge_velocity**2)
    return out


def fake_pod(geom: dict[str, float], cl: float) -> list[float]:
    """Smooth deterministic coefficients with a decaying spectrum, as a real POD would have."""
    return [
        math.exp(-0.25 * k)
        * (0.8 * cl * math.cos(0.7 * k) + 1.5 * geom["thickness_max"] * math.sin(0.4 * k + 1.0))
        for k in range(N_POD)
    ]


def columns() -> list[str]:
    cols = ["design_id", "shape_id"]
    cols += [f"cst_u_{i}" for i in range(N_CST)]
    cols += [f"cst_l_{i}" for i in range(N_CST)]
    cols += ["alpha_deg", "reynolds", "mach"]
    cols += ["thickness_max", "thickness_max_x", "camber_max", "camber_max_x", "le_radius", "area"]
    cols += ["cl", "cd", "cd_pressure", "cd_friction", "cm_quarter", "cl_over_cd"]
    cols += ["x_transition_upper", "x_transition_lower"]
    cols += [f"cp_{j:03d}" for j in range(2 * N_STATIONS_PER_SURFACE)]
    cols += [f"pod_{k:02d}" for k in range(N_POD)]
    cols += ["solver_status", "solver_version", "panel_count"]
    return cols


def generate(rows: int, seed: int):
    rng = random.Random(seed)
    design_id = 0
    shape_id = 0
    rejected = 0

    while design_id < rows:
        upper = [rng.uniform(*b) for b in BOUNDS_UPPER]
        lower = [rng.uniform(*b) for b in BOUNDS_LOWER]
        geom = geometry_metrics(upper, lower)
        if geom is None:
            rejected += 1
            continue

        for _ in range(ALPHAS_PER_SHAPE):
            if design_id >= rows:
                break
            alpha_deg = rng.uniform(*ALPHA_RANGE)
            aero = fake_aero(geom, alpha_deg)
            row = [design_id, shape_id]
            row += [round(w, 6) for w in upper]
            row += [round(w, 6) for w in lower]
            row += [round(alpha_deg, 4), REYNOLDS, MACH]
            row += [round(geom[k], 6) for k in
                    ("thickness_max", "thickness_max_x", "camber_max", "camber_max_x", "le_radius", "area")]
            row += [round(aero[k], 6) for k in
                    ("cl", "cd", "cd_pressure", "cd_friction", "cm_quarter", "cl_over_cd",
                     "x_transition_upper", "x_transition_lower")]
            row += [round(v, 5) for v in fake_cp(geom, aero["cl"])]
            row += [round(v, 5) for v in fake_pod(geom, aero["cl"])]
            row += ["ok", STUB_SOLVER_VERSION, PANEL_COUNT]
            yield row
            design_id += 1
        shape_id += 1

    print(f"rejected {rejected} shapes on validity filters", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rows", type=int, default=5000, help="number of rows to generate")
    parser.add_argument("--seed", type=int, default=20261024, help="RNG seed for reproducibility")
    parser.add_argument("--out", type=Path, default=Path("data/sample/stub.csv"), help="output CSV path")
    args = parser.parse_args()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(columns())
        writer.writerows(generate(args.rows, args.seed))

    print(
        f"wrote {args.rows} placeholder rows to {args.out} "
        f"(schema v{SCHEMA_VERSION}, solver_version={STUB_SOLVER_VERSION})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
