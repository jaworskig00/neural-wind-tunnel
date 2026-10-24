# Performance

Measured, not estimated. Every number here comes from a run described below and can be reproduced.

## Budgets

| Budget                         | Limit       | Measured               |
| ------------------------------ | ----------- | ---------------------- |
| Entry JS bundle                | 100 kB gzip | 88.7 kB                |
| Renderer chunk, lazily loaded  | 300 kB gzip | 255.2 kB               |
| Assistant chunk, lazily loaded | 15 kB gzip  | 8.3 kB                 |
| Stylesheet                     | 12 kB gzip  | 4.3 kB                 |
| Surrogate inference, p95       | 5 ms        | 0.9 ms                 |
| Model artifact                 | 1 MB        | 0.71 MB                |
| Mode atlas                     | 3 MB        | 2.43 MB                |
| Particles at 60 fps            | 500 000     | 1 048 576, vsync-bound |

The bundle budgets are enforced by `size-limit` on every push; the rest are measured here.

## The frame

Five stages run per frame, and only one of them runs unconditionally.

| Stage                         | When                   | Cost                                                               |
| ----------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Surrogate inference           | The design changes     | 0.9 ms p95, on the CPU                                             |
| Field reconstruction          | The prediction changes | One pass over 192 x 96, 33 texture fetches per texel               |
| Body mask                     | The shape changes      | 160 triangles into a 384 x 192 target                              |
| Particle advection            | Every frame            | One pass over the position texture, two field samples per particle |
| Trails: fade, draw, composite | Every frame            | Three passes at canvas resolution                                  |

Dragging a slider changes the design, so all five run; orbiting the camera runs only the last two.

## Apple M4 Pro, ANGLE Metal

Browser at a 1408 x 1394 drawing buffer, measured over 200 frames after discarding the first 40.

| Tier | Particles | Median frame | p95    |
| ---- | --------- | ------------ | ------ |
| low  | 65 536    | 8.3 ms       | 8.7 ms |
| mid  | 262 144   | 8.3 ms       | 9.9 ms |
| high | 1 048 576 | 8.3 ms       | 9.9 ms |

Every tier lands on exactly 8.3 ms, which is 120 frames per second: the loop is bound by the
display's refresh rate, not by the GPU. Raising the drawing buffer to 3200 x 2018 changed nothing —
still 8.3 ms at a million particles.

**So the honest statement is not "a million particles at 120 fps" but "the particle work is too
small to measure against a 120 Hz vsync on this hardware".** The plan's budget of 60 fps at 500 000
particles is met with the frame time at half the budget and the particle count at double it, and the
real cost could not be isolated from the frame cadence. Isolating it would need
`EXT_disjoint_timer_query_webgl2`, which is not worth the code for a number nobody acts on.

## ANGLE SwiftShader, software rendering

The slowest thing this will ever run on: no GPU at all, running in continuous integration. Measured
by `tests/e2e/performance.spec.ts` over 150 frames after discarding the first 30.

| Tier | Particles | Median frame | p95      |
| ---- | --------- | ------------ | -------- |
| low  | 65 536    | 16.7 ms      | 16.8 ms  |
| mid  | 262 144   | 33.7 ms      | 35.8 ms  |
| high | 1 048 576 | 34.2 ms      | 108.5 ms |

This is the measurement that justifies the tiering. On a software renderer the low tier still holds
60 frames per second, the middle one halves to 30, and the high one is visibly unwell — a median of
34 ms with a p95 three times that, which is the signature of frames that occasionally take far
longer than the rest.

## A GitHub runner, no GPU, shared cores

The same spec, on the machine continuous integration happens to get.

| Tier | Particles | Median frame |
| ---- | --------- | ------------ |
| high | 1 048 576 | 510 ms       |

Two frames per second. This is not a defect to fix, it is the floor the tiering exists for, and it
is why the end-to-end suite asserts only that the loop keeps producing frames rather than any
threshold on the median. A pass or fail on a shared runner's frame time measures the runner.

## Choosing a tier

The capability check is only a first guess: it reports what the hardware claims to support, which
says nothing about whether it will sustain a million particles. So `src/gpgpu/frameProbe.ts` measures.

- A window of 50 frames, then a decision.
- The **median**, not the mean, so one long frame — a tab regaining focus, a shader compile —
  cannot force a downgrade.
- Down above 20 ms, up below 11 ms. The gap between the thresholds is what stops it oscillating
  between two tiers on borderline hardware.
- A 60-frame hold after any change, so the new tier settles before it is judged.
- Down quickly, up slowly. Dropping a tier is barely visible; stuttering is the first thing anyone
  notices.

Picking a tier by hand freezes the probe: a choice made by the viewer is not second-guessed.

## Reproducing this

```bash
pnpm build && pnpm preview --port 5190     # then measure frames in the browser console
pnpm exec playwright test tests/e2e/performance.spec.ts --workers=1
pnpm build && pnpm size
```

The Playwright run prints the median and p95 per tier. The browser measurement is a loop over
`requestAnimationFrame` collecting deltas, discarding the first frames, and taking percentiles —
the same arithmetic as the test.

## What is not measured

- Any GPU other than these two. The tiering exists precisely because the rest are unknown.
- The cost of the individual passes, for the reason given above.
- Memory. The mode atlas is 2.4 MB, the position textures at the high tier are 16 MB across both
  buffers, and the trail buffers scale with canvas area; none of it has been profiled.
