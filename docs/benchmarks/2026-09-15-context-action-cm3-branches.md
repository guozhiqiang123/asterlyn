# CM3 Branches context-menu acceptance — 2026-09-15

## Outcome

The Branches surface now owns its context target, menu projection, copy actions, and reviewed
branch-change dialog while continuing to share the window-level menu host. Existing branch-detail
Switch/Create entry points use the same reviewed mutation path; Update, Push, Merge, and Rebase
continue through their established feature controllers rather than duplicating Git behavior.

The menu varies by verified target identity:

- the current local branch offers History, Create, Update, Push, Rename, and exact-name copying;
- another top-level local branch adds Switch, Merge, Rebase, and safe local Delete;
- a top-level remote-tracking branch either switches its unique configured local tracking branch or
  offers a named local checkout, plus Create, Merge, Rebase, and copying;
- a logical row spanning multiple Git roots, or a row owned only by a nested Git root, remains
  read-only with History and copying;
- tags remain outside the B1 menu as drafted.

Menu construction performs no native work. A write activation captures the canonical ref and object
and opens either the new prepare/revalidate/execute branch dialog or an existing reviewed operation.
The dialog reports full source/destination refs, exact object IDs, current symbolic HEAD, upstream,
and safe-delete merge evidence before execution.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Focused Branches policy/provider/controller tests | 5 passed |
| Full frontend/delivery suite | 421 passed |
| TypeScript check | passed |
| Production build | 360 modules transformed; passed with the existing startup-chunk warning |
| Pointer interaction | another local branch opened B1 without changing History or executing Git |
| Keyboard interaction | `Shift+F10` opened the remote-branch menu and focused its first item |
| Dialog/focus | Rename produced an exact-ref review; Escape closed it and restored the source row |
| Localization | English and Simplified Chinese catalog shape and UI-literal gates passed |

The startup JavaScript is 598,660 B raw / 140,240 B gzip, compared with the CM2 checkpoint's
580,107 B raw / 134,730 B gzip. The 18,553 B raw / 5,510 B gzip increase contains the feature-owned
policy, controller, dialog, localization, and composition adapter. The shared context-menu host
remains its existing lazy 9.65 kB chunk, and no row-scoped persistent listeners were added.

## Known limits

- The existing startup bundle remains above the 500 kB architecture target. CM3 completion will
  assess whether the branch and History providers should move behind the Git tool's lazy boundary.
- Browser-demo branch execution is deterministic but does not replace the native Git integration
  evidence recorded by the CM3 foundation checkpoint.
- Remote delete, force delete, detached checkout, automatic stash, linked-worktree management,
  arbitrary branch comparison, and nested-root writes remain intentionally absent.
- Windows, macOS, and Linux native assistive-technology smoke checks remain release-bound; this
  checkpoint verifies semantic roles, keyboard entry, focus return, and forced-colors CSS gates.
