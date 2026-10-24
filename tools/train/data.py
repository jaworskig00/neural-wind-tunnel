"""Loading, normalising and splitting the dataset for training.

Two decisions here shape everything downstream.

**The split is by shape, not by row.** Every shape is solved at eight incidences, so splitting rows
at random would put the same geometry on both sides of the split and let the model look up an answer
it has already seen. Splitting by ``shape_id`` keeps a shape's whole incidence sweep together.

**Most outputs do not need a converged boundary layer.** Pressure, lift, the quarter-chord moment
and the modal coefficients all come from the inviscid panel solution, valid for every row;
only drag needs the viscous march. Training the drag head on the 41 541 converged rows while
training everything else on all 67 200 uses 60 % more data for the outputs that can take it. The
loss carries a per-row mask to make that work.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from numpy.typing import NDArray

from tools.dataset.pod import DEFAULT_MODE_COUNT
from tools.dataset.run import DEFAULT_OUTPUT
from tools.solver.geometry import CST_ORDER
from tools.solver.solve import CP_STATIONS_PER_SURFACE

Array = NDArray[np.float32]

#: Model inputs: twelve CST weights then incidence.
INPUT_COLUMNS = (
    *(f"cst_u_{i}" for i in range(CST_ORDER)),
    *(f"cst_l_{i}" for i in range(CST_ORDER)),
    "alpha_deg",
)

#: Outputs, in the order the exported model emits them.
CP_COLUMNS = tuple(f"cp_{j:03d}" for j in range(2 * CP_STATIONS_PER_SURFACE))
POD_COLUMNS = tuple(f"pod_{i:02d}" for i in range(DEFAULT_MODE_COUNT))
SCALAR_COLUMNS = ("cl", "cd", "cm_quarter")
OUTPUT_COLUMNS = (*CP_COLUMNS, *SCALAR_COLUMNS, *POD_COLUMNS)

#: Index of the one output that needs a converged viscous march.
MASKED_OUTPUT = OUTPUT_COLUMNS.index("cd")

#: Split fractions by shape.
VALIDATION_FRACTION = 0.1
TEST_FRACTION = 0.1


@dataclass(frozen=True)
class Split:
    """One partition of the data."""

    name: str
    inputs: Array
    outputs: Array
    mask: Array
    """1 where every output is valid, 0 where the drag column must be ignored."""
    shape_ids: NDArray[np.int64]
    alpha_deg: Array

    def __len__(self) -> int:
        return self.inputs.shape[0]


@dataclass(frozen=True)
class Normalisation:
    """Per-column standardisation, folded into the exported graph so callers feed raw values."""

    input_mean: Array
    input_scale: Array
    output_mean: Array
    output_scale: Array

    def encode_inputs(self, inputs: Array) -> Array:
        return (inputs - self.input_mean) / self.input_scale

    def decode_outputs(self, normalised: Array) -> Array:
        return normalised * self.output_scale + self.output_mean


@dataclass(frozen=True)
class Dataset:
    train: Split
    validation: Split
    test: Split
    normalisation: Normalisation


def _split_indices(shape_ids: NDArray[np.int64], seed: int) -> tuple[Array, Array, Array]:
    unique = np.unique(shape_ids)
    rng = np.random.default_rng(seed)
    rng.shuffle(unique)
    validation_count = int(len(unique) * VALIDATION_FRACTION)
    test_count = int(len(unique) * TEST_FRACTION)
    test_shapes = set(unique[:test_count].tolist())
    validation_shapes = set(unique[test_count : test_count + validation_count].tolist())

    is_test = np.array([shape in test_shapes for shape in shape_ids])
    is_validation = np.array([shape in validation_shapes for shape in shape_ids])
    return ~(is_test | is_validation), is_validation, is_test


def load(path: Path | None = None, seed: int = 20261024) -> Dataset:
    """Load the dataset and build the three splits, normalised from the training set alone."""
    source = path or DEFAULT_OUTPUT / "designs.parquet"
    frame = pd.read_parquet(source)

    inputs = frame[list(INPUT_COLUMNS)].to_numpy(dtype=np.float32)
    # `copy=True` because pandas may hand back a read-only view and the drag column is rewritten.
    outputs = frame[list(OUTPUT_COLUMNS)].to_numpy(dtype=np.float32, copy=True)
    shape_ids = frame["shape_id"].to_numpy(dtype=np.int64)
    alpha = frame["alpha_deg"].to_numpy(dtype=np.float32)

    converged = (frame["solver_status"] == "ok").to_numpy()
    mask = np.ones_like(outputs)
    mask[~converged, MASKED_OUTPUT] = 0.0
    # A failed row carries nan for drag; zero it so no nan can reach a gradient even masked.
    outputs[~converged, MASKED_OUTPUT] = 0.0

    if not np.all(np.isfinite(outputs)):
        bad = np.argwhere(~np.isfinite(outputs))
        raise ValueError(f"non-finite outputs remain, first at row {bad[0][0]} column {bad[0][1]}")

    is_train, is_validation, is_test = _split_indices(shape_ids, seed)

    train_outputs = outputs[is_train]
    train_mask = mask[is_train]
    # Statistics for the masked column come from converged rows only, or the zeros would drag the
    # mean toward nothing.
    output_mean = np.empty(outputs.shape[1], dtype=np.float32)
    output_scale = np.empty(outputs.shape[1], dtype=np.float32)
    for column in range(outputs.shape[1]):
        valid = train_outputs[train_mask[:, column] > 0, column]
        output_mean[column] = float(valid.mean())
        output_scale[column] = float(max(valid.std(), 1e-6))

    normalisation = Normalisation(
        input_mean=inputs[is_train].mean(axis=0),
        input_scale=np.maximum(inputs[is_train].std(axis=0), 1e-6).astype(np.float32),
        output_mean=output_mean,
        output_scale=output_scale,
    )

    def build(name: str, selector: Array) -> Split:
        return Split(
            name=name,
            inputs=inputs[selector],
            outputs=outputs[selector],
            mask=mask[selector],
            shape_ids=shape_ids[selector],
            alpha_deg=alpha[selector],
        )

    return Dataset(
        train=build("train", is_train),
        validation=build("validation", is_validation),
        test=build("test", is_test),
        normalisation=normalisation,
    )
