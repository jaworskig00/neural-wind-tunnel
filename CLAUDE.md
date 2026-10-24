# CLAUDE.md

Follow [`AGENTS.md`](AGENTS.md) — it is the complete operating manual for this repository.

Execution order: [`docs/PLAN.md`](docs/PLAN.md), first unticked task. After every task: run the
checks, commit, push, tick the checkbox, append to [`docs/PROGRESS.md`](docs/PROGRESS.md).

Three rules worth repeating here:

- Commit messages carry no co-author trailers and no mention of the tooling.
- The flow field comes from the reduced-order model only. Never fake physics, not even as a
  placeholder.
- Running unattended, do not stop to ask. Pick the sensible default, record it as an ADR in
  [`docs/DECISIONS.md`](docs/DECISIONS.md) and in [`docs/QUESTIONS.md`](docs/QUESTIONS.md), and
  keep going.
