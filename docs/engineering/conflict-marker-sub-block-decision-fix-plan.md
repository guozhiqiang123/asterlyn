# Conflict marker sub-block decision isolation fix plan

## Context

Git may emit one conflict-marker group around several nearby but independent changes. The split
editor compares each immutable side with the editable Result and therefore renders one Apply/Ignore
control group per actual diff chunk. The resolution model currently creates one decision block per
Git marker group. When a marker contains two diff chunks, both visible control groups address that
same model block, so reviewing either chunk also completes the other.

The Flutter `android_java17_dependency_smoke_tests.dart` conflict is the acceptance case: Git has
one complete marker group, while Base/Ours/Theirs analysis identifies two non-overlapping,
two-sided change clusters inside it.

## Invariants

- Complete Git conflict markers remain authoritative evidence that explicit review is required.
- A visible Apply/Ignore control changes only the diff chunk represented by that control.
- One marker group may contain multiple independently reviewable decision blocks, but it counts as
  one authoritative marker group for the Save and Stage safety check.
- Ambiguous repeated insertions that cannot be split reliably retain the existing one-block-per-
  marker fallback.
- Automatically merged changes outside marker groups keep their existing behavior.

## Design

1. Associate every inferred Base change cluster with the marker groups whose side payloads it
   overlaps.
2. Split a marker group into inferred clusters only when every contributing cluster is two-sided
   and belongs exclusively to that marker group. Otherwise retain the exact marker projection as
   the fallback decision block.
3. Carry a stable marker-group identifier on each marker-backed decision block.
4. Count unique marker-group identifiers, rather than marker-backed blocks, in the independent
   Save and Stage safety gate.

## Regression coverage

- One marker group containing two separated, two-sided edits produces two decision blocks.
- Applying or ignoring the first block leaves the second block pending.
- The two blocks still report one authoritative marker group.
- Repeated add/add insertions spanning multiple marker groups continue to use exact marker-backed
  fallback blocks.

## Validation

- Focused conflict model/review/runtime coverage passed: 28 tests.
- The complete script suite passed: 934 tests.
- TypeScript checking, the production web build, and the Tauri release bundle passed.
- Git core coverage passed: 133 tests.
- The rendered native smoke test passed.
- The live Flutter acceptance file projects its one Git marker group into two independent conflict
  decision blocks; completing the first block leaves the second pending, while the safety summary
  still reports one authoritative marker group.
