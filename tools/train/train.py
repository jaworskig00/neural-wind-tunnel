"""Training loop for the surrogate.

Run from the repository root::

    uv run python -m tools.train.train
    uv run python -m tools.train.train --epochs 60 --quick    # a short run for a smoke check

Deterministic: the seed fixes the split, the initialisation and the batch order, so two runs of the
same command produce the same weights.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

from tools.train.data import MASKED_OUTPUT, Dataset, Split, load
from tools.train.model import Surrogate, group_weights

DEFAULT_MODELS = Path("models")

#: Training hyper-parameters. Not tuned far: the mapping is smooth and the data is plentiful, so the
#: first sensible choice already fits well. Any change here is recorded in docs/accuracy.md.
DEFAULT_EPOCHS = 400
DEFAULT_BATCH = 1024
DEFAULT_LEARNING_RATE = 2.0e-3
PATIENCE = 40


@dataclass
class TrainingReport:
    """Everything needed to reproduce and judge a run."""

    epochs_run: int
    best_epoch: int
    train_loss: float
    validation_loss: float
    test_loss: float
    parameters: int
    seconds: float
    seed: int
    batch_size: int
    learning_rate: float


def _tensors(split: Split, device: torch.device) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    return (
        torch.tensor(split.inputs, device=device),
        torch.tensor(split.outputs, device=device),
        torch.tensor(split.mask, device=device),
    )


def weighted_loss(
    predicted: torch.Tensor,
    target: torch.Tensor,
    mask: torch.Tensor,
    weights: torch.Tensor,
) -> torch.Tensor:
    """Masked, group-weighted mean squared error in normalised output space.

    Dividing by the mask's own weighted sum rather than by the element count keeps the drag term's
    contribution independent of how many rows in a batch happen to have converged.
    """
    squared = (predicted - target) ** 2 * mask * weights
    denominator = (mask * weights).sum().clamp_min(1e-12)
    return squared.sum() / denominator


def evaluate(
    model: Surrogate,
    split: Split,
    normalisation_tensors: tuple[torch.Tensor, torch.Tensor],
    weights: torch.Tensor,
    device: torch.device,
) -> float:
    """Validation or test loss, in the same normalised space the training loss uses."""
    output_mean, output_scale = normalisation_tensors
    inputs, outputs, mask = _tensors(split, device)
    model.eval()
    with torch.no_grad():
        predicted = model(inputs)
        normalised_predicted = (predicted - output_mean) / output_scale
        normalised_target = (outputs - output_mean) / output_scale
        return float(weighted_loss(normalised_predicted, normalised_target, mask, weights))


def train(
    data: Dataset,
    epochs: int = DEFAULT_EPOCHS,
    batch_size: int = DEFAULT_BATCH,
    learning_rate: float = DEFAULT_LEARNING_RATE,
    seed: int = 20261024,
    verbose: bool = True,
) -> tuple[Surrogate, TrainingReport]:
    """Fit the surrogate, keeping the weights from the best validation epoch."""
    torch.manual_seed(seed)
    device = torch.device("cpu")
    started = time.perf_counter()

    model = Surrogate(data.normalisation).to(device)
    weights = group_weights(device)
    output_mean = torch.tensor(data.normalisation.output_mean, device=device)
    output_scale = torch.tensor(data.normalisation.output_scale, device=device)

    inputs, outputs, mask = _tensors(data.train, device)
    normalised_inputs = (inputs - model.input_mean) / model.input_scale
    normalised_outputs = (outputs - output_mean) / output_scale

    optimiser = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    schedule = torch.optim.lr_scheduler.CosineAnnealingLR(optimiser, T_max=epochs)
    generator = torch.Generator().manual_seed(seed)

    best_validation = float("inf")
    best_state = {key: value.clone() for key, value in model.state_dict().items()}
    best_epoch = 0
    train_loss = float("nan")

    for epoch in range(1, epochs + 1):
        model.train()
        order = torch.randperm(len(data.train), generator=generator)
        epoch_loss = 0.0
        batches = 0
        for begin in range(0, len(order), batch_size):
            batch = order[begin : begin + batch_size]
            optimiser.zero_grad(set_to_none=True)
            predicted = model.forward_normalised(normalised_inputs[batch])
            loss = weighted_loss(predicted, normalised_outputs[batch], mask[batch], weights)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
            epoch_loss += float(loss)
            batches += 1
        schedule.step()
        train_loss = epoch_loss / max(batches, 1)

        validation_loss = evaluate(
            model, data.validation, (output_mean, output_scale), weights, device
        )
        if validation_loss < best_validation:
            best_validation = validation_loss
            best_state = {key: value.clone() for key, value in model.state_dict().items()}
            best_epoch = epoch

        if verbose and (epoch % 20 == 0 or epoch == 1):
            print(
                f"  epoch {epoch:4d}  train {train_loss:.5f}  validation {validation_loss:.5f}"
                f"  best {best_validation:.5f} at {best_epoch}",
                flush=True,
            )

        if epoch - best_epoch >= PATIENCE:
            if verbose:
                print(f"  no improvement for {PATIENCE} epochs, stopping at {epoch}", flush=True)
            break
    else:
        epoch = epochs

    model.load_state_dict(best_state)
    test_loss = evaluate(model, data.test, (output_mean, output_scale), weights, device)

    report = TrainingReport(
        epochs_run=epoch,
        best_epoch=best_epoch,
        train_loss=train_loss,
        validation_loss=best_validation,
        test_loss=test_loss,
        parameters=model.parameter_count,
        seconds=time.perf_counter() - started,
        seed=seed,
        batch_size=batch_size,
        learning_rate=learning_rate,
    )
    return model, report


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--learning-rate", type=float, default=DEFAULT_LEARNING_RATE)
    parser.add_argument("--seed", type=int, default=20261024)
    parser.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    parser.add_argument("--quick", action="store_true", help="shorter run, for a smoke check")
    args = parser.parse_args()

    epochs = 20 if args.quick else args.epochs

    print("loading the dataset", flush=True)
    data = load(seed=args.seed)
    print(
        f"  train {len(data.train)}  validation {len(data.validation)}  test {len(data.test)}",
        flush=True,
    )

    print(f"training for up to {epochs} epochs", flush=True)
    model, report = train(
        data,
        epochs=epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        seed=args.seed,
    )
    print(
        f"  best validation {report.validation_loss:.5f} at epoch {report.best_epoch}, "
        f"test {report.test_loss:.5f}, {report.seconds:.0f}s",
        flush=True,
    )

    args.models.mkdir(parents=True, exist_ok=True)
    checkpoint = args.models / "surrogate.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "normalisation": {
                key: np.asarray(value).tolist() for key, value in vars(data.normalisation).items()
            },
            "report": asdict(report),
        },
        checkpoint,
    )
    (args.models / "training-report.json").write_text(
        json.dumps(asdict(report), indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {checkpoint}")
    print(f"masked output index {MASKED_OUTPUT} is drag, trained on converged rows only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
