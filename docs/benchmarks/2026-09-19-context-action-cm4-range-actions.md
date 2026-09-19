# CM4 History range-action acceptance — 2026-09-19

## Outcome

History now switches between H1 and H2 from the feature-owned logical selection. Right-clicking
inside a multi-selection preserves its anchor, active endpoint, visible ordering, and detail pane;
right-clicking outside returns to a single H1 target. The H2 target freezes the workspace and
repository revisions, History generation and display scope, anchor/active identities, and every
full commit identity with ordered parents.

The accepted H2 surface currently contains:

- Copy Commit IDs in visible top-to-bottom order;
- Cherry-pick Selected Commits, routed oldest to newest;
- Revert Selected Commits, routed newest to oldest;
- Squash Selected Commits, mapped to the retained parent base only for an exact suffix ending at
  the current `HEAD`.

Topology policy rejects cross-root selections, nested-root writes, display-adjacent gaps, merge
commits, unverifiable current-branch reachability, root ranges without a retained base, and stale
selection snapshots. Busy, dirty, detached, and unborn repository states remain separate blockers.
For multi-Revert, Git repeats the direct first-parent, no-gap, current-branch check while preparing
the reviewed plan; frontend adjacency is not the final authorization boundary.

The two-commit Compare item remains intentionally absent until its exact-tree range Diff service is
accepted. This follows the system rule that providers expose only backed application actions.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Focused H1/H2 target, selection, policy, provider, and binding tests | 15 passed |
| Full frontend/delivery suite | 432 passed |
| Git core suite | 82 passed |
| TypeScript and production build | passed |
| Production startup JavaScript | 612,510 B raw / 143,430 B gzip |
| Pointer interaction | a three-commit range remained selected when its middle row opened H2 |
| Keyboard interaction | `Shift+F10` opened the same H2 model without collapsing the range |
| Detail ownership | the details pane remained on the active endpoint rather than the context row |
| Focus return | Escape restored focus to the exact row that invoked H2 |
| Semantic blocker | dirty state blocked writes, while non-HEAD Squash reported its stronger suffix reason |
| Localization | English and Simplified Chinese catalog shape and UI-literal gates passed |

The startup increase over the selection checkpoint is 5,460 B raw / 1,280 B gzip. It contains the
immutable range target, topology policy, provider, localization, and composition adapter; it adds
no row-scoped listeners or native reads during menu construction.

## Known limits

- Compare Two Commits is deferred to the exact-tree range Diff checkpoint.
- Backend first-parent reachability for multi-Revert and bounded Squash is intentionally limited to
  1,000 commits; H2 itself selects at most 100.
- Merge ranges remain unavailable until explicit mainline-parent semantics exist.
- The existing startup bundle remains above the 500 kB architecture target.
