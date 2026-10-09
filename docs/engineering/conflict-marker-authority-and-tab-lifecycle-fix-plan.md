# Conflict marker authority and tab lifecycle fix plan

## Context

The conflict editor currently has two related safety gaps:

1. Closing a conflict-resolution preview tab can remove the visible editor without clearing the
   `GitOperationController` conflict session. A later attempt to open another conflicted file then
   sees the orphaned draft and displays the "finish, save, or cancel" notice even though the
   original tab no longer exists.
2. Conflict discovery is inferred only by diffing Base against Ours and Theirs. When both sides add
   long, mostly identical code at the same logical location, repeated structural lines can anchor
   the two insertions to adjacent Base positions. The model then projects two one-sided additions,
   reports zero conflicts, omits the per-conflict controls, and incorrectly enables Save and Stage.

The Flutter `gradle_errors_test.dart` conflict is the acceptance case for the second gap: Git has
all three index stages and two complete worktree conflict-marker groups, while the current review
projection reports no conflicts.

## Invariants

- Git remains the source of truth. A complete worktree conflict-marker group is authoritative
  evidence that the corresponding text still requires an explicit resolution decision.
- The visible conflict tab and the controller conflict session have one lifecycle. Closing the tab
  is the same operation as cancelling that conflict review; neither may survive without the other.
- Closing a conflict review with edited Result content or explicit Apply/Ignore decisions reuses the
  existing discard confirmation. An untouched review closes immediately.
- Save and Stage is enabled only when every authoritative marker-backed conflict is represented by
  the review model and every represented conflict has been explicitly completed.
- Automatically merged, non-conflicting content remains in Result and does not require redundant
  review actions.
- Binary conflicts and marker-free user-authored worktree resolutions retain their existing paths.

## Design

### 1. Make conflict-tab close a first-class conflict action

- Route conflict preview closure through `ConflictEditorRuntime`, rather than through the generic
  Git-operation dialog close path.
- Identify the preview being closed from the editor session, not only from the currently active
  document, so an inactive conflict tab cannot bypass cleanup.
- Treat explicit review decisions as unsaved review state even if they happen to leave Result text
  byte-identical to its initial value.
- After an accepted close, clear the controller conflict/result and close the preview as one
  operation. A rejected discard confirmation leaves both intact.

### 2. Promote Git conflict markers into authoritative review blocks

- Parse complete normal and diff3-style Git marker groups from the worktree document while keeping
  the surrounding auto-merged text.
- Map each marker's Ours and Theirs payload back to the immutable side documents in order.
- Build one explicit two-sided conflict block per marker group. Do not allow Base-anchor ambiguity
  in the general line diff to collapse or split these blocks.
- Preserve the existing inferred Base/Ours/Theirs model for non-conflicting changes and for
  marker-free inputs, excluding inferred blocks already owned by an authoritative marker group.
- Construct the initial editable Result from the marker-aware merge projection so shared inserted
  context appears once and only the actual marker payload remains unresolved.

### 3. Add an independent save-safety gate

- Compare the count of complete worktree marker groups with the number of marker-backed conflicts
  represented by the review snapshot.
- Keep Save and Stage disabled when marker parsing or projection reports an incomplete mismatch,
  even if the generic review summary says `pendingConflicts === 0`.
- Apply the same predicate in both toolbar rendering and the save action handler so programmatic or
  stale-DOM activation cannot bypass the gate.

## Regression coverage

- Closing an untouched active conflict tab clears the controller session.
- Closing an inactive conflict preview also clears the controller session.
- Closing after Apply/Ignore-only review asks for discard confirmation; rejecting keeps the tab and
  session, accepting removes both.
- A long add/add insertion with repeated closing syntax and two Git marker groups produces exactly
  two pending, two-sided conflict blocks.
- The add/add acceptance case starts with Save and Stage disabled and enables it only after both
  sides of both conflicts are explicitly reviewed.
- A marker/model count mismatch remains unsaveable.
- Ordinary inferred conflicts and marker-free worktree resolutions retain their current behavior.

## Validation

1. Run the focused conflict merge/model, conflict editor runtime, and editor tab/view tests.
2. Run the complete script suite.
3. Run TypeScript checking and the production web build.
4. Build the macOS release bundle and run the rendered native smoke test.
5. Replace the local Asterlyn application with the verified bundle and reopen the Flutter
   repository for manual acceptance.

