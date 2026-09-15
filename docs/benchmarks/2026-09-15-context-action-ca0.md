# CA0 shared context-menu host acceptance

Date: 2026-09-15

Status: locally accepted; installed native multi-window checks remain for release acceptance

## Scope and architecture

CA0 replaces the editor-specific, module-global Git Blame menu with one business-neutral context
menu host per application window. The host owns transient DOM, root/submenu placement, focus,
keyboard and pointer behavior, blocked/busy presentation, listener cleanup, and focus return. The
Editor feature still owns the exact Blame source, availability, loading/result generations,
invocation, and stale-result checks.

The host is prepared asynchronously through a window-owned facade, so the implementation remains
outside the startup JavaScript chunk. CodeMirror line-number, code-row, and Blame-annotation events
only prevent the browser menu and pass their pointer anchor plus the exact mounted editor target.
They no longer create body DOM, retain a module-level active menu, or install document/window
listeners.

The existing Git behavior is unchanged: ordinary saved tracked files map to the worktree; working
Diff maps `HEAD` and worktree sides; commit/Push Diff maps first-parent and selected-commit sides;
dirty, untracked, missing, and unified sources fail closed. Incremental bounded Git output, hunk
storage, edit invalidation, and result-generation checks remain in their previous owners.

## Automated validation

| Check | Result | Conclusion |
| --- | ---: | --- |
| TypeScript check | passed | no type regression |
| Frontend/application script suite | 360 passed | no regression observed |
| Focused context-menu tests | 5 passed within the suite | model, navigation, placement, provider, and ownership covered |
| Git crate tests | 72 passed | existing Blame revision behavior remains accepted |
| Production frontend build | 333 modules transformed | passed |
| Whitespace/error check | passed | no patch-format errors |

The model tests reject empty labels/action IDs, duplicate item IDs, invalid separators, empty
blocked reasons, and invalid submenu structure. Navigation tests cover separator skipping, wrap,
Home/End-equivalent edges, type-ahead, viewport clamping, and submenu direction flipping. Static
ownership tests prove the CodeMirror adapter has no active-menu state, body rendering, or listener
registration and that application disposal reaches the lazy window host.

## Browser interaction evidence

The browser demo exercised the real CodeMirror and shared-host path:

- right-clicking a split-Diff code row opened one `menu` with a focused `menuitemcheckbox`;
- the initial action was unchecked and enabled; activation closed the menu, restored focus to the
  exact read-only Diff side, and installed five before-side Blame markers;
- reopening showed the checked `Hide Git Blame annotations` state;
- switching to unified Diff cleared the side result and exposed the same focusable item with
  `aria-disabled="true"`, `aria-describedby`, and the side-by-side explanation;
- keyboard activation of that blocked item performed no Git read, kept the menu open, and surfaced
  the same reason through the application feedback area;
- Escape removed the context overlay. A focus defect found during this journey was corrected by
  making each read-only Diff editor root a programmatic focus-return target;
- no browser warning or error was recorded.

## Output and resource evidence

No package dependency was added. An exact detached build of the documentation baseline
`01024be` was compared with the accepted CA0 build.

| Output | Baseline | CA0 | Movement | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Startup JavaScript | 521,235 B | 522,484 B | +1,249 B / +0.24% | small regression |
| Main CSS | 121,611 B | 121,947 B | +336 B / +0.28% | small regression |
| Lazy context-menu host | 0 B | 9,655 B raw / 3,110 B gzip | new asynchronously prepared chunk | expected |

The startup chunk already exceeded the historical 500 kB target at the baseline; CA0 does not
resolve that existing debt. Moving the complete host to an asynchronously prepared chunk avoided a
9.65 kB direct startup addition while keeping the host ready before the tested first interaction.

No process-memory series was run, so memory movement is **inconclusive**. Structurally, the facade
retains at most one pending session before loading, the host mounts at most one root and one submenu,
and each open session owns one abortable listener set plus one type-ahead timer. Close or window
disposal removes the DOM, aborts listeners, clears the timer, and releases the session callbacks.

## Limitations and next action

The product currently exercises the host with one Git Blame check item, so submenu behavior is
covered by pure model/position/navigation tests rather than a shipped product submenu. Native
Windows/macOS multi-window interaction, forced-colors, high system scaling, and a 1,000-cycle heap
observation remain release hardening checks. The existing startup chunk budget violation remains
tracked and must not be attributed solely to CA0.

CA0 is ready to close. CA1 may now add typed navigation/clipboard ports and stable feature-owned
context bindings without adding a central action switch to `AsterlynApp`.
