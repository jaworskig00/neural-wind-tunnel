# Open questions

Anything that needs a human decision, or a default that was chosen while running unattended and
deserves a second look. An agent working autonomously appends here instead of stopping.

Format: one dated entry per item, with the default that was applied in the meantime.

## Needs a human decision

### Q9 — The deep link from the sister project

**Status.** open · **Blocks.** nothing
Planned from the first session, never built, and this document said nothing about it until after
v1.0.0 — which is the kind of omission this file exists to prevent.

`design-space-explorer` chose its own parametrisation and its ADR-002 declines to consume this
project's dataset or render a link here. `URL-STATE.md` is a finished contract with no second
reader. Turning the link on needs three things: a deployed URL (Q1), a mapping from that
project's `(camber, camber_pos, thickness)` onto twelve CST weights — which exists in Python as
`fit_cst` in `tools/solver/geometry.py` but has no TypeScript counterpart — and a decision about
Reynolds number, which is a sampled dimension there and fixed at 1e6 here, so a linked row would
silently change meaning.

The cheapest shape, if it is ever wanted: this app accepts an optional `naca=m,p,t` key and fits
the weights itself. Readers ignore unknown keys, so that adds no contract version, and the
explorer then needs to know nothing about CST.

## Deferred by decision, recorded for completeness

### Q3 — Reynolds number as a model input

Fixed at 1e6 for v1 (ADR-009). Making it an input multiplies the dataset and the training time.
In the v2 backlog; the column already exists in the schema so the dataset can grow without a
schema break.

### Q4 — Three-dimensional bodies

Out of scope for v1 (ADR-001). A finite wing needs a span-wise decomposition and a different
surrogate. In the v2 backlog.

### Q5 — WebGPU compute path

WebGL2 only in v1 (ADR-005). The particle system sits behind an interface so a WebGPU backend can
be added without a rewrite. In the v2 backlog.

### Q6 — A key-hiding proxy for the assistant

Bring-your-own-key only in v1 (ADR-008). A proxy would mean infrastructure, an operating cost and
a departure from a purely static deployment. In the v2 backlog.

## Resolved

### Q1 — Deployment target, and Q2, the demo link

**Resolved 2026-10-25.** GitHub Pages, live at
<https://jaworskig00.github.io/neural-wind-tunnel/>, deployed by `.github/workflows/pages.yml` on
every push to `main`. Nothing but the frontend is deployed: there is no backend and no database,
because there never was one to build — the model and the mode atlas are static files fetched from
the app's own origin, the design state lives in the URL hash, and the assistant talks to the
visitor's chosen provider from their own browser.

Cloudflare Pages was ruled out on a measurement rather than a preference: it caps a single file at
25 MiB, and the ONNX Runtime WebAssembly binary is 27 MB. Keeping it would have meant moving that
file to R2 or dropping the opt-in ONNX path. GitHub Pages allows 100 MB per file, so the build
deploys unchanged.

The one thing given up is HTTP headers, which GitHub Pages cannot set. The Content Security Policy
travels in a meta element instead, and `frame-ancestors` had to be dropped from it — a browser
ignores that directive outside a header and logs an error on every load. Clickjacking protection
therefore waits for a host that can send headers.

### Q7 — Which inference backend should be the default

**Resolved 2026-10-24 (ADR-021).** Both ship. The hand-written TypeScript forward pass is the
default and ONNX Runtime Web is one query parameter away, because measurement reversed the
original plan: thirteen inputs through three small layers is tens of microseconds of arithmetic,
and the runtime costs 109 kB of WebAssembly to do the same work more slowly. A parity test holds
the two together so neither can drift.

### Q8 — How strict can the Content Security Policy be

**Resolved 2026-10-24 (ADR-023).** `connect-src` allows HTTPS generally plus loopback, rather than
an allowlist of provider origins. The assistant is bring-your-own-endpoint — a gateway on the
visitor's own machine is a supported case — so there is no list to write. Everything else in the
policy is as narrow as it can be: `default-src 'self'`, `object-src 'none'`, no frame ancestors,
no form action.
