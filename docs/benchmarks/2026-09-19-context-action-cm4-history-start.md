# CM4 exact History start foundation — 2026-09-19

## Outcome

History queries can now carry one root-qualified full commit object as their traversal start. The
Rust boundary validates the root and object ID, verifies that the object is a commit, rejects a
simultaneous ref selection or cross-root path, and passes only the verified object ID to `git log`
before the explicit literal-path separator. This is the foundation for commit-detail folder/file
actions labelled “History up to this commit”; it does not infer a mutable branch tip.

The normalized frontend query identity and filter controller retain the exact start across paging
and reject stale responses in the existing History controller. Demo mode follows the same boundary.

## Focused verification

| Check | Result |
| --- | --- |
| Exact-start, path-limited Rust query and invalid combinations | 2 passed |
| Query normalization/filter-controller/demo checks | 11 passed |
| Full frontend/delivery suite | 439 passed |
| TypeScript | passed |

The change adds no repository cache, index, polling loop, filesystem write, or startup dependency.
