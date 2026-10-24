"""Tests for the surrogate network and its export."""

import itertools

import numpy as np
import pytest
import torch

from tools.train.data import CP_COLUMNS, INPUT_COLUMNS, OUTPUT_COLUMNS, POD_COLUMNS, Normalisation
from tools.train.export import linear_layers, write_raw_weights
from tools.train.model import INPUT_SIZE, OUTPUT_SIZE, Surrogate, group_weights
from tools.train.train import weighted_loss


def identity_normalisation() -> Normalisation:
    return Normalisation(
        input_mean=np.zeros(INPUT_SIZE, dtype=np.float32),
        input_scale=np.ones(INPUT_SIZE, dtype=np.float32),
        output_mean=np.zeros(OUTPUT_SIZE, dtype=np.float32),
        output_scale=np.ones(OUTPUT_SIZE, dtype=np.float32),
    )


class TestSurrogate:
    def test_shapes_match_the_column_lists(self) -> None:
        assert INPUT_SIZE == len(INPUT_COLUMNS) == 13
        assert OUTPUT_SIZE == len(OUTPUT_COLUMNS) == 163

    def test_fits_the_size_budget(self) -> None:
        model = Surrogate(identity_normalisation())
        # The plan budgets one megabyte for the artifact.
        assert 4 * model.parameter_count < 1_000_000

    def test_normalisation_is_applied_inside_the_graph(self) -> None:
        normalisation = Normalisation(
            input_mean=np.full(INPUT_SIZE, 2.0, dtype=np.float32),
            input_scale=np.full(INPUT_SIZE, 4.0, dtype=np.float32),
            output_mean=np.full(OUTPUT_SIZE, -1.0, dtype=np.float32),
            output_scale=np.full(OUTPUT_SIZE, 3.0, dtype=np.float32),
        )
        model = Surrogate(normalisation).eval()
        raw = torch.full((1, INPUT_SIZE), 2.0)
        with torch.no_grad():
            through_graph = model(raw)
            bare = model.forward_normalised(torch.zeros(1, INPUT_SIZE))
        np.testing.assert_allclose(through_graph.numpy(), (bare * 3.0 - 1.0).numpy(), rtol=1e-6)

    def test_is_deterministic_for_a_seed(self) -> None:
        torch.manual_seed(7)
        first = Surrogate(identity_normalisation())
        torch.manual_seed(7)
        second = Surrogate(identity_normalisation())
        for a, b in zip(first.parameters(), second.parameters(), strict=True):
            torch.testing.assert_close(a, b)

    def test_handles_a_batch(self) -> None:
        model = Surrogate(identity_normalisation()).eval()
        with torch.no_grad():
            assert model(torch.zeros(17, INPUT_SIZE)).shape == (17, OUTPUT_SIZE)


class TestGroupWeights:
    def test_each_group_carries_equal_total_weight(self) -> None:
        weights = group_weights()
        cp_total = float(weights[: len(CP_COLUMNS)].sum())
        scalar_total = float(weights[len(CP_COLUMNS) : len(CP_COLUMNS) + 3].sum())
        pod_total = float(weights[len(CP_COLUMNS) + 3 :].sum())
        assert cp_total == pytest.approx(1.0)
        assert scalar_total == pytest.approx(1.0)
        assert pod_total == pytest.approx(1.0)
        assert len(POD_COLUMNS) == 32

    def test_a_scalar_outweighs_a_single_pressure_station(self) -> None:
        weights = group_weights()
        assert float(weights[len(CP_COLUMNS)]) > float(weights[0])


class TestWeightedLoss:
    def test_is_zero_for_a_perfect_prediction(self) -> None:
        target = torch.randn(8, OUTPUT_SIZE)
        mask = torch.ones_like(target)
        assert float(weighted_loss(target, target, mask, group_weights())) == pytest.approx(0.0)

    def test_ignores_masked_entries(self) -> None:
        target = torch.zeros(4, OUTPUT_SIZE)
        predicted = torch.zeros_like(target)
        predicted[:, 129] = 1000.0  # the drag column
        mask = torch.ones_like(target)
        mask[:, 129] = 0.0
        assert float(weighted_loss(predicted, target, mask, group_weights())) == pytest.approx(0.0)

    def test_scales_with_the_error(self) -> None:
        target = torch.zeros(4, OUTPUT_SIZE)
        mask = torch.ones_like(target)
        small = weighted_loss(torch.full_like(target, 0.1), target, mask, group_weights())
        large = weighted_loss(torch.full_like(target, 0.2), target, mask, group_weights())
        assert float(large) == pytest.approx(4.0 * float(small), rel=1e-5)


class TestRawExport:
    def test_blob_and_manifest_describe_the_same_model(self, tmp_path) -> None:
        model = Surrogate(identity_normalisation()).eval()
        manifest = write_raw_weights(model, identity_normalisation(), tmp_path)

        expected = 2 * INPUT_SIZE + 2 * OUTPUT_SIZE
        for layer in linear_layers(model):
            expected += layer.weight.numel() + layer.bias.numel()
        assert manifest["floats"] == expected

        blob = np.frombuffer((tmp_path / "weights.bin").read_bytes(), dtype=np.float32)
        assert blob.size == expected
        np.testing.assert_allclose(blob[:INPUT_SIZE], 0.0)
        np.testing.assert_allclose(blob[INPUT_SIZE : 2 * INPUT_SIZE], 1.0)

    def test_layer_shapes_chain(self, tmp_path) -> None:
        model = Surrogate(identity_normalisation())
        manifest = write_raw_weights(model, identity_normalisation(), tmp_path)
        layers = manifest["layers"]
        assert layers[0]["in"] == INPUT_SIZE
        assert layers[-1]["out"] == OUTPUT_SIZE
        for first, second in itertools.pairwise(layers):
            assert first["out"] == second["in"]

    def test_weights_round_trip_from_the_blob(self, tmp_path) -> None:
        model = Surrogate(identity_normalisation())
        write_raw_weights(model, identity_normalisation(), tmp_path)
        blob = np.frombuffer((tmp_path / "weights.bin").read_bytes(), dtype=np.float32)

        offset = 2 * INPUT_SIZE + 2 * OUTPUT_SIZE
        for layer in linear_layers(model):
            rows, columns = layer.weight.shape
            stored = blob[offset : offset + rows * columns].reshape(rows, columns)
            np.testing.assert_allclose(stored, layer.weight.detach().numpy(), rtol=1e-6)
            offset += rows * columns
            np.testing.assert_allclose(
                blob[offset : offset + rows], layer.bias.detach().numpy(), rtol=1e-6
            )
            offset += rows
        assert offset == blob.size
