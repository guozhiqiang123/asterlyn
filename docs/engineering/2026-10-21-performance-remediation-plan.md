# Large-workspace performance remediation plan

- **Status:** Completed on 2026-10-21.
- **Baseline:** `b51a444`, with a clean working tree before this plan was added.
- **Scope:** Remove the highest-cost synchronous and repeated work found in the workspace search,
  Files navigator, installed-plugin activation, Git history, text editor, and task-output paths.
  Correctness, security boundaries, and bounded-resource contracts remain unchanged.

## Outcome

Asterlyn meets this plan when the following behavior is true:

1. A valid 100,000-file search index can be persisted below the configured cache-file budget
   without cloning the complete index, and a failed cache write cannot be retried unchanged after
   every search.
2. The Files navigator builds and flattens a 100,000-file tree once per semantic tree/disclosure
   change. A render or scroll-window update does not sort or flatten the same data twice.
3. A workspace-catalog evidence refresh preserves healthy installed-plugin sessions. Workspace,
   plugin installation/preference, selected package, digest, or runtime-health transitions still
   replace the affected session.
4. Commit-history append requests reuse a bounded geometric prefix window, so sequential pages do
   not launch one growing repository query per page. Identical in-flight total-count requests are
   coalesced.
5. Ordinary typing updates line-ending metadata incrementally and does not serialize the complete
   document on every animation frame.
6. Task stdout and stderr share one native output budget, delivery frames are coalesced, and the
   frontend does not copy the complete retained output array for each frame.

## Constraints

1. Git and the authorized workspace catalog remain the source of truth. Caches are scoped to the
   active owner/root/query identities and are discarded on typed invalidation or explicit refresh.
2. Search-cache failure remains recoverable and never changes search correctness. The cache stores
   signatures and file identity only, never source text.
3. Installed plugins continue to run only in isolated native processes. Evidence-update reuse is
   limited to the current workspace activation and the same selected package version and digest;
   workspace, preference, package, and recovery transitions retain the full restart path.
4. History ordering remains stable across refs and initialized submodules. Optimizations must not
   introduce duplicate or missing commits at page boundaries.
5. Mixed LF/CRLF files round-trip byte-for-byte after edits. Deferred serialization is flushed
   before save, tab migration, and any API that requests current content.
6. Output truncation stays explicit and sequence ordered. Coalescing may reduce event count but may
   not reorder stdout/stderr frames observed by the serial sink.

## Delivery sequence

### PR1 — Compact and bounded workspace-search persistence

1. Encode the fixed 4,096-bit Bloom signature in compact Base64 rather than a JSON array of 64
   decimal integers and bump the private cache schema.
2. Serialize a borrowed index instead of cloning the complete `BTreeMap`.
3. Reject an oversized temporary snapshot once, retain the useful resident index, and suppress
   unchanged retry attempts until the index changes again.
4. Add persistence tests at the 100,000-entry boundary and corruption/backward-schema tests.

**Acceptance:** the maximum valid synthetic index serializes below 128 MiB; cold/warm search
correctness is unchanged; failed persistence does not poison or repeatedly block later searches.

### PR2 — Stable project-tree indexes and render projection

1. Remove the redundant global entry sort before tree construction.
2. Store path-to-node and repository/workspace-path-to-file indexes with the cached tree/catalog.
3. Cache flattened visible rows by tree identity plus a disclosure revision. Pass the cached rows to
   render and scroll-window calculations instead of regenerating them.
4. Extend the large-tree test to the architectural 100,000-file boundary and assert bounded
   projection reuse in addition to the 200-node DOM cap.

**Acceptance:** one catalog refresh performs one tree build; one render performs at most one row
projection; scroll events within or across a virtual window do not traverse the full tree again.

### PR3 — Preserve unaffected installed-plugin sessions

1. Reconcile the enabled and activatable installation snapshot before replacing any active session.
2. Preserve an active session only when its plugin ID, selected version, and admitted package digest
   still match.
3. Stop sessions removed, disabled, upgraded, rolled back, or quarantined while retaining healthy
   matching sessions during catalog evidence refreshes.
4. Keep contribution registration atomic and deterministic in plugin-ID order.

**Acceptance:** a catalog evidence refresh starts and stops zero matching installed-plugin
processes; preference and selected-version changes still take effect through full reactivation.

### PR4 — History paging and repository-read reuse

1. Add a window/workspace/query-scoped history prefix cache with an initial 600-commit window,
   geometric growth, a 100,000-commit ceiling, and an eight-query resident bound.
2. Serve contained append pages by slicing the cached prefix and replace the prefix on an explicit
   first-page refresh.
3. Coalesce identical in-flight total-count requests while retaining latest-request completion
   semantics.
4. Add deep-page instrumentation that asserts backend load budgets and result continuity.

**Acceptance:** reading ten 150-row pages requires three geometric backend loads rather than ten
growing-prefix loads; first-page refresh invalidates the cached prefix; history results remain exact.

### PR5 — Incremental editor content and bounded task output

1. Update line-separator metadata from CodeMirror change ranges without scanning from byte zero or
   recomputing the dominant separator on every edit.
2. Notify the session controller with a dirty/version transition during animation frames; serialize
   complete content only when a consumer asks for it.
3. Give task stdout and stderr one shared atomic byte budget and coalesce native reads before Base64
   encoding and IPC delivery.
4. Replace append-by-array-copy frontend state with a bounded mutable frame buffer plus immutable
   snapshot only at terminal completion/reveal boundaries.

**Acceptance:** the 2 MiB editor benchmark stays below one 60 Hz frame at P95 on the reference host;
task transport never emits more than the shared 2 MiB budget and preserves typed truncation.

## Validation matrix

| Gate | Required result |
| --- | --- |
| Focused frontend tests | Search, project tree, plugin runtime, history, editor content, and task execution pass |
| TypeScript | `npm run check` passes |
| Production bundle | `npm run build` passes within the existing bundle budget |
| Rust formatting | `cargo fmt --all -- --check` passes |
| Rust tests | `cargo test --workspace` passes; OS watcher probes may remain explicitly ignored |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` passes |
| Performance evidence | Search-cache size, 100k-tree build/projection, deep history, 2 MiB edit, and task-output event counts are recorded |
| Patch hygiene | `git diff --check` passes and unrelated working-tree changes are untouched |

## Rollback and completion evidence

Each PR phase is independently revertible. Cache schema changes are private and recover by dropping
old snapshots. Projection and repository caches are optional optimizations whose removal cannot
change persisted user data. Workspace and preference transitions retain complete plugin
reactivation, while evidence reuse fails closed on a selected-version or package-digest mismatch.

Final measurements and remaining platform limits are recorded in
`docs/benchmarks/2026-10-21-performance-remediation.md`.
