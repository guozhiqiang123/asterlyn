# Editable Diff and conflict Git Blame plan

## Context

Asterlyn already supports Git Blame in ordinary editors and read-only side-by-side Diffs. The
editable working Diff and the three-pane conflict editor use separate lazy MergeView runtimes.
Their line-number gutters render source line identities, but they do not own a Blame controller or
exact revision source. This produces an inconsistent
interaction: a read-only commit Diff can show line authors while the editable form of the same
two-pane presentation and every conflict pane cannot.

The missing UI hook is small. The correctness problem is source identity. A working Diff has an
exact HEAD side and a saved-worktree side. Conflict Ours and Theirs are immutable index stage
blobs, not inherently commit ids. Result is a transient composition and must not be attributed to
one commit by assumption.

## Invariants

- Git Blame loads automatically when an eligible exact source is mounted. One source identity has
  at most one active request, and loading never moves the cursor, selection, active review block, or
  conflict decision.
- Immutable source panes are attributed only when their exact blob can be matched to an exact
  commit. Missing provenance fails closed with a visible reason.
- Result attribution is a projection, not invented history: a line may inherit an Ours/Theirs
  annotation only when unchanged line mapping proves that source identity. Ambiguous, synthesized,
  and manually edited lines are shown as Local changes.
- Editable working-Diff content follows the ordinary-editor contract. The current side is available
  only while its buffer matches the saved worktree; the HEAD side remains available independently.
- Unified Diff stays unavailable because one projected row does not have one stable source-file line
  identity. This change covers side-by-side two-pane and split three-pane presentations.
- Every native request remains path validated, output bounded, generation guarded, and tied to the
  currently mounted editor/source identity.

## Design

### 1. Share the pane Blame lifecycle

Extract loading, presentation installation, stale completion, copy update, and disposal behavior
into a reusable pane controller for the two new editable surfaces. Ordinary/read-only Diff remains
the behavior reference and keeps its mature owner; editable Diff and conflict Diff share the new
controller and the existing `gitBlamePresentation` and `GitBlameRuntime` boundaries. The
presentation extension follows the compact display preference defined by the compact Git Blame
presentation plan.

Each pane target has a stable identity, availability reason, and loader. A target change clears its
previous result and invalidates late completions. One controller may install the same logical Result
target into both internal Result views without issuing duplicate loads.

### 2. Add Git-owned conflict stage provenance

Extend `GitConflictContent` with optional Ours and Theirs commit ids. While reading an unresolved
path, Git core compares each stage blob id against a bounded candidate set derived from Git-owned
state: current HEAD, active operation targets/original head, merge/cherry-pick/revert/rebase marker
refs, and the retained stash commit and parents. A candidate is accepted only when `ls-tree` resolves
the exact conflict path to the exact stage blob.

There is no unbounded history walk and no best-effort branch-name guess. A stage without an exact
candidate remains readable as conflict text but exposes Blame as unavailable.

### 3. Complete editable two-pane Blame

Pass the already established working-Diff sources into `EditableDiffEditor`:

- Before uses the exact current HEAD object and original path where applicable.
- After uses the saved worktree path.
- After is disabled with the saved-file reason as soon as the shared text buffer becomes dirty;
  saving/remounting restores availability.

Mounting starts each eligible side automatically. Editing clears any active After annotations
immediately while leaving Before annotations intact.

### 4. Complete three-pane conflict Blame

Create Ours and Theirs targets from the exact commit ids supplied by `GitConflictContent`. Deleted
or provenance-free stages remain disabled. Result loads the available source results and builds a
line projection against the current Result document:

- one uniquely mapped source line inherits that source hunk;
- two mappings with identical commit metadata inherit the common hunk;
- conflicting mappings, insertions, manual text, and otherwise unmapped lines become Local changes.

The projection is compacted back into contiguous `GitBlameHunk` ranges. A Result edit invalidates
only Result annotations; invoking the action again recomputes against the current text. Ours and
Theirs annotations remain valid because their documents are immutable. Split/unified switching
clears mounted annotations, and unified mode returns the established side-by-side-only reason.

### 5. Lifecycle and compatibility

- Thread Blame runtime through the existing lazy merge editor adapters without making
  product/domain code depend on CodeMirror or Tauri.
- Preserve current output bounds, localized status/error messages, deterministic tinting, and hover
  details.
- Update generated protocol validation and demo/native fixtures for the optional provenance fields.

## Regression coverage

- Existing read-only two-pane Blame behavior remains unchanged.
- Editable split Diff automatically loads independent Before/After annotations; a dirty buffer
  disables and clears only After.
- Exact stage-blob candidate matching accepts Ours/Theirs commits and rejects a same-path commit
  whose blob differs.
- Conflict Ours and Theirs load independently and late results cannot cross files or panes.
- Result projection inherits unique/same-commit lines and marks inserted, ambiguous, or manually
  edited lines as Local changes.
- Conflict Apply/Ignore and direct Result edits invalidate only Result annotations.
- Unified two-pane and unified conflict presentations remain silently unannotated.
- Destroy/remount, tab close, file switch, and localization changes release or refresh every
  request generation, result, and presentation binding.

## Validation

1. Run focused context-menu, editor gutter, editable Diff, conflict editor, protocol, and Git
   repository tests.
2. Run `cargo fmt --check`, `cargo test -p asterlyn-git`, `npm run check`, the complete script suite,
   and `npm run build`.
3. Build the macOS release bundle and run the rendered native smoke test.
4. Replace the local Asterlyn application with the verified bundle and reopen the Flutter
   repository for manual acceptance.

## Implementation result

- Editable split Diff automatically loads independent Before/After Git Blame annotations. A dirty
  buffer immediately disables and clears only After annotations.
- Conflict Ours/Theirs provenance is resolved by exact stage-blob matching against a bounded set
  of Git-owned commits. Multiple matches fail closed rather than selecting a plausible commit.
- Conflict Result annotations conservatively inherit exact source lines; inserted, edited, and
  ambiguous lines are presented as Local changes. Editing invalidates only the Result annotation.
- Unified editable/conflict modes remain silently unannotated because their source identity is
  ambiguous.
- Verified with 921 frontend script tests, 133 `asterlyn-git` tests, TypeScript checking, production
  web build, release bundle build, and the rendered native smoke test. The signed application was
  installed at `/Applications/Asterlyn.app`; the previous bundle was retained in Trash as
  `Asterlyn-before-editable-diff-conflict-blame-20261009.app`.
