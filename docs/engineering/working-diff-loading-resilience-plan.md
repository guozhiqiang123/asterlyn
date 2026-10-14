# Working Diff Loading Resilience Plan

## Problem

Returning to Asterlyn after the window has been in the background can start workspace, working-tree, and remote reconciliation. Opening a file from Changes at the same time can leave the editor on `Loading patch…` indefinitely.

The current working-Diff request has three relevant properties:

- the visible patch and the optional editable baseline are awaited as one completion;
- an unresolved desktop invocation has no frontend deadline;
- ordinary bounded Git reads limit output size, but not elapsed execution time.

The existing request sequence protects against stale completions, but it cannot settle a request whose promise never completes.

## Goals

1. Render the textual patch as soon as the patch read succeeds; the optional editable baseline must not block it.
2. End the loading state after a bounded period and expose the existing retry UI.
3. Bound the native Git process used to produce a local patch so an abandoned request does not leave work running forever.
4. Preserve latest-request ownership when focus recovery, file selection, and snapshot reconciliation overlap.
5. Add deterministic tests for a non-settling patch read, a non-settling editable baseline, and stale late completions.

## Design

### Patch-first controller settlement

Start patch and baseline reads together, but treat them as separate phases:

- await the patch under a request deadline;
- on success, install and render the patch immediately and clear `workingPatchLoading`;
- continue awaiting the baseline under its own deadline;
- if the baseline arrives for the current request, install it and upgrade the surface to the editable Diff;
- if the baseline fails or times out, retain the read-only patch without surfacing a patch-load failure.

Every state write remains guarded by the existing request sequence, repository generation, root, and path checks.

### Frontend deadline

The controller owns a configurable timeout with a production default. A patch timeout follows the ordinary error path, clears the spinner, and exposes Retry. The timeout wrapper also absorbs late promise settlement so it cannot create an unhandled rejection.

### Native deadline

Extend bounded Git output collection with an elapsed-time deadline. Use it for the complete local patch command. Reaching the deadline terminates the child and returns a normal I/O timeout error to the desktop command boundary.

The editable baseline remains non-blocking at the UI layer; expanding native deadlines to every historical blob read is intentionally out of scope for this change because those reads are shared by several history features.

### Diagnostics

Keep the user-facing surface concise. Timeout errors identify that loading exceeded the safe duration and can be retried. Detailed command instrumentation can be added separately if field evidence still shows lost desktop callbacks after both deadlines are active.

## Verification

- Controller tests prove that patch success clears loading before the baseline settles.
- Controller tests prove that a never-settling patch transitions to Retry.
- Controller tests prove that a never-settling baseline leaves the patch usable.
- Existing selection, snapshot reconciliation, and focus-recovery tests remain green.
- Rust process tests prove that bounded output terminates a command at its deadline.
- Type checking, frontend tests, Rust formatting, and targeted Rust tests pass.

## Non-goals

- Changing the focus-recovery policy or disabling background fetch.
- Serializing all repository reads behind remote operations.
- Changing Diff presentation, navigation, or editable-file semantics.
