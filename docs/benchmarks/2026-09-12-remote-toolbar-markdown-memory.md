# Remote toolbar and Markdown-mode evidence — 2026-09-12

## Scope and comparison

This focused correction compares the previously accepted local build with the implementation in this change. It replaces the remote Sync popover with separately described top-bar actions, introduces confirmation-first Update and Push flows, establishes the conflict-file destination for a future editable Diff, and remembers Markdown presentation choices. It does not advance the Stage 3 sequence or claim installed Windows/macOS acceptance.

## Functional evidence

- Remote-policy fixtures verify that the selected remote scopes Fetch, Update, and Push; Fetch describes its remote-wide canonical tracking-ref scope; Update uses fast-forward wording; and a tracked branch cannot be redirected to another remote for Push.
- Git integration fixtures verify exact pageable outgoing commits, first-publication previews, preview identity bound to the selected remote, unambiguous length-delimited identities, stale-`HEAD` rejection, tracked-branch destination rejection, and a successful confirmed ordinary push. A deterministic final-window race moves the local branch after target revalidation but before Git starts; the remote receives only the confirmed object ID while the local branch keeps the concurrent commit. A separate peer advance proves that pinning an object ID retains the remote's ordinary non-fast-forward rejection. Existing no-force, no-tags, mirror rejection, cancellation, upstream, cleanliness, and serialization tests remain in force.
- Markdown preference fixtures cover per-document restoration, last-used fallback for a newly opened Markdown file, the 128-entry bound, most-recent replacement, malformed storage, storage failure, and unknown modes. Editor-session fixtures prove that a restored mode becomes the live tab mode without changing source content.

## Browser interaction and accessibility

A production-like browser journey verified the compact remote selector plus Fetch, Update, and Push controls. Their accessible names state the selected-remote scope and the exact side effects or exclusions instead of repeating the visible labels. The Push review showed the exact local-to-remote ref route, tracked/publication status, confirmed `HEAD`, outgoing commits, selected-commit files, and the explicit no-force/no-tags/no-retry policy. `Escape` closed the review and restored focus to Push. The warning and error console remained empty.

The same journey changed one Markdown file to Preview, switched away and back, and observed Preview restored. A previously unseen Markdown file inherited Preview, was changed to Split, and then retained Split independently. The store contains only root-qualified identities and presentation modes, never source content or drafts.

## Conflict workflow boundary

Fast-forward only is the sole executable Update strategy. Merge and Rebase appear disabled with the missing editable-conflict lifecycle explained. Remote-operation reconciliation already refreshes canonical status and, when unresolved paths exist, activates Changes, includes/selects the first conflict, and opens it in the current read-only Diff. This is an intentionally incomplete destination: resolution editing, ours/base/theirs presentation, Continue/Abort, restart recovery, and fault tests are required before Merge or Rebase can be enabled.

## Performance and resource interpretation

Push preview is lazy and user-triggered. The backend reports an exact total, returns at most 200 commits per page, and displays at most the first 1,000 outgoing commits. If the total is larger, the dialog states both the display limit and that confirmation pushes the complete exact ref range. Commit-file details reuse the existing bounded lazy inspection path. Markdown persistence is capped at 128 small records and performs no background work. No watcher, index, recurring Git query, credential store, or remote URL state is introduced.

No matched native process-tree resource series was run for this interaction correction, so memory impact is **inconclusive**.

## Validation

The final validation passed all 173 script tests, 46 `asterlyn-git` tests, 25
`asterlyn-workspace` tests, 17 Tauri library tests, and the Tauri binary test.
TypeScript checking, Rust formatting, strict workspace Clippy, whitespace checks,
the production frontend build, Debian packaging, and a six-second native liveness
smoke also passed. A read-only Sol review identified the final mutable-source-ref
race; after the push source was pinned to the confirmed object ID and both race and
non-fast-forward fixtures passed, its final verdict was approve with no blocking
findings.

The production frontend emits 94.66 kB of CSS (21.98 kB gzip), a 706.75 kB main
JavaScript chunk (201.47 kB gzip), and the unchanged separately loaded 97.28 kB
Markdown-it chunk (40.86 kB gzip). Compared with the preceding accepted package,
CSS increased by 3.00 kB raw (3.2730%) and 0.41 kB gzip (1.9008%); main JavaScript
increased by 19.80 kB raw (2.8823%) and 4.46 kB gzip (2.2638%). Frontend size is
therefore **regressed** under the one-percent threshold, primarily from the two
confirmation surfaces and their state flow. Vite retains the existing main-chunk
warning; code splitting remains a separate optimization.

The final Linux binary is 19,436,832 bytes and the Debian package is 6,784,830
bytes. These are increases of 105,696 bytes (0.5468%) and 37,388 bytes (0.5541%)
respectively, both **no material change** under the one-percent artifact-size
threshold. The local package is
`target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb` with SHA-256
`03d9ddce5076e575a6aba0def1ee1fdd33ddde648b179cb1e72ba60fcea78a96`.

Remote interaction safety, accessibility, and Markdown continuity are
**improved**. Frontend size is **regressed**, native/package size has **no material
change**, and memory remains **inconclusive** because no matched resource series was
run. This task produces one local acceptance package and no remote publication.

## Limitations and next action

Remote state shown before an operation is last-fetched state. Update currently supports only fast-forward and therefore does not intentionally create conflicts. Push preview shows an exact total but only the first 1,000 rows for exceptionally large outgoing histories; confirmation still pushes the complete current-branch ref range. Cancellation cannot roll back local refs already moved by Fetch/Update, and a cancelled Push remains remotely indeterminate until a later Fetch. Diff conflict resolution, Merge/Rebase Update, tags, force/lease push, automatic retries, progress reporting, and installed Windows/macOS interaction remain deferred.

The next action is manual acceptance of the local Debian package, with particular attention to top-bar discoverability, accessible descriptions, Push review density, and Markdown mode memory. Editable conflict Diff should be delivered as one recovery-aware slice before Merge or Rebase is enabled.
