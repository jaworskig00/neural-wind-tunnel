"""Generate the fixtures that hold the TypeScript geometry port to the Python original.

Run from the repository root::

    uv run python -m tools.solver.make_ts_fixtures

The browser re-implements the CST evaluator so it can rebuild geometry on every slider drag
without a round trip. Two implementations of the same formula drift unless something pins them
together, and that something is this fixture: `src/geometry/cst.test.ts` reads it and asserts
agreement to 1e-9.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from tools.solver.geometry import (
    CST_ORDER,
    cst,
    cst_metrics,
    cst_surface,
    fit_cst,
    naca4,
)

OUTPUT = Path("src/geometry/__fixtures__/cst.json")

#: Presets the app offers, all four-digit: the solver implements the four-digit series only, and a
#: five-digit section such as NACA 23012 would need its own camber line. Their CST weights are
#: fitted here once, so the browser never needs the
#: NACA formulae at all.
PRESETS = ("0008", "0012", "2412", "4412")


def main() -> int:
    cases = []
    for designation in PRESETS:
        upper, lower = fit_cst(naca4(designation, panel_count=320))
        airfoil = cst(upper, lower, panel_count=160)
        metrics = cst_metrics(upper, lower)
        psi = np.array([0.0, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1.0])
        cases.append(
            {
                "name": f"naca{designation}",
                "upperWeights": [round(float(w), 12) for w in upper],
                "lowerWeights": [round(float(w), 12) for w in lower],
                "psi": [float(p) for p in psi],
                "upperZ": [float(z) for z in cst_surface(upper, psi)],
                "lowerZ": [float(z) for z in cst_surface(lower, psi)],
                "metrics": {
                    "thicknessMax": metrics.thickness_max,
                    "thicknessMaxX": metrics.thickness_max_x,
                    "camberMax": metrics.camber_max,
                    "camberMaxX": metrics.camber_max_x,
                    "leRadius": metrics.le_radius,
                    "area": metrics.area,
                },
                "loopLength": int(airfoil.coordinates.shape[0]),
                "loopHead": [[float(x), float(z)] for x, z in airfoil.coordinates[:3]],
                "loopNose": [
                    [float(x), float(z)]
                    for x, z in airfoil.coordinates[
                        int(np.argmin(airfoil.coordinates[:, 0])) : int(
                            np.argmin(airfoil.coordinates[:, 0])
                        )
                        + 2
                    ]
                ],
            }
        )

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps({"cstOrder": CST_ORDER, "cases": cases}, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {OUTPUT} with {len(cases)} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
