# Files multi-selection, reviewed Trash, and editable ignored-file evidence

- **Date:** 2026-09-23
- **Status:** locally accepted; installed package interaction remains a manual platform check
- **Scope:** Files multi-selection and context actions, one reviewed multi-source Trash operation,
  faster Trash planning and visible completion, and editable Git-ignored files and folders

## Accepted behavior

- Files supports ordinary, modifier-toggle, and visible-range selection. Opening a context menu on an
  already selected row preserves the selected set; opening it elsewhere targets only that row.
- Multi-selection exposes only actions that have defined set semantics. Trash submits one reviewed
  operation for the complete normalized set. Duplicate entries and descendants of an already
  selected directory are removed again at the native boundary.
- Git ignore state is represented independently from document mutability. Ignored text files can be
  opened, edited, saved, renamed, and moved to Trash. Ignored folders remain valid mutation targets.
  History and Git Blame still reject entries that Git does not track.
- The native Trash adapter receives the source set once and uses one platform Trash context. Planning
  records the complete path graph and stable file identity metadata without reading each file's
  payload. Copy and Move retain exact content hashing because those operations reproduce bytes.
- Execution checks the reviewed source/inventory correspondence and every source again before the
  platform call. A partial platform result is reported as uncertain and retains recovery evidence;
  it is never reported as an unchanged failure.
- After the platform adapter reports completion, the review closes and Files removes the reviewed
  paths immediately. The controller invalidates catalog work that started before deletion, while
  Git status, the complete project catalog, and untracked state reconcile under the versioned
  window-session barrier in the background. A current-session failure is visible and schedules an
  authoritative refresh.

## Automated evidence

| Gate | Result |
| --- | --- |
| TypeScript check | passed |
| Complete frontend/delivery script suite | 612 passed, including visible Trash completion, editor-conflict recovery, stale catalog rejection, authoritative convergence, and retained-row selection |
| Production frontend build | passed; enforced source and bundle budgets passed |
| Rust formatting | passed |
| Full Rust workspace suite | 231 passed; 2 native-watcher tests intentionally ignored |
| Workspace mutation coverage | 61 passed, including source pruning, aggregate limits, stale identity rejection, partial Trash recovery, and a 600 MiB sparse-file plan |
| Native Git coverage | 105 passed, including editable ignored-file authorization and exact untracked-set Trash review |
| Desktop platform adapter coverage | 4 passed, including multi-folder Trash and no permanent-delete fallback |

The first workspace run inherited macOS's `/var` temporary-directory alias and exposed an existing
terminal test assumption: the session stores a canonical `/private/var` root while the test supplied
the alias for equality. Re-running the complete suite with the same temporary directory canonicalized
passed. No terminal production or test source was changed as part of this work.

## Performance and resource evidence

The 600 MiB sparse-file regression test verifies that Trash planning is no longer governed by the
copy/move payload limit and does not hash the file contents. The complete workspace test suite passed
with this case enabled. One multi-selection also creates one platform Trash context rather than one
context per selected entry.

No normalized wall-clock, resident-memory, or installed-package series was recorded, so no numeric
latency or memory improvement is claimed. The expected improvement follows from removing payload
reads from Trash planning, eliminating repeated platform-context creation, and removing Git status,
complete catalog, and untracked scans from the confirmation dialog's visible-completion critical
path. Recursive plan/revalidation and the operating-system Trash call remain synchronous safety
work.

## Known limits

- Operating-system Trash APIs can complete only part of a batch. Asterlyn preserves the journal and
  reports an uncertain result that requires reconciliation; it cannot make the external Trash API
  atomic.
- Workspace-wide replacement still excludes ignored files. This is a separate bulk-write policy;
  ordinary editor saves and Files mutations for ignored entries are enabled.
- Two native watcher tests require a real operating-system watcher backend and remain part of native
  acceptance. The browser demo cannot prove installed system-Trash behavior.

## Validation commands

- `npm run check`
- `npm run test:scripts`
- `npm run build`
- `cargo fmt --all --check`
- `TMPDIR="$(python3 -c 'import os; print(os.path.realpath(os.environ["TMPDIR"]))')" cargo test --workspace`
