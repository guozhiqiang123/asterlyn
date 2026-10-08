# Conflict resolution actions plan

- **Status:** Implemented
- **Date:** 2026-10-08

## Objective

Bring the three-pane conflict editor to the interaction level of Android Studio: every visible Ours
or Theirs change exposes an explicit Apply action and an explicit Ignore action, and a conflicting
block can accept both sides into Result without the second action overwriting the first.

## Behavior contract

- Ours and Theirs remain immutable; Result remains the only editable document.
- Each side's change control contains Apply and Ignore. The actions are independently accessible,
  keyboard-focusable, localized, and disabled while conflict resolution is being saved.
- Applying one side replaces the neutral block with that side. Applying both sides composes Ours
  then Theirs once each. Equal content is never duplicated.
- Ignoring one side records that decision without changing Result. Changing an already-applied side
  to Ignore recomputes the block from the remaining accepted side or its initial Result content.
- Manual edits and editor undo invalidate stale action state for the touched block instead of
  silently claiming that an old decision is still applied.
- Save and Stage retains the existing exact revision-token boundary; action state is transient
  presentation state and is never serialized as Git truth.

## Architecture

1. Build stable conflict blocks from Base-to-Ours and Base-to-Theirs changes. Each block owns exact
   source ranges, an initial Result range, side content, and independent side decisions.
2. Map Result edits through CodeMirror change descriptions so stable blocks survive earlier actions
   and ordinary typing.
3. Replace CodeMirror's one-action revert button with a feature-owned two-button group. Button
   events stop before CodeMirror's default replacement handler and dispatch reviewed block edits to
   the primary Result view.
4. Keep the existing primary/mirror Result synchronization, language support, scrolling, styling,
   draft protection, and native resolve boundary.

## Acceptance

- Apply Ours, Apply Theirs, Ignore Ours, and Ignore Theirs work independently.
- Applying both sides works in either click order and yields the same Ours-then-Theirs Result.
- Insert/insert, replace/replace, delete/modify, identical-side, adjacent independent, CRLF, manual
  editing, undo, read-only save state, and remounted controls have automated coverage.
- Controls retain the shared 26-pixel Diff action geometry and remain centered in the widened gutter.
- Full script tests, TypeScript check, production build, native package replacement, installed-binary
  hash verification, and a relaunched installed app close the task.

## Verification

- Script suite: 855 passed, 0 failed.
- TypeScript check and production web build: passed.
- Native tests: 62 passed, 0 failed, 2 ignored; native rendered-shell smoke: passed.
- The packaged and installed executables both have SHA-256
  `e087387c0747ef7df774f17c7d6d98a3989d7a992c61e64763e68bda6ae98dd4`.
- `/Applications/Asterlyn.app` was replaced and the installed application was relaunched.
