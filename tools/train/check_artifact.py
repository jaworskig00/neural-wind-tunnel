"""Assert that the exported artifacts still reproduce the reference case.

Run locally after an export, and in continuous integration against the published Release, so a
regression in the export path, the runtime or the weight layout fails loudly rather than quietly
changing what the app predicts.

Both artifacts are checked: the ONNX graph through its runtime, and the raw float32 blob through an
independent forward pass written here. That second pass deliberately duplicates the TypeScript
backend's arithmetic -- if the two ever disagree, the blob layout or the activation has drifted.

    uv run python -m tools.train.check_artifact
    uv run python -m tools.train.check_artifact --models public/models
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from tools.train.model import INPUT_SIZE, OUTPUT_SIZE
from tools.train.train import DEFAULT_MODELS


def forward_from_blob(blob: NDArray[np.float32], manifest: dict, inputs: NDArray) -> NDArray:
    """The model as plain arithmetic over the flat blob, mirroring `src/ml/typescriptBackend.ts`."""
    if manifest["activation"] != "silu":
        raise ValueError(f"unsupported activation {manifest['activation']}")

    offset = 0

    def take(count: int) -> NDArray[np.float32]:
        nonlocal offset
        block = blob[offset : offset + count]
        if block.size != count:
            raise ValueError(f"blob ran out at offset {offset}, needed {count}")
        offset += count
        return block

    input_mean = take(INPUT_SIZE)
    input_scale = take(INPUT_SIZE)
    output_mean = take(OUTPUT_SIZE)
    output_scale = take(OUTPUT_SIZE)

    activations = (inputs - input_mean) / input_scale
    layers = manifest["layers"]
    for index, layer in enumerate(layers):
        weight = take(layer["out"] * layer["in"]).reshape(layer["out"], layer["in"])
        bias = take(layer["out"])
        activations = activations @ weight.T + bias
        if index < len(layers) - 1:
            activations = activations / (1.0 + np.exp(-activations))

    if offset != blob.size:
        raise ValueError(f"{blob.size - offset} floats left over after the manifest")
    return activations * output_scale + output_mean


def check(models: Path) -> int:
    reference = json.loads((models / "reference_case.json").read_text())
    inputs = np.asarray(reference["inputs"], dtype=np.float32)
    expected = np.asarray(reference["outputs"], dtype=np.float32)
    tolerance = float(reference["tolerance"])

    failures: list[str] = []

    import onnxruntime

    session = onnxruntime.InferenceSession(
        str(models / "surrogate.onnx"), providers=["CPUExecutionProvider"]
    )
    onnx_output = session.run(None, {"design": inputs})[0]
    onnx_deviation = float(np.abs(onnx_output - expected).max())
    print(f"  onnx runtime      max deviation {onnx_deviation:.3e} (tolerance {tolerance:.0e})")
    if onnx_deviation > tolerance:
        failures.append(f"ONNX output drifted by {onnx_deviation:.3e}")

    manifest = json.loads((models / "manifest.json").read_text())
    blob = np.frombuffer((models / "weights.bin").read_bytes(), dtype=np.float32)
    blob_output = forward_from_blob(blob, manifest, inputs)
    blob_deviation = float(np.abs(blob_output - expected).max())
    print(f"  raw weight blob   max deviation {blob_deviation:.3e} (tolerance {tolerance:.0e})")
    if blob_deviation > tolerance:
        failures.append(f"raw blob output drifted by {blob_deviation:.3e}")

    agreement = float(np.abs(onnx_output - blob_output).max())
    print(f"  onnx against blob max deviation {agreement:.3e}")
    if agreement > tolerance:
        failures.append(f"the two artifacts disagree by {agreement:.3e}")

    # A prediction that is numerically stable but physically absurd would pass every check above.
    lift = onnx_output[:, 128]
    drag = onnx_output[:, 129]
    if not np.all(np.abs(lift) < 3.0):
        failures.append(f"lift out of range: {lift}")
    if not np.all((drag > 0.0) & (drag < 0.05)):
        failures.append(f"drag out of range: {drag}")
    print(f"  reference lift    {np.round(lift, 4).tolist()}")
    print(f"  reference drag    {np.round(drag, 5).tolist()}")

    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    args = parser.parse_args()
    print(f"checking artifacts in {args.models}")
    return check(args.models)


if __name__ == "__main__":
    raise SystemExit(main())
