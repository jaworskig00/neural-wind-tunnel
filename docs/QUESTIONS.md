# Open questions

Anything that needs a human decision, or a default that was chosen while running unattended and
deserves a second look. An agent working autonomously appends here instead of stopping.

Format: one dated entry per item, with the default that was applied in the meantime.

## Needs a human decision

### Q1 — Deployment target

**Status.** open · **Blocks.** M10 only
Cloudflare Pages, GitHub Pages or Hetzner. Deliberately deferred. The app stays static-friendly
until this is answered: no server-side rendering, no required backend, every artifact fetched over
plain HTTP. Nothing else in the plan depends on it.

### Q2 — Live demo URL in the README

**Status.** open · **Blocks.** the demo link in M9
Follows directly from Q1. Until then the README says "not deployed yet" rather than carrying a
dead link.

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

_Nothing yet._
