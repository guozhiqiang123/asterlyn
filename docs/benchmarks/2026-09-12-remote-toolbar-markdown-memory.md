# Remote toolbar and Markdown-mode evidence — 2026-09-12

## Scope and comparison

This focused correction compares the previously accepted local build with the implementation in this change. It reduces the remote control to one compact selector, places last-fetched incoming and outgoing counts on Fetch and Push, expands Push into an Android Studio-inspired review surface, and adds explicit exact-lease force and tag scopes without changing Update semantics. It does not advance the Stage 3 sequence or claim installed Windows/macOS acceptance.

## Functional evidence

- Remote-policy fixtures verify that the selected remote scopes Fetch, Update, and Push; Fetch describes its remote-wide canonical tracking-ref scope; Update remains bound to its configured upstream; a tracked branch may explicitly review the same-named destination on another supported Push remote without replacing its upstream; and diverged or behind branches remain reviewable while ordinary Push is disabled.
- Git integration fixtures verify exact pageable outgoing commits, aggregate pushed-file discovery, pushed-file commit lookup, first-publication previews, preview identity bound to the selected remote, unambiguous length-delimited identities, stale-`HEAD` rejection, alternate-remote publication with upstream preservation, and a successful confirmed ordinary push. A deterministic final-window race moves the local branch after target revalidation but before Git starts; the remote receives only the confirmed object ID while the local branch keeps the concurrent commit. A separate peer advance proves that pinning an object ID retains the remote's ordinary non-fast-forward rejection.
- Force is available only as an explicit exact `--force-with-lease=<destination>:<last-fetched-oid>` choice. Tests prove that divergent history blocks ordinary Push, an unchanged exact lease permits the requested force, and a peer move rejects the stale lease.
- Tag tests distinguish `All` from `Current Branch`, bind each selected tag object ID into the confirmation token, and verify atomic branch-plus-tag publication. If the branch is rejected, no selected tag is published; after a fresh review, only the requested tag scope is sent.
- Existing mirror rejection, cancellation, upstream, cleanliness, serialization, remote selection, and bounded-output tests remain in force.

## Browser interaction and accessibility

A production-like browser journey verified that the header exposes only the selected remote, with the last-fetched behind count on Fetch and ahead count on Push. Accessible names explain that the counts come from tracking refs and describe the exact scope and side effects. The generic workspace Refresh remains local and does not silently access the network.

The Push review showed distinct Local branch and Remote branch endpoint cards connected by an explicit Push direction, exposed origin and backup targets, switched the selected target to backup, and retained the current branch's same-name destination. Its default right pane contained two aggregate files. Selecting the first outgoing commit produced a blue surface with a contrasting border and inset marker, narrowed the pane to that commit's files, and activating the same commit again restored both aggregate files. The shared modal title row measured 38 CSS pixels and the revised route measured 62 CSS pixels. Enabling Push tags left the action button at 52 by 31 CSS pixels with the same blue background, white foreground, and full opacity before and after the asynchronous token refresh; the pure state check additionally verifies that the refresh is `aria-disabled` but not natively disabled. One click on `repository.rs` opened a nested two-pane CodeMirror Diff with the shared Split and Whitespace preferences, file/change navigation, source reveal, and unchanged-context control. No remote mutation was triggered during browser acceptance, and the warning and error console remained empty.

## Conflict workflow boundary

Fast-forward only is the sole executable Update strategy. Merge and Rebase appear disabled with the missing editable-conflict lifecycle explained. Remote-operation reconciliation already refreshes canonical status and, when unresolved paths exist, activates Changes, includes/selects the first conflict, and opens it in the current read-only Diff. This is an intentionally incomplete destination: resolution editing, ours/base/theirs presentation, Continue/Abort, restart recovery, and fault tests are required before Merge or Rebase can be enabled.

## Performance and resource interpretation

