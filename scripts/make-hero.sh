#!/usr/bin/env bash
# Turns the frames captured by `tests/e2e/media.spec.ts` into the README's hero animation.
#
#   CAPTURE_MEDIA=1 pnpm exec playwright test media
#   scripts/make-hero.sh
#
# Two outputs. The GIF is what the README shows, because it is the only animation GitHub renders
# from a relative path; the MP4 is four times smaller at twice the resolution and is there for the
# eventual live site. Both are kept under a megabyte, because this repository holds no large
# binaries -- the dataset and the model live in Releases for the same reason.
#
# A field of particles is close to noise, which is the worst case for a palette-indexed format, so
# the GIF is deliberately small and undithered: dithering doubles the size and the banding it
# removes is invisible at this scale.
set -euo pipefail

frames="docs/media/frames"
out="docs/media"

test -d "$frames" || { echo "No frames in $frames. Run the capture first." >&2; exit 1; }

ffmpeg -y -loglevel error -framerate 20 -pattern_type glob -i "$frames/hero-*.png" \
  -vf "scale=720:-2:flags=lanczos" -c:v libx264 -pix_fmt yuv420p -crf 30 -preset slow \
  "$out/hero.mp4"

ffmpeg -y -loglevel error -framerate 20 -pattern_type glob -i "$frames/hero-*.png" \
  -vf "fps=9,scale=360:-2:flags=lanczos,palettegen=max_colors=36:stats_mode=diff" \
  "$out/hero-palette.png"

ffmpeg -y -loglevel error -framerate 20 -pattern_type glob -i "$frames/hero-*.png" \
  -i "$out/hero-palette.png" \
  -lavfi "fps=9,scale=360:-2:flags=lanczos[v];[v][1:v]paletteuse=dither=none:diff_mode=rectangle" \
  "$out/hero.gif"

rm -f "$out/hero-palette.png"
ls -lh "$out/hero.mp4" "$out/hero.gif"
