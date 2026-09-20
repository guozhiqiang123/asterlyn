# Context-menu consolidation and Unversioned group acceptance

- **Date:** 2026-09-20
- **Status:** locally accepted; real native system-Trash and macOS visual confirmation remain manual package checks
- **Scope:** bounded branch launcher, metadata-only branch inspector, Remote form correction, and exact-set Unversioned group actions

## Accepted behavior

- The top-bar branch launcher uses the shared context-menu host, separates Local and Remote refs with non-action headings, truncates long labels, keeps full accessible/title text, and scrolls within the viewport. The top-bar trigger sizes to its current label up to the existing bounded maximum.
- The Git third-column branch inspector now presents branch metadata only. Merge, Rebase, Checkout, and Create Branch remain available through the feature-owned Branches/context-menu workflow instead of a second inspector lifecycle.
- The Remote definition form keeps **Fetch remote** because it has real, narrow behavior: a successful Add/Edit optionally performs one immediate Fetch. The checkbox and label remain together inside the dialog. This choice does not alter a later Update Current Project strategy.
- A complete, non-empty Unversioned group owns one exact-set context target. Stage All performs one bounded exact-path Git add and one reconciliation. Move All to Trash requires a destructive confirmation, blocks dirty/open-save targets, and asks the Git core to revalidate the full unique path set as currently untracked before the first platform Trash write.
- The bulk Trash path never calls `git clean` and never admits tracked paths. Clean editor tabs for the reviewed paths close through one editor lease. Success installs one typed working-tree outcome, reloads the project catalog once, and starts one untracked scan.

## Automated evidence

| Gate | Result |
| --- | --- |
| TypeScript check | passed |
| Complete script suite | 551 passed |
| Production frontend build | passed; 440 modules transformed |
| `asterlyn-git` tests | 105 passed |
| Tauri/native command compile check | passed |
| Rust formatting | passed |
| Protocol generation/validation | passed inside the complete script suite |
| Frontend ownership limits | passed: `app.ts` 8,781; demo bridge 2,375; localization catalog 1,206 lines |

The focused Rust test proves that duplicate paths are rejected, tracked paths are rejected, a path that disappears before execution rejects the whole reviewed set, and the exact current untracked set resolves only inside the repository root. Frontend tests cover group target staleness, menu routing, editor bulk leases, dirty-buffer blocking, shared-menu heading navigation, and the feature-owned mutation runtime.

## Browser interaction evidence

The deterministic local workspace verified:

- the current-branch menu exposes `Manage Remotes…`, then Local and Remote groups;
- headings are presentation-only, keyboard focus begins on a real action, menu overflow is vertical and bounded, and the trigger uses content-sized flex behavior;
- selecting a non-current local branch leaves only State, Upstream, Tracking, and Updated metadata in the third column;
- right-clicking Unversioned Files exposes Stage All and the destructive Trash action (Trash is truthfully unavailable in browser demo mode);
- editing a Remote renders the checked **Fetch remote** control and text on one contained row with no overflow.

## Output and limitations

No dependency, polling loop, background producer, startup request, or parallel repository database was added. The shared context-menu host grew only presentation behavior; the feature chunk and main bundle remain within existing architecture gates. Dedicated latency and heap measurements are **inconclusive** for this correction.

System Trash is recoverable but is not transactionally atomic across many operating-system calls. All paths are validated before the first move; if the platform fails midway, earlier files may already be in Trash. The application then performs authoritative reconciliation and reports failure instead of claiming rollback. A packaged macOS run should still verify the long-name popup, native Trash partial-failure messaging, and the Remote form under the platform WebView.
