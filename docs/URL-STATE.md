# URL state format — contract version 1

The full application state that matters for sharing lives in the URL hash, so any view can be
linked, bookmarked and reproduced. The hash is used rather than the query string so that a
static host never sees the parameters and no server round trip is needed.

This is also the deep-link contract for the sister project
[design-space-explorer](https://github.com/jaworskig00/design-space-explorer), which links a
selected design into this app.

## Format

```
https://<host>/#v=1&au=<6 floats>&al=<6 floats>&a=<deg>&view=<mode>&cam=<az,el,dist>
```

Ampersand-separated `key=value` pairs. Floats use a dot as the decimal separator and are
written with at most four decimals. Lists are comma-separated with no spaces.

The preset names below are the whole set; `src/geometry/presets.ts` is the canonical list, and a
reader should treat any name it does not recognise as a malformed value rather than assume one.

| Key     | Required       | Type     | Default     | Meaning                                                                                                                                                                                  |
| ------- | -------------- | -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`     | yes            | int      | —           | Contract version. A reader that does not recognise the value loads defaults and shows a notice.                                                                                          |
| `au`    | yes unless `p` | 6 floats | —           | Upper-surface CST weights, `cst_u_0` first.                                                                                                                                              |
| `al`    | yes unless `p` | 6 floats | —           | Lower-surface CST weights, `cst_l_0` first.                                                                                                                                              |
| `p`     | no             | string   | —           | Preset name instead of explicit weights: `naca0008`, `naca0012`, `naca2412` or `naca4412`. Ignored if `au` and `al` are present. An unknown name falls back to `naca2412` with a notice. |
| `a`     | no             | float    | `2.0`       | Angle of attack in degrees, clamped to the trained range.                                                                                                                                |
| `view`  | no             | enum     | `particles` | `particles`, `streamlines`, `both` or `surface`.                                                                                                                                         |
| `cam`   | no             | 3 floats | `45,18,3.2` | Camera azimuth and elevation in degrees, then distance in chords.                                                                                                                        |
| `cmap`  | no             | enum     | `coolwarm`  | Surface colormap: `coolwarm` or `cividis`, the latter colour-blind safe.                                                                                                                 |
| `tier`  | no             | enum     | auto        | Particle count override: `low`, `mid` or `high`. Absent means the FPS probe decides.                                                                                                     |
| `chart` | no             | enum     | `cp`        | Which chart is open: `cp`, `polar` or `none`.                                                                                                                                            |

## Reader rules

1. Unknown keys are ignored, never an error — a future version may add keys.
2. Missing optional keys take their default.
3. Values outside the valid range are clamped, and the clamp is surfaced in the UI rather than
   silently applied.
4. A malformed `au` or `al` (wrong count, unparseable) falls back to `naca2412` with a notice.
5. The app rewrites the hash with `history.replaceState` as the user interacts, so the address
   bar always holds a shareable link without polluting the history stack.
6. `v` mismatch loads defaults. The app never guesses at an older or newer layout.

## Examples

A cambered section at five degrees, both visualisations on:

```
#v=1&au=0.17,0.22,0.19,0.21,0.18,0.14&al=-0.14,-0.11,-0.06,0.02,0.05,0.03&a=5&view=both
```

A preset with the polar chart open:

```
#v=1&p=naca0012&a=0&chart=polar
```

Minimal deep link the explorer can build from a dataset row — take the twelve `cst_*` columns
and `alpha_deg` straight from the row:

```
#v=1&au=<cst_u_0..5>&al=<cst_l_0..5>&a=<alpha_deg>&view=particles
```

## Versioning

A change that removes a key, renames one, or alters the meaning of an existing value bumps the
contract version and is recorded in `CHANGELOG.md`. Adding a new optional key does not, because
readers ignore unknown keys. When the version is bumped, the previous version stays readable
for at least one release.
