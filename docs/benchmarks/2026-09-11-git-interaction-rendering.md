# Git interaction rendering correction evidence

## Scope and diagnosis

This correction addresses three coupled reports in the bottom Git tool: internal vertical splitters trailed the pointer, selecting a commit returned the history list to its top, and the changed-file column appeared late. Source tracing found that one commit selection rebuilt the branch tree, complete history toolbar/list/graph, and detail column before the query, then rebuilt all three again after the result. A commit-file Diff caused further full Git-tool renders. Splitter updates were already animation-frame-coalesced, but every applied frame reread `clientWidth` after the previous grid-width write and therefore forced synchronous layout.

The native commit-detail path was sampled against the local `superboost` checkout used for the report. `HEAD`, `HEAD~1`, `HEAD~5`, and `HEAD~20` first-parent changed-file queries completed in 4, 4, 3, and 4 milliseconds respectively, with a 4-millisecond median. This indicates that the reported visible delay was dominated by presentation work on this fixture rather than by the Git file-list command. It does not establish latency for unusually large commits or slow filesystems.

## Implemented boundary

- Commit selection changes the selected classes and accessibility state in place, preserving the history scroll container. Only the detail region renders its loading, success, or error projection.
- Commit-file selection changes file-row state in place and renders the editor; Diff completion cannot rebuild any Git column.
- A root/repository/object-qualified 48-entry least-recently-used cache serves repeated immutable commit details while the existing generation checks reject obsolete misses.
- Pointer splitters capture one validated range per gesture. Animation-frame updates no longer perform a layout-forcing size read, while keyboard changes and subsequent gestures still recompute current bounds.
- Git columns and fixed-height history rows isolate layout and paint. Webviews supporting `content-visibility` may skip offscreen row work without changing the 3,000-row session ceiling or DOM identity.

## Interaction and correctness evidence

The deterministic browser workbench was exercised at its default 1,280 × 720 viewport. The history list was scrolled to 83 pixels, its bottom commit was selected, and the scroll offset remained exactly 83 pixels both after selection and after the delayed detail result. The selected root-qualified key changed correctly and the third column contained the expected two files. A five-point, 82-pixel branch-divider gesture completed in 63 milliseconds, produced the final 270-pixel branch width, cleared drag state, and retained the 83-pixel history scroll offset. This automation confirms event completion and state stability; it is not a per-frame smoothness measurement or a substitute for macOS hardware acceptance. No browser warning or error was recorded.

All 153 frontend script tests pass, including three new bounded-cache tests. All 66 Rust workspace tests, Rust formatting, strict all-target Clippy, TypeScript checking, and the production frontend build pass. The release executable also remained alive for the complete 6,000-millisecond isolated native smoke interval. The main frontend output is 661.44 kB raw and 190.90 kB gzip; the pre-existing greater-than-500-kB warning remains. The Git correction adds no native command, watcher, index, worker, or recurring task.

## Package comparison and conclusion

The local Debian package is `Asterlyn_0.1.0_amd64.deb`, 6,576,336 bytes, with SHA-256 `bb16dff9425c040767a4ceb61031dc873908e820bcd3ebca9dc649019507b400`. Package metadata reports `asterlyn` 0.1.0 for `amd64`. It is 1,646 bytes, or 0.025%, above the previous task package of 6,574,690 bytes; package movement is **no material change**.

Interaction and correctness are **improved** because commit selection no longer replaces the history list and unrelated Git regions no longer participate in details or Diff refresh. The sampled native detail query is **no material change** because its implementation did not change and the 3–4 millisecond values do not justify backend restructuring. Memory is **inconclusive** because no normalized process series was run. Remaining limits are the bounded full history DOM, support-dependent offscreen rendering, session-only detail cache, uncached first inspection of each commit, and missing real-hardware macOS frame evidence. Manual validation should first repeat rapid selection and both Git dividers on the reported `superboost` checkout. If macOS still misses frames, the next action is a frame-timeline capture followed by viewport virtualization of history rows rather than another broad workbench rerender change.
