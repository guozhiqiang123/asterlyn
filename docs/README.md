# Documentation map

The documents in this directory are the current source of truth. A decision that changes architecture, product behavior, compatibility, quality gates, or milestone scope must update the relevant page in the same change.

## Product

- [`product/vision.md`](product/vision.md) — product identity, users, principles, and non-goals.
- [`product/roadmap.md`](product/roadmap.md) — audited 3–5 year, seven-stage roadmap.

## Architecture

- [`architecture/overview.md`](architecture/overview.md) — boundaries, dependency direction, runtime model, and evolution seams.
- [`architecture/decisions/0001-foundation.md`](architecture/decisions/0001-foundation.md) — first architecture decision record.
- [`architecture/decisions/0002-tracked-first-refresh.md`](architecture/decisions/0002-tracked-first-refresh.md) — cancellable two-phase repository refresh contract.
- [`architecture/decisions/0003-persistent-workbench.md`](architecture/decisions/0003-persistent-workbench.md) — persistent editor, orthogonal tool windows, and resizable layout state.
- [`architecture/decisions/0004-safe-text-editing.md`](architecture/decisions/0004-safe-text-editing.md) — authorized text-file access, optimistic save, and editor-session ownership.

## Delivery

- [`milestones/m1-git-gui-first.md`](milestones/m1-git-gui-first.md) — first vertical slice and acceptance gates.
- [`engineering/quality-gates.md`](engineering/quality-gates.md) — durable quality, performance, compatibility, and release rules.
- [`engineering/local-build.md`](engineering/local-build.md) — reproducible frontend, Rust, native Linux, and packaging setup.
- [`engineering/ci.md`](engineering/ci.md) — least-privilege cross-platform preview builds and artifact trust boundary.
- [`governance/lifecycle.md`](governance/lifecycle.md) — how a multi-year codebase changes without fossilizing early choices.

## Design and references

- [`design/rebased-reference.md`](design/rebased-reference.md) — what may be learned from Rebased and what must remain original.
- [`design/daily-driver-interactions.md`](design/daily-driver-interactions.md) — usability audit and ordered interaction/feature slices.
- [`design/editor-core-interactions.md`](design/editor-core-interactions.md) — Stage 3 editor slices, invariants, and acceptance evidence.

## Benchmarks

- [`benchmarks/2026-09-08-m1-baseline.md`](benchmarks/2026-09-08-m1-baseline.md) — first functional, build, latency, memory, CPU, and artifact-size evidence.
- [`benchmarks/2026-09-08-m1-1-tracked-first.md`](benchmarks/2026-09-08-m1-1-tracked-first.md) — tracked-first latency, cancellation behavior, repeated memory, native workflow, and M1.1 decision.
