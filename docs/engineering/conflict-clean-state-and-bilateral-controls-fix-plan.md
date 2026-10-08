# Conflict clean state and bilateral controls fix

## Problems

### An untouched conflict blocks file switching

Automatically merged one-sided changes are projected with an accepted visual state. The shared
summary therefore includes them in `reviewed`, and the conflict-file switch guard currently treats
that visual count as proof of an explicit user decision. Opening a file with auto-merged changes can
therefore become dirty without any user input.

### Incoming-side controls disappear in large conflicts

The incoming comparison keeps a duplicate Result editor so CodeMirror can align Theirs against the
same Result document. Its wrapper is currently removed with `display: none`. CodeMirror creates a
revert control only when a chunk is inside both editors' viewports, so removing the duplicate Result
from layout makes the incoming control viewport stale or empty. The model still contains both side
actions, but the right action gutter is not populated.

## Plan

1. Extend the shared review summary with a count of blocks that contain explicit selected actions.
   Keep automatically resolved blocks in the accepted visual count, but out of the explicit count.
2. Gate conflict-file switching on changed Result content, explicit side decisions, or manual edits;
   never on automatic visual acceptance alone.
3. Keep the incoming MergeView's duplicate Result editor mounted and measurable as a zero-width,
   invisible geometry mirror instead of removing it from layout.
4. Add regressions for untouched auto-merged files switching freely, explicit decisions remaining
   protected, and the geometry mirror never returning to `display: none`.
5. Verify the real `project-app.lockfile` stage data still maps the visible conflict chunks to both
   Ours and Theirs decisions, then run the full frontend and native validation suites.

## Acceptance criteria

- Opening a conflicted file and making no manual edit or decision allows immediate navigation to a
  different conflict file without a warning.
- Any explicit Apply/Ignore decision or changed Result still blocks accidental switching.
- Every visible two-sided conflict in split mode gets both left and right action groups, including
  large files and positions far from the top of the document.
- The hidden Result geometry mirror consumes no visible pane width and cannot receive input.
