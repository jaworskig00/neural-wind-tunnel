# Accessibility

What this app does for keyboard and screen-reader users, what it does about reduced motion, and
where it still falls short. Measured rather than asserted: the contrast figures below are computed
from the tokens in `src/index.css`, and the behaviours are covered by
`tests/e2e/accessibility.spec.ts`.

## Keyboard

Every control is a native element — `<button>`, `<input type="range">`, `<details>` — so tab order,
activation and the arrow-key, Home and End behaviour of the sliders come from the browser rather
than from anything hand-rolled. The test drives the incidence slider with the arrow keys, Home and
End, opens the CST disclosure and moves one of the twelve weights.

Focus is drawn with a two-pixel accent ring on `:focus-visible`, offset from the control's own
border so it never merges with it. Mouse users see nothing, which is the point of the pseudo-class.

The one thing you cannot do from the keyboard is orbit the camera. Three's `OrbitControls` is a
pointer-driven control and giving it a keyboard mode would mean reimplementing it. The view it
exposes is not load-bearing: every number the scene visualises — the coefficients, the pressure
distribution, the polars — is also in the header and the charts, which are reachable and labelled.

## Screen readers

The canvas is labelled as an image with a description that says what it shows and where to read the
same figures as text. Each chart is an `<svg role="img">` with a name: the pressure plot announces
that its axis is inverted, the colour scale announces what it maps, and the two polars carry the
quantities they relate. Axis ticks are real `<text>` nodes, so the numbers are selectable and
readable rather than painted.

## Reduced motion

`prefers-reduced-motion: reduce` is honoured, not noted. The chrome drops its transitions, and the
scene stops advecting the particles — but rather than leave a frozen cloud of dots, which would say
nothing at all, it draws the same field as streamlines. The flow is still visible; it simply stands
still.

The panel says this has happened and offers to animate anyway, for someone who runs the setting
system-wide but wants to see this particular thing move. That choice is deliberately kept out of
the shareable URL: a link should not impose motion on whoever opens it.

## Contrast

Computed against the two surfaces text actually sits on. WCAG AA wants 4.5:1 for body text and 3:1
for the parts of a control that identify it.

| Token    | on `--color-base` | on `--color-surface` | Used for                   |
| -------- | ----------------- | -------------------- | -------------------------- |
| `text`   | 15.2              | 13.9                 | values, headings           |
| `muted`  | 6.7               | 6.1                  | labels, axis numbers       |
| `faint`  | 4.9               | 4.5                  | captions, units, hints     |
| `accent` | 9.0               | 8.2                  | selected state, focus ring |
| `warn`   | 8.7               | 8.0                  | notices                    |
| `line`   | 1.4               | 1.3                  | borders and grid only      |

`faint` was `#5a6977` through M6, which is 3.4:1 — below AA for the caption-sized text it is used
on. It is now `#738698`. `line` stays where it is: it draws structural rules and the grid in the
scene, never a control boundary that has to be found. The slider track, which does have to be
found, is `faint` rather than `line`.

The pressure colormaps are a separate question. `coolwarm` is not colourblind-safe at the ends;
`cividis` is, and is one click away in the legend. Both carry a numeric scale, so the mapping is
readable without relying on hue.

## Not covered

- No keyboard camera control, as above.
- No live region announcing new coefficients as a slider moves; it would speak continuously during
  a drag. The values are in the DOM and readable on demand.
- No high-contrast or light theme. The palette is one dark scheme, checked at AA.
