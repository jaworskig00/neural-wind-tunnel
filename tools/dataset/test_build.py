"""Tests for dataset assembly."""

import numpy as np
import pandas as pd
import pytest

from tools.dataset.build import GEOMETRY_COLUMNS, checksum, recompute_geometry
from tools.dataset.sample import generate_shapes
from tools.solver.geometry import CST_ORDER, cst_metrics


def frame_from_shapes(count: int = 6, alphas: int = 3) -> pd.DataFrame:
    """A minimal table in the shape the shards produce, with deliberately wrong geometry columns."""
    shapes, _ = generate_shapes(count)
    rows = []
    for shape in shapes:
        for alpha in np.linspace(-4, 8, alphas):
            row: dict[str, float | int | str] = {
                "design_id": len(rows),
                "shape_id": shape.shape_id,
                "alpha_deg": float(alpha),
            }
            for i in range(CST_ORDER):
                row[f"cst_u_{i}"] = float(shape.upper_weights[i])
                row[f"cst_l_{i}"] = float(shape.lower_weights[i])
            for column in GEOMETRY_COLUMNS:
                row[column] = -999.0
            rows.append(row)
    return pd.DataFrame(rows)


class TestRecomputeGeometry:
    def test_replaces_every_geometry_column(self) -> None:
        frame = recompute_geometry(frame_from_shapes())
        for column in GEOMETRY_COLUMNS:
            assert (frame[column] != -999.0).all(), column

    def test_matches_the_exact_metrics_for_each_shape(self) -> None:
        frame = recompute_geometry(frame_from_shapes())
        for shape_id, group in frame.groupby("shape_id"):
            first = group.iloc[0]
            upper = np.array([first[f"cst_u_{i}"] for i in range(CST_ORDER)], dtype=np.float64)
            lower = np.array([first[f"cst_l_{i}"] for i in range(CST_ORDER)], dtype=np.float64)
            expected = cst_metrics(upper, lower)
            assert first["thickness_max"] == pytest.approx(expected.thickness_max, rel=1e-12)
            assert first["camber_max"] == pytest.approx(expected.camber_max, rel=1e-12)
            assert first["le_radius"] == pytest.approx(expected.le_radius, rel=1e-12)
            assert first["area"] == pytest.approx(expected.area, rel=1e-12), shape_id

    def test_every_incidence_of_a_shape_shares_its_geometry(self) -> None:
        frame = recompute_geometry(frame_from_shapes(alphas=5))
        for _, group in frame.groupby("shape_id"):
            for column in GEOMETRY_COLUMNS:
                assert group[column].nunique() == 1, column

    def test_values_satisfy_the_published_filters(self) -> None:
        frame = recompute_geometry(frame_from_shapes(count=12))
        assert frame["thickness_max"].between(0.06, 0.20).all()
        assert frame["le_radius"].between(0.002, 0.05).all()
        assert (frame["area"] > 0).all()


class TestChecksum:
    def test_is_stable_and_content_dependent(self, tmp_path) -> None:
        first = tmp_path / "a.bin"
        second = tmp_path / "b.bin"
        first.write_bytes(b"neural wind tunnel")
        second.write_bytes(b"neural wind tunnel")
        assert checksum(first) == checksum(second)
        second.write_bytes(b"something else")
        assert checksum(first) != checksum(second)
