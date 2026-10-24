"""Tests for the placeholder dataset generator.

The generator exists to unblock the sister project, so what matters is that it conforms to
``docs/DATASET-SCHEMA.md`` exactly -- the numbers inside are deliberately not physics.
"""

import itertools
import math

from tools.stub_dataset import (
    N_CST,
    N_POD,
    N_STATIONS_PER_SURFACE,
    STATIONS,
    STUB_SOLVER_VERSION,
    columns,
    cst_surface,
    generate,
    geometry_metrics,
)

EXPECTED_COLUMN_COUNT = (
    194  # 2 identity + 13 inputs + 6 geometry + 8 outputs + 128 Cp + 32 POD + 3 provenance
)


def test_column_list_matches_the_schema() -> None:
    cols = columns()
    assert len(cols) == EXPECTED_COLUMN_COUNT
    assert len(set(cols)) == len(cols), "duplicate column name"
    assert cols[:2] == ["design_id", "shape_id"]
    assert cols[2 : 2 + N_CST] == [f"cst_u_{i}" for i in range(N_CST)]
    assert cols[-3:] == ["solver_status", "solver_version", "panel_count"]
    assert sum(c.startswith("cp_") for c in cols) == 2 * N_STATIONS_PER_SURFACE
    assert sum(c.startswith("pod_") for c in cols) == N_POD


def test_stations_follow_the_cosine_formula() -> None:
    last = N_STATIONS_PER_SURFACE - 1
    assert len(STATIONS) == N_STATIONS_PER_SURFACE
    assert STATIONS[0] == 0.0
    assert math.isclose(STATIONS[-1], 1.0, abs_tol=1e-12)
    for j, psi in enumerate(STATIONS):
        assert math.isclose(psi, 0.5 * (1 - math.cos(math.pi * j / last)), abs_tol=1e-12)
    assert all(b > a for a, b in itertools.pairwise(STATIONS))


def test_cst_surface_closes_at_both_edges() -> None:
    weights = [0.2] * N_CST
    assert cst_surface(weights, 0.0) == 0.0
    assert cst_surface(weights, 1.0) == 0.0
    assert cst_surface(weights, 0.5) > 0.0


def test_geometry_metrics_rejects_crossing_surfaces() -> None:
    # Lower surface above the upper one: not an airfoil.
    assert geometry_metrics([0.05] * N_CST, [0.30] * N_CST) is None


def test_geometry_metrics_accepts_a_plausible_section() -> None:
    metrics = geometry_metrics([0.20] * N_CST, [-0.15] * N_CST)
    assert metrics is not None
    assert 0.06 <= metrics["thickness_max"] <= 0.20
    assert 0.0 < metrics["thickness_max_x"] < 1.0
    assert metrics["area"] > 0.0
    # For N1 = 0.5 the leading-edge radius follows from the first weight.
    assert math.isclose(metrics["le_radius"], 0.5 * 0.20**2, rel_tol=1e-12)


def test_generated_rows_conform_to_the_schema() -> None:
    rows = list(generate(rows=40, seed=7))
    assert len(rows) == 40
    for row in rows:
        assert len(row) == EXPECTED_COLUMN_COUNT
        assert row[-3] == "ok"
        assert row[-2] == STUB_SOLVER_VERSION
        assert all(isinstance(v, (int, float, str)) for v in row)
        numeric = [v for v in row if isinstance(v, (int, float))]
        assert all(math.isfinite(v) for v in numeric)

    # Stagnation pressure at the nose of each surface, per the generator's own contract.
    cp_start = 2 + 2 * N_CST + 3 + 6 + 8
    assert rows[0][cp_start] == 1.0
    assert rows[0][cp_start + N_STATIONS_PER_SURFACE] == 1.0
