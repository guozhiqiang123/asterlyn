# R2f bounded workbench list evidence — 2026-09-12

## Scope

This independently revertible R2 slice moves project-tree and Changes-tree presentation into
feature-owned view modules and adds viewport-windowed mounting to Git History, project files, and
changed files. It preserves the existing scroll containers, selection identities, disclosure
state, paging semantics, keyboard focus, and commit inclusion model. This is interim evidence;
lazy editor loading, stylesheet ownership, and phase-closing acceptance remain.

## Ownership and bounds

`GitHistoryListView` now owns History row projection and its scroll window. The Files feature owns
project-toolbar and project-tree rendering in `project-files-view.ts`; the Changes feature owns
its toolbar, group/directory projection, and file-tree rendering in `changes-view.ts`.

Each long list mounts at most 200 semantic rows with overscan and top/bottom spacers. The window
start is quantized so ordinary wheel movement does not replace DOM on every event. Project and
Changes disclosure actions use controller-owned sets, so rerendering a window does not discard
expanded folders or commit inclusion. Collapse-all derives the complete disclosure catalog rather
than only the currently mounted rows.

`AsterlynApp` is 8,304 lines, 80 lines (0.95%) below R2e and 1,307 lines (13.60%) below the original
9,611-line audit baseline. Presentation concentration is **improved**, but the composition root and
global stylesheet remain above their decomposition triggers and are not accepted yet.

## Validation and interpretation

Five focused tests cover large-list mount budgets plus hierarchy, paging, and terminal-state
semantics. All 218 frontend script tests, TypeScript checking, and the production frontend build
pass.

The main JavaScript chunk is 768.53 kB raw and 215.92 kB gzip, compared with 761.51 kB raw and
213.79 kB gzip in R2e. The raw increase is 7.02 kB (0.92%) and gzip increase is 2.13 kB (1.00%):
raw size is **no material change**, while gzip sits on the reporting threshold. The architectural
below-500-kB gate still fails and requires editor/Diff code splitting.

No native resource run or package build is claimed by this interim slice. Bounded DOM work is
verified structurally; installed-app interaction latency remains **inconclusive** until R2 closing
acceptance.

## Next action

Lazy-load the CodeMirror editor and Diff runtimes, move capability styles out of the global sheet,
continue reducing feature implementation in `AsterlynApp`, then run the complete R2 acceptance and
package once at the phase boundary.
