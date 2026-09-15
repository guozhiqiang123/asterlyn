# CM3 History single-commit context-menu acceptance — 2026-09-15

## Outcome

History now owns a stable single-commit context target and contributes its H1 menu to the shared
window host. The target binds the workspace and repository revisions, History generation,
repository identity, full object ID, ordered parent IDs, and subject. Recycled rows, filtering,
pagination, workspace changes, and repository reconciliation therefore cannot redirect an open
menu to another commit.

The visible menu contains only the accepted first version:

- Copy Commit ID copies the full object ID;
- Cherry-pick opens the existing exact-target Git-operation review;
- Revert Commit opens the reviewed single-commit Revert lifecycle;
- New Branch from This Commit opens the reviewed exact-object branch dialog.

Opening the menu performs no native Git read or write and does not open a file Diff. Right-clicking
selects the real commit so its details remain coherent with the context highlight. A nested-repository
commit remains copy-only. A merge commit keeps Cherry-pick and Revert visible but disabled with an
explicit mainline-parent explanation; the application never guesses `-m 1`.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Focused target, policy, provider, and branch-controller tests | 9 passed |
| Full frontend/delivery suite | 424 passed |
| TypeScript and production build | passed; 360 modules transformed |
| Pointer interaction | a merge row opened H1, selected the exact commit, and exposed the mainline block reason |
| Keyboard interaction | `Shift+F10` opened H1 for a non-merge row; Escape restored focus to that row |
| Side-effect boundary | selection/details changed, while the editor stayed on Welcome and no file Diff opened |
| Exact routing | copy, Cherry-pick, Revert, and branch-create tests received the captured full object ID |
| Localization | English and Simplified Chinese catalog shape and UI-literal gates passed |

The startup JavaScript is 603,450 B raw / 141,190 B gzip, compared with the Branches checkpoint's
598,660 B raw / 140,240 B gzip. The 4,790 B raw / 950 B gzip increase contains the feature-owned
single-commit target validation, policy, provider, localization, and composition adapter. The
shared menu host remains a single per-window instance, and the History feature adds no persistent
listener per row.

The CM3 native foundation remains covered by 79 passing `asterlyn-git` tests, warning-free Clippy,
and a passing product-neutral desktop-adapter check recorded in the foundation checkpoint.

## Known limits

- Merge-commit Cherry-pick and Revert require a future explicit mainline-parent review and remain
  unavailable in H1.
- Patch export, commit-to-commit range Diff, historical repository browsing, tags, reliable
  parent/child navigation, and provider-aware browser links remain intentionally outside CM3.
- The existing startup bundle remains above the 500 kB architecture target. Context-action code is
  small, but a later performance milestone should move the broader Git workbench behind a lazy
  boundary rather than splitting each provider independently.
- The Linux host still lacks the WebKit/GTK development packages required to compile the complete
  Tauri shell. Native product logic and the desktop protocol are covered as described by the CM3
  foundation checkpoint.
- Windows, macOS, and Linux native assistive-technology smoke checks remain release-bound; this
  checkpoint verifies semantic roles, keyboard entry, focus return, and forced-colors CSS gates.
