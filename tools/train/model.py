"""The surrogate network.

A plain multilayer perceptron, deliberately. The input is thirteen numbers -- twelve CST weights
and incidence -- and the mapping to pressure, forces and modal coefficients is smooth, so there is
nothing a convolution or an attention layer would buy except size and an export headache. What
matters is that it fits in under a megabyte, runs in single-digit milliseconds in a browser, and can
be re-implemented in eighty lines of TypeScript as a cross-check.

Normalisation is folded into the exported module as buffers, so the browser feeds raw CST weights
and degrees and reads back real pressure coefficients. Keeping the statistics outside the graph
would mean shipping them separately and getting them wrong once.
"""

from __future__ import annotations

import torch
from torch import nn

from tools.train.data import INPUT_COLUMNS, OUTPUT_COLUMNS, Normalisation

INPUT_SIZE = len(INPUT_COLUMNS)
OUTPUT_SIZE = len(OUTPUT_COLUMNS)

#: Three hidden layers of 256. Roughly 177 000 parameters, 0.71 MB as float32.
HIDDEN_SIZES = (256, 256, 256)


class Surrogate(nn.Module):
    """Normalise, predict, de-normalise."""

    def __init__(self, normalisation: Normalisation, hidden_sizes: tuple[int, ...] = HIDDEN_SIZES):
        super().__init__()

        layers: list[nn.Module] = []
        width = INPUT_SIZE
        for size in hidden_sizes:
            layers.append(nn.Linear(width, size))
            # SiLU rather than ReLU: the targets are smooth functions of the inputs and a kinked
            # activation shows up as visible faceting in the predicted pressure distribution.
            layers.append(nn.SiLU())
            width = size
        layers.append(nn.Linear(width, OUTPUT_SIZE))
        self.layers = nn.Sequential(*layers)

        self.register_buffer("input_mean", torch.tensor(normalisation.input_mean))
        self.register_buffer("input_scale", torch.tensor(normalisation.input_scale))
        self.register_buffer("output_mean", torch.tensor(normalisation.output_mean))
        self.register_buffer("output_scale", torch.tensor(normalisation.output_scale))

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        """Raw inputs in, raw outputs out."""
        normalised = (inputs - self.input_mean) / self.input_scale
        return self.layers(normalised) * self.output_scale + self.output_mean

    def forward_normalised(self, normalised_inputs: torch.Tensor) -> torch.Tensor:
        """The bare network, for a training loop that works in normalised space."""
        return self.layers(normalised_inputs)

    @property
    def parameter_count(self) -> int:
        return sum(p.numel() for p in self.parameters())


def group_weights(device: torch.device | None = None) -> torch.Tensor:
    """Per-output loss weights.

    The three scalar coefficients are the numbers anyone actually reads, and there are 128 pressure
    stations and 32 modal coefficients competing with them. Each of the three groups is given equal
    total weight and spreads it evenly inside itself, so lift and drag are not drowned by the
    pressure distribution simply because there is more of it.
    """
    from tools.train.data import CP_COLUMNS, POD_COLUMNS, SCALAR_COLUMNS

    weights = torch.empty(OUTPUT_SIZE, dtype=torch.float32, device=device)
    weights[: len(CP_COLUMNS)] = 1.0 / len(CP_COLUMNS)
    scalar_start = len(CP_COLUMNS)
    weights[scalar_start : scalar_start + len(SCALAR_COLUMNS)] = 1.0 / len(SCALAR_COLUMNS)
    weights[scalar_start + len(SCALAR_COLUMNS) :] = 1.0 / len(POD_COLUMNS)
    return weights
