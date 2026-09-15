# CM2 Changes context-menu acceptance

Date: 2026-09-15

Status: locally accepted; installed native cross-platform interaction remains a release gate

## Delivered behavior and architecture

Every Changes file row now contributes a feature-owned menu to the shared per-window host. The
ordered first-version actions are Include in Commit, Show Diff, Jump to Source, conditional Resolve
Conflict, Restore Changes, conditional untracked-file Move to Trash, Copy Path (File Name, Relative
Path, and Absolute Path), and Git History. Changelists, Shelf/Stash, Patch export, single-file Commit,
Local History, refresh, and generic Git submenus remain deliberately absent.

Opening the menu installs an exact context selection without toggling commit inclusion or loading a
new Diff. `ChangesCommitController` now records the path that owns the visible working Diff
separately from the highlighted row, so right-clicking a second change cannot relabel or replace the
first Diff. Explicit Show Diff remains the only menu action that loads the new target.

The transient target binds workspace root and generation, repository identity and accepted
revision, workspace/repository path, and a copy of every relevant `FileChange` field. Invocation
re-resolves that identity against the latest snapshot. Providers build availability synchronously
from accepted frontend state; menu construction performs no native filesystem or Git read.

Include in Commit uses the existing checked-commit exclusion state rather than staging manually.
Diff, source navigation, conflict resolution, recoverable restore, and History route through their
existing feature/application owners. Rename History includes both current and exact original paths.
The current Changes producer represents the primary repository as `.`; the target and query still
carry that repository identity explicitly so future repository-aware projections do not need a
menu-contract change.

Untracked deletion reuses the one window-scoped reviewed Trash controller introduced with R5.
Files and Changes therefore cannot retain competing mutation plans or confirmation dialogs. The
target is revalidated before planning and execution, success is published only after versioned
reconciliation, and failure never falls back to `git clean` or permanent deletion. Blocked planning
now returns a localized safety explanation rather than exposing its internal blocker code.

## Automated validation

| Check | Result | Conclusion |
| --- | ---: | --- |
| Frontend/application script suite | 414 passed | context policy/routing, selection separation, target lifetime, localization, bounded views, and regressions accepted |
| TypeScript check | passed | feature, application, and composition contracts are type-safe |
| Production frontend build | 353 modules transformed | passed with the pre-existing startup-chunk warning |
| Workspace crate tests | 40 passed | reviewed mutation containment, recovery, fingerprints, and Trash behavior remain accepted |
| Desktop adapter tests | 3 passed | platform reveal/Trash safety remains accepted |
| Desktop adapter Clippy | passed with warnings denied | no adapter lint debt introduced |
| Rust formatting check | passed | all Rust sources remain formatted |
| Patch whitespace check | passed | no patch-format errors |

Focused cases prove conditional conflict/Trash shapes, explainable unavailable actions, renamed-path
History, no Diff load on menu open, exact repository-revision invalidation, shared Trash delegation,
and preservation of the visible Diff while context selection moves to another row. Large Changes
trees retain the existing 200-row mount budget; English and Simplified Chinese catalogs retain the
same typed shape.

## Browser and accessibility evidence

The browser demo exercised the production Changes tree and shared host:

- left-click loaded `crates/asterlyn-git/src/repository.rs`, then right-clicking
  `docs/product/roadmap.md` selected the new context target while the repository Diff remained
  visible and unchanged;
- the menu exposed the intended compact action groups and a checked Include in Commit item;
- activating Include in Commit changed the existing inclusion state, updated ancestor mixed states,
  closed the menu, and returned focus to the exact `docs/product/roadmap.md` row;
- the untracked row exposed Move to Trash only conditionally, with demo-mode native operations and
  uncommitted History remaining focusable and accompanied by explicit reasons;
- Shift+F10 opened the same menu and Escape restored focus to the exact untracked row.

The host's existing arrow, type-ahead, submenu, edge-placement, forced-colors, and focus-trap tests
continue to pass. This milestone did not repeat installed desktop screen-reader or operating-system
Trash interaction.

## Output, latency, and memory evidence

An exact detached build of pre-CM2 commit `ee5b208` was compared with this milestone using the same
installed dependency tree.

| Output | Baseline | CM2 | Movement | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Startup JavaScript | 571,441 B raw / 132,944 B gzip | 580,107 B raw / 134,730 B gzip | +8,666 B raw / +1,786 B gzip | bounded feature cost; existing 500 kB warning remains |
| Main CSS | 122,986 B raw / 26,346 B gzip | 122,986 B raw / 26,346 B gzip | unchanged | no presentation growth |
| Shared context-menu host | lazy 9.65 kB chunk | unchanged lazy chunk | no architectural duplication | Changes reuses the window host |

Menu construction is synchronous over one captured change and a bounded item list. The full 414-test
suite completed in 3.44 seconds on this host; this is a regression signal rather than an interaction
latency benchmark.

No retained-heap series was run, so measured memory movement is **inconclusive**. Structurally the
feature adds no persistent menu DOM or per-row controller: one delegated binding resolves rows, one
provider is window-scoped, and every menu session is discarded on close or repository
reconciliation. The existing 200-row tree cap and one-plan Trash bound remain in force.

## Known limitations and release gates

- Changes currently projects the primary Git repository only. Nested repositories remain separate
  history roots and are not silently treated as primary Changes rows; future multi-root Changes must
  supply each row's explicit repository identity.
- Multi-Diff tabs, Patch export, supervised Stash, and Android Studio Changelist/Local History
  concepts are intentionally outside CM2.
- Full Tauri shell compilation on this host remains blocked by missing system development packages
  `libsoup-3.0`, `javascriptcoregtk-4.1`, and `webkit2gtk-4.1`. Product-neutral Rust crates and the
  desktop adapter compile and test locally.
- Installed Linux, macOS, and Windows verification of real file-manager/Trash behavior remains a
  release gate inherited from R5; no permanent-delete fallback exists.
