# CM4 historical file inspection — 2026-09-19

## Outcome

H4 now has two feature-owned, stale-safe inspection controllers. A historical file opens as a
replaceable read-only editor preview with a full commit-change identity; it never becomes a normal
text tab and therefore cannot enter save, auto-save, formatting, or workspace-write flows. Text and
supported images reuse the existing lazy editor and bounded image surfaces.

Historical-to-current comparison reauthorizes a current file from the installed project catalog.
Disk comparisons return the exact workspace revision read. If an ordinary text tab has unsaved
content, the request instead carries that bounded content plus its disk baseline revision, and the
controller rejects completion unless the tab id, baseline, edit version, content, and save state are
still unchanged. The result pins the historical tree revision/blob/mode and identifies whether its
current side came from disk or an unsaved buffer.

Text patches are generated natively through `git diff --no-index` without a shell. External diff,
text conversion, color, paging, prompting, and optional Git locks are disabled; each text side is
limited to 2 MiB and retained output to 4 MiB. Image comparisons reuse the signature, animation,
dimension, aggregate-pixel, and data-URL checks already used by other image Diff surfaces.

## Verification

| Check | Result |
| --- | --- |
| Exact historical preview identity, stale completion and clear invalidation | passed |
| Disk/buffer comparison identity, buffer lease and stale target regressions | passed |
| Normalized native text patch and missing-newline behavior | passed; Git suite 87 passed |
| Workspace read/codec regressions | passed; workspace suite 41 passed |
| Protocol generation, malformed result rejection and native wiring | passed |
| Full frontend/delivery suite | 450 passed |
| TypeScript, Git/workspace Clippy and desktop check | passed |
| Production build | passed |
| Production startup JavaScript | 664,673 B raw / 150,487 B gzip |

The startup movement from the exact-read checkpoint is 11,966 B raw / 2,096 B gzip. CodeMirror and
the Diff editor remain dynamically loaded; no historical content cache, hidden editor DOM,
watcher, timer, database, or eager parsing runtime was added. Full Tauri compilation remains
unavailable on this host because its WebKit/GTK/libsoup development packages are absent; command
registration and protocol wiring are covered by source checks, while all product-neutral Git and
workspace logic is compiled and tested directly.

## Known limits

- This checkpoint builds and renders the read-only preview/comparison lifecycle. The commit-file
  context-menu provider that exposes it arrives with the complete H4 menu after reviewed restore is
  available, so no incomplete restore placeholder is shipped.
- Comparison supports a current file still present in the bounded authorized Files catalog. Missing,
  directory, link, unsupported binary, invalid UTF-8, and over-limit targets fail closed.
- Git Blame is deliberately unavailable inside historical-to-workspace comparison until both sides
  receive a separately reviewed blame identity policy.
