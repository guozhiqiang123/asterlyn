# CM4 commit-file context actions and reviewed restore — 2026-09-19

## Outcome

CM4 closes with the feature-owned H4 menu for Tree and Flat commit-detail file rows. The immutable
target retains the workspace generation, repository revision, exact repository and commit IDs,
first-parent identity, workspace path, and complete `CommitFileChange`. Opening a menu performs no
bridge, Git, filesystem, or network request and does not replace the currently selected Diff file.

The menu exposes Show Diff, Open This Version, Compare with Current File, Open Current File,
reviewed Restore This Version to Working Tree, File History up to This Commit, and one Copy Path
submenu for file name, workspace-relative path, and absolute path. Existing feature controllers own
the read/navigation actions. Known rename boundaries are included in the exact-start History intent;
the shared window host owns only presentation, keyboard navigation, focus, and disposal.

Restore is a dedicated working-tree transaction rather than a `git checkout` or `git restore`
shortcut. Git reauthorizes the selected commit row and rereads the immutable source immediately
before execution. The workspace core binds the target to an absent-or-exact revision, rejects
links/directories/hard-link risks and unsupported modes, durably publishes original and restored
blobs plus a manifest before mutation, and then performs an atomic create or overwrite. It changes
neither index nor refs. Applied records remain available for conservative Undo or explicit Keep,
and are rediscovered after process restart. A later external edit is preserved instead of being
overwritten by rollback.

The frontend separately leases every matching clean editor tab through tab identity, load epoch,
disk revision, edit version, and persisted content. Dirty, loading, or saving buffers block restore;
the lease is checked again immediately before native execution. Matching editors become read-only
during the write and are reloaded through the existing versioned workspace reconciliation path.

## Verification

| Check | Result |
| --- | --- |
| Complete frontend/delivery suite | passed; 457 tests |
| H4 provider policy/routing and restore-controller regressions | passed; six focused tests, including no-work-on-open, exact rename History, stale editor lease, durable Undo, and restart discovery |
| Exact historical source and text Diff regressions | passed; `asterlyn-git` 87 tests |
| Durable create/overwrite/no-op/rollback/finalize/conflict regressions | passed; `asterlyn-workspace` 48 tests |
| Platform adapter and terminal regressions | passed; `asterlyn-desktop` 3 and `asterlyn-terminal` 4 tests |
| Complete Tauri crate | passed; 53 tests, with two operating-system watcher tests explicitly ignored for the separate native-watcher gate |
| Full Rust workspace Clippy | passed with warnings denied for every crate and all targets |
| TypeScript/source ownership/protocol generation | passed via `npm run check` and the complete script suite |
| Production build | passed |
| Production startup JavaScript | 685,945 B raw / 153,928 B gzip |
| Debian package | passed; 8,602,226 B, installed size 24,391 KiB, SHA-256 `b896bb7c221b5ddb8170a5453f25dbe617fb63ab42e070a0fd48ec9f863baa53` |
| Isolated native startup | passed; release process remained alive for the complete 6,000 ms observation |

The startup movement from the H4 inspection checkpoint is 21,272 B raw / 3,441 B gzip. Historical
content, CodeMirror, and the Diff editor remain lazy; the new startup code is the provider, policy,
controller, dialog composition, localization, protocol validators, and bridge wiring. Native file
bytes and durable recovery blobs remain outside the browser. The main startup asset is still above
the architecture's 500 kB target, so later feature work should continue extracting composition and
dialog code rather than treating this size as an accepted new budget.

The native gate uses libsoup 3.4.3 and JavaScriptCoreGTK/WebKitGTK 2.46.3. The generated unsigned
package is `target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb`, declares `amd64`, depends on the
system `libwebkit2gtk-4.1-0` and `libgtk-3-0`, and contains the 24,773,800-byte release executable,
all six namespaced Linux icon sizes, and the JetBrains Mono OFL license. `ldd` reports no unresolved
dynamic library. This local package is verification evidence only; it was not installed, signed,
published, or pushed remotely.

## Browser interaction and accessibility

The deterministic browser workspace verified pointer right-click on both changed files. The second
file received its own context highlight while the first file remained the selected Diff target.
The menu exposed the seven reviewed commands and the three Copy Path children; activation removed
the menu and highlight and produced localized feedback. Open This Version displayed an explicitly
read-only historical document, Compare with Current File installed the historical/current Diff,
and Restore opened a modal review containing the exact target, source revision/path, action, byte
lengths, mode, and working-tree-only warning. A no-effect plan completed without publishing a false
recovery record.

`Shift+F10` opened the same menu. Escape and dialog cancellation returned focus to the exact file
row. The modal traps Tab, exposes a named `dialog`, blocks dismissal while executing, and keeps
blocked menu commands focusable with a reason. Fifty additional open/Escape cycles left zero
visible menus, zero context targets, and the same bounded file-row surface; no warning or error was
reported by the browser console. The shared host continues to mount at most one root menu and one
submenu, while a restore dialog retains only one preview/result and bounded recovery summaries.

## Known limits

- The Deepin 23.1 isolated startup remained healthy, but GTK/WebKit printed repeated
  `g_value_set_boxed` critical diagnostics during process initialization. They did not indicate a
  missing dynamic library or cause an early exit, but Linux diagnostic cleanliness remains a
  release follow-up instead of being reported as fully clean.
- The browser demo exercises no-effect historical restores; create/overwrite, conservative
  rollback, restart discovery, external-writer conflict, executable mode, deleted-before source,
  and stale-plan behavior are covered in isolated Git/workspace tests. Installed-platform manual
  verification remains required on Windows and macOS before release.
- Merge commits retain the product's current first-parent file semantics. Symlinks, submodules,
  hard-linked targets, unsupported binary previews, and files beyond accepted read/write budgets
  fail closed rather than being restored approximately.
- File History includes the rename boundary represented by the selected row but does not invent a
  complete multi-rename `--follow` history. Persistent historical tabs, single-file Patch export,
  path-level Cherry-pick/Revert, and merge-parent selection remain explicitly out of scope.