Push preview is lazy and user-triggered. The backend reports an exact total, returns at most 200 commits per page, and displays at most the first 1,000 outgoing commits. Aggregate file discovery is capped at 20,000 paths and 8 MiB of output, while tag enumeration is capped at 1,000 refs; exceeding a safety bound fails closed instead of silently approving a partial push. File-to-commit lookup is also on demand. Header counts reuse local last-fetched tracking refs, so no watcher, recurring Git query, credential store, or hidden network operation is introduced.

No matched native process-tree resource series was run for this interaction correction, so memory impact is **inconclusive**.

## Validation

The final validation passed all 183 script tests, 48 `asterlyn-git` tests, 25
`asterlyn-workspace` tests, 17 Tauri library tests, and the Tauri binary test.
TypeScript checking, Rust formatting, strict workspace Clippy, whitespace checks,
the production frontend build, Debian packaging, and a six-second native liveness
smoke also passed. The first all-workspace test invocation omitted the documented
user-local Tauri environment and failed while locating `javascriptcoregtk-4.1` and
`libsoup-3.0`; rerunning through `scripts/with-linux-tauri-env.sh` used the existing
isolated sysroot and passed without weakening a check. The earlier slice's Sol review
remains historical evidence; this follow-up used no delegated model or reviewer, as
explicitly requested by the user.

The production frontend emits 101.12 kB of CSS (23.11 kB gzip), a 733.90 kB main
JavaScript chunk (207.43 kB gzip), and the unchanged separately loaded 97.28 kB
Markdown-it chunk (40.86 kB gzip). Compared with the immediately preceding activity-
navigation acceptance package, CSS increased by 0.95 kB raw (0.9484%) and 0.26 kB
gzip (1.1379%); main JavaScript increased by 1.12 kB raw (0.1528%) and 0.36 kB gzip
(0.1739%). Raw CSS and both JavaScript measures are **no material change** under the
one-percent threshold, while compressed CSS is **regressed** slightly above it. The
explicit route hierarchy and selected-state styling account for the CSS movement.
Vite retains the existing main-chunk warning; code splitting remains a separate
optimization.

The final Linux binary is 19,573,120 bytes and the Debian package is 6,829,110
bytes. Against the immediately preceding package, these are increases of 1,088 bytes
(0.0056%) and 1,126 bytes (0.0165%),
respectively, both **no material change** under the one-percent artifact-size
threshold. The local package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb` with SHA-256
`14a1a5becc423cb79a0d5b72904ea04b06655317a96ce8fe6dfdab5b57fb4cd4`.

Remote review coverage, mutation safety, and accessibility are **improved**.
Frontend size is **mixed** because only compressed CSS exceeds the threshold,
native/package size has **no material change**, and memory remains **inconclusive**
because no matched resource series was run. This task produces one local acceptance
package and no remote publication.

## Limitations and next action

Remote state shown before an operation is last-fetched state. The workspace Refresh is intentionally local; Fetch is the explicit network boundary that updates the behind badge. Update currently supports only fast-forward and therefore does not intentionally create conflicts. Push preview shows an exact total but only the first 1,000 rows for exceptionally large outgoing histories; confirmation still pushes the complete current-branch ref range. In aggregate scope, the file Diff opens the latest outgoing commit that touched the file rather than synthesizing one range-wide patch; selecting a commit uses that exact commit. Alternate-remote Push intentionally uses the same branch name and does not yet expose an editable destination branch name. Exact-lease force requires a fetched comparison object, and atomic branch-plus-tag Push fails closed when a server cannot provide atomic receive. Cancellation cannot roll back local refs already moved by Fetch/Update, and a cancelled Push remains remotely indeterminate until a later Fetch. Editable conflict resolution, Merge/Rebase Update, unrestricted force, automatic retries, progress reporting, and installed Windows/macOS interaction remain deferred.

The next action is manual acceptance of the local Debian package, with particular attention to the Local-to-Remote route hierarchy, 38 px modal title row, outgoing-commit selection and repeated-click reset, file actions, tag-scope stability, and the explicit ordinary/exact-lease choice. Editable conflict Diff should be delivered as one recovery-aware slice before Merge or Rebase is enabled.
