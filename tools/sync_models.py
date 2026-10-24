#!/usr/bin/env python3
"""Place the model artifacts where the app can fetch them.

The app loads `public/models/*` from its own origin: no cross-origin request, no dependency on
GitHub being reachable at run time, and the production build is a plain static directory. The
artifacts themselves are generated output and are not committed (ADR-012), so this script puts them
there, preferring a local build and falling back to the published Release.

    uv run python tools/sync_models.py            # from ./models if present, else the Release
    uv run python tools/sync_models.py --release   # always from the Release
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

LOCAL_MODELS = Path("models")
LOCAL_DATA = Path("data/generated")
PUBLIC_MODELS = Path("public/models")
RELEASE_TAG = "dataset-v1"

#: What the app needs, and where a local build leaves each one.
ARTIFACTS = {
    "surrogate.onnx": LOCAL_MODELS,
    "weights.bin": LOCAL_MODELS,
    "manifest.json": LOCAL_MODELS,
    "reference_case.json": LOCAL_MODELS,
    "pod_modes.bin": LOCAL_DATA,
    "cp_stations.json": LOCAL_DATA,
}

#: Artifacts the Release carries. The model itself is published with its own tag once trained.
RELEASE_ARTIFACTS = {"pod_modes.bin", "cp_stations.json"}


def copy_local(name: str, source_directory: Path) -> bool:
    source = source_directory / name
    if not source.exists():
        return False
    shutil.copy2(source, PUBLIC_MODELS / name)
    return True


def download_from_release(name: str, tag: str) -> bool:
    if name not in RELEASE_ARTIFACTS:
        return False
    result = subprocess.run(
        [
            "gh",
            "release",
            "download",
            tag,
            "--pattern",
            name,
            "--dir",
            str(PUBLIC_MODELS),
            "--clobber",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print(f"  {name}: release download failed: {result.stderr.strip()}", file=sys.stderr)
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--release", action="store_true", help="ignore local builds")
    parser.add_argument("--tag", default=RELEASE_TAG)
    args = parser.parse_args()

    PUBLIC_MODELS.mkdir(parents=True, exist_ok=True)
    missing: list[str] = []

    for name, directory in ARTIFACTS.items():
        placed = False
        if not args.release:
            placed = copy_local(name, directory)
        if not placed:
            placed = download_from_release(name, args.tag)
        print(f"  {name}: {'ok' if placed else 'MISSING'}")
        if not placed:
            missing.append(name)

    if missing:
        print(
            "\nmissing artifacts: "
            + ", ".join(missing)
            + "\nrun `uv run python -m tools.train.train` then "
            + "`uv run python -m tools.train.export` first",
            file=sys.stderr,
        )
        return 1
    print(f"\nsynced into {PUBLIC_MODELS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
