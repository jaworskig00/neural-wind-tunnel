"""Export the trained surrogate for the browser.

Two artifacts, deliberately:

* ``surrogate.onnx`` -- the canonical model, run by ONNX Runtime Web.
* ``weights.bin`` plus ``manifest.json`` -- the same weights as a flat float32 blob, which
  ``src/ml`` reads for the hand-written TypeScript backend. That backend exists to prove the model
  is understood rather than merely invoked, to keep a working path if the runtime regresses, and to
  give a numerical parity test something to compare against (ADR-006).

Plus ``reference_case.json``: one input with its expected output, which both browser backends and
the continuous integration check are held to.

Run from the repository root::

    uv run python -m tools.train.export
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from tools.train.data import INPUT_COLUMNS, OUTPUT_COLUMNS, Normalisation
from tools.train.model import Surrogate
from tools.train.train import DEFAULT_MODELS

#: Tolerance the exported ONNX graph must match the PyTorch module to.
EXPORT_TOLERANCE = 1e-5

#: Inputs the reference case is evaluated at: a stock section across the incidence range, so a
#: regression in either backend shows up as a visible difference rather than a rounding wobble.
REFERENCE_ALPHAS = (-4.0, 0.0, 4.0, 8.0)


def load_checkpoint(models: Path) -> tuple[Surrogate, Normalisation]:
    """Rebuild the module from the checkpoint `tools.train.train` wrote."""
    checkpoint = torch.load(models / "surrogate.pt", weights_only=True)
    stored = checkpoint["normalisation"]
    normalisation = Normalisation(
        input_mean=np.asarray(stored["input_mean"], dtype=np.float32),
        input_scale=np.asarray(stored["input_scale"], dtype=np.float32),
        output_mean=np.asarray(stored["output_mean"], dtype=np.float32),
        output_scale=np.asarray(stored["output_scale"], dtype=np.float32),
    )
    model = Surrogate(normalisation)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, normalisation


def linear_layers(model: Surrogate) -> list[torch.nn.Linear]:
    return [layer for layer in model.layers if isinstance(layer, torch.nn.Linear)]


def write_raw_weights(model: Surrogate, normalisation: Normalisation, models: Path) -> dict:
    """Flat float32 blob plus the manifest that describes it.

    Layout, little-endian float32 throughout, in exactly this order: input mean, input scale,
    output mean, output scale, then for each layer its weight matrix row-major as
    ``[out, in]`` followed by its bias. The TypeScript backend walks the same list.
    """
    blocks: list[np.ndarray] = [
        normalisation.input_mean,
        normalisation.input_scale,
        normalisation.output_mean,
        normalisation.output_scale,
    ]
    layers = []
    for layer in linear_layers(model):
        weight = layer.weight.detach().numpy().astype(np.float32)
        bias = layer.bias.detach().numpy().astype(np.float32)
        blocks.extend([weight.ravel(), bias])
        layers.append({"in": int(weight.shape[1]), "out": int(weight.shape[0])})

    blob = np.concatenate([np.asarray(block, dtype=np.float32).ravel() for block in blocks])
    (models / "weights.bin").write_bytes(blob.tobytes())

    manifest = {
        "format": "neural-wind-tunnel-surrogate/1",
        "dtype": "float32",
        "endianness": "little",
        "inputs": list(INPUT_COLUMNS),
        "outputs": list(OUTPUT_COLUMNS),
        "activation": "silu",
        "layers": layers,
        "layout": [
            "inputMean",
            "inputScale",
            "outputMean",
            "outputScale",
            "then per layer: weight as [out, in] row-major, then bias",
        ],
        "floats": int(blob.size),
        "bytes": int(blob.nbytes),
    }
    (models / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_onnx(model: Surrogate, models: Path) -> Path:
    """Export the canonical ONNX graph, with a dynamic batch axis."""
    path = models / "surrogate.onnx"
    example = torch.zeros(1, len(INPUT_COLUMNS), dtype=torch.float32)
    torch.onnx.export(
        model,
        (example,),
        str(path),
        input_names=["design"],
        output_names=["prediction"],
        dynamic_axes={"design": {0: "batch"}, "prediction": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    return path


def check_onnx_parity(model: Surrogate, path: Path, inputs: np.ndarray) -> float:
    """Largest absolute disagreement between the ONNX graph and the PyTorch module."""
    import onnxruntime

    session = onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    onnx_output = session.run(None, {"design": inputs.astype(np.float32)})[0]
    with torch.no_grad():
        torch_output = model(torch.tensor(inputs, dtype=torch.float32)).numpy()
    return float(np.abs(onnx_output - torch_output).max())


def reference_inputs() -> np.ndarray:
    """A stock section swept across incidence, as the reference case."""
    from tools.solver.geometry import fit_cst, naca4

    upper, lower = fit_cst(naca4("2412", panel_count=320))
    rows = [
        np.concatenate([upper, lower, [alpha]]).astype(np.float32) for alpha in REFERENCE_ALPHAS
    ]
    return np.stack(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    args = parser.parse_args()

    model, normalisation = load_checkpoint(args.models)
    manifest = write_raw_weights(model, normalisation, args.models)
    onnx_path = write_onnx(model, args.models)

    inputs = reference_inputs()
    deviation = check_onnx_parity(model, onnx_path, inputs)
    if deviation > EXPORT_TOLERANCE:
        raise RuntimeError(f"ONNX disagrees with PyTorch by {deviation:.2e}")

    with torch.no_grad():
        expected = model(torch.tensor(inputs)).numpy()

    (args.models / "reference_case.json").write_text(
        json.dumps(
            {
                "note": "Both browser backends and CI are held to these outputs.",
                "inputs": inputs.tolist(),
                "outputs": expected.tolist(),
                "tolerance": 1e-4,
                "alphaDeg": list(REFERENCE_ALPHAS),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    size = onnx_path.stat().st_size
    print(f"wrote {onnx_path} ({size / 1e6:.3f} MB)")
    print(f"wrote weights.bin ({manifest['bytes'] / 1e6:.3f} MB, {manifest['floats']} floats)")
    print(f"ONNX agrees with PyTorch to {deviation:.2e}")

    # Print the lift the reference case predicts, so a broken export is obvious here rather than
    # three milestones later inside a shader.
    lift_index = OUTPUT_COLUMNS.index("cl")
    print(
        f"reference lift {expected[:, lift_index].round(4).tolist()} at {REFERENCE_ALPHAS} degrees"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
