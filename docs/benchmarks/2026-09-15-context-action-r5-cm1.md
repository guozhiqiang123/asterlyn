# R5 workspace mutations and CM1 Files context-menu acceptance

Date: 2026-09-15

Status: locally accepted; installed native cross-platform interaction remains a release gate

## Delivered behavior and architecture

The Files tree now uses the shared window context-menu host while retaining feature ownership. File
and folder rows expose the same ordered actions: New File, Cut, Copy, Paste, reveal in the system
file manager, Rename, the File Name/Relative Path/Absolute Path copy submenu, Git History, and Move
to Trash. Opening the menu only selects the exact row; it does not open a file or expand a folder.
Browser demo mode keeps read-only actions usable and explains why filesystem mutations are blocked.

Create and Rename use inline tree editing. Paste collisions ask for a different destination name
and never replace. Trash displays an explicit file or bounded recursive-directory preview before
execution. Cut/Copy uses a window-local identity clipboard rather than file bytes or the operating
system file clipboard. Every captured source is bound to one workspace generation and a complete
inspection fingerprint; a changed, linked, multiply-linked, nested-repository, or truncated source
cannot execute.

The new product-neutral workspace layer plans and executes exclusive create, verified copy, move,
and system-trash operations below the Tauri/UI boundary. Plans enforce canonical containment,
reject symlink traversal and descendant/self destinations, retain bounded inventory counts, and
produce typed outcomes/path remaps. The application coordinator serializes writes, owns cancellation
and recovery, executes behind the versioned reconciliation barrier, and reports success only after
the accepted workspace projection. Editor migration leases keep dirty buffers, CodeMirror state,
selection, scroll, and undo history attached across file or folder moves; dirty trash targets and
destination-tab collisions fail closed.

Native reveal accepts only an authorized workspace-relative entry. Finder and Windows Explorer can
select files; Linux opens the containing folder and reports honestly that selection was unavailable.
Trash uses the published `trash` 5.2.9 crate with default features disabled. Its bundled MIT text,
version, upstream tag, package resource, and platform adapter are recorded in the repository. A
failed trash operation never falls back to permanent deletion.

## Automated validation

| Check | Result | Conclusion |
| --- | ---: | --- |
| Frontend/application script suite | 407 passed | menu, policies, bindings, file clipboard, coordinator, editor leases, reconciliation, and regressions accepted |
| TypeScript check | passed | protocol and composition wiring are type-safe |
| Production frontend build | 343 modules transformed | passed |
| Workspace crate tests | 40 passed | containment, inventory, fingerprint, copy/move/create/trash, recovery, and fault behavior accepted |
| Desktop adapter tests | 3 passed | argument-safe platform reveal and no-delete-fallback Trash behavior accepted |
| Desktop adapter Clippy | passed with warnings denied | no lint debt introduced in the adapter |
| Rust formatting check | passed | all Rust sources parse and are formatted |
| Patch whitespace check | passed | no patch-format errors |

Focused frontend cases additionally prove identical file/folder menu shapes, stable target lifetime,
read-only/busy/clipboard/history policy reasons, action-error feedback, collision naming, fingerprint
revalidation, explicit Trash confirmation, hidden-entry counts, stale-plan cancellation, generation
advancement after a successful copy, and safe source rejection.

## Browser and accessibility evidence

The real browser demo exercised the production tree and shared host:

- mouse right-click opened the complete file menu and selected the target without opening it;
- the Copy Path submenu exposed exactly File Name, Relative Path, and Absolute Path;
- activating Relative Path closed both menus, announced success, and returned focus to the exact row;
- selecting a folder and pressing Shift+F10 opened the same action set with folder identity;
- Escape hid the root and submenu DOM and restored focus to that folder row;
- unavailable native mutations remained focusable with an adjacent explanation instead of silently
  disappearing or invoking a bridge;
- the confirmation/paste dialogs use labelled modal roles, focus entry/trapping, Escape cancellation,
  disabled busy controls, inline errors, and best-effort exact-row focus restoration.

No browser warning or application error was recorded. Forced-colors and high-system-scaling behavior
are inherited from the accepted shared host but were not manually repeated for this milestone.

## Output, latency, and memory evidence

An exact detached build of the read-only Files context baseline `5332cf7` was compared with CM1.

| Output | Baseline | CM1 | Movement | Conclusion |
| --- | ---: | ---: | ---: | --- |
| Startup JavaScript | 546,236 B raw / 127,167 B gzip | 566,672 B raw / 131,623 B gzip | +20,436 B raw / +4,456 B gzip | bounded regression, but above existing 500 kB budget |
| Main CSS | 121,947 B raw / 26,181 B gzip | 122,986 B raw / 26,346 B gzip | +1,039 B raw / +165 B gzip | small regression |
| Shared context-menu host | 9,655 B raw / 3,110 B gzip | unchanged lazy chunk | no movement | menu presentation remains off startup path |

Menu construction is synchronous and performs no native scan or Git read. Recursive work begins only
after an enabled action is invoked and is bounded before authorization. The full 407-test frontend
suite completed in 2.92 seconds on this host; this is a regression signal, not an interaction-latency
benchmark.

No retained-heap series was run, so measured memory movement is **inconclusive**. Structurally, one
window owns one operation controller, one identity clipboard entry, at most one plan, one inline edit
or dialog, and disposable subscriptions. Directory inventory, mutation plans, recovery records, and
watch invalidations are bounded. Successful reconciliation or reset releases transient plans; stale
workspace completion cancels rather than retaining busy state.

## Dependency and native evidence

`trash` 5.2.9 is used only by the product-neutral desktop adapter with default features disabled.
The accepted registry checksum is
`be89b3fe156965d29ac4f8522f3a640c655affdd9f21cb4f36857f0c92c00317`; the upstream `v5.2.9` tag
resolved to `1021b2239a5e859197c94918b402fbe0683a2cbb1`. Its MIT license is bundled at
`third-party/licenses/trash-5.2.9-MIT.txt` and copied into desktop resources. The crate declares Rust
1.85 and supports Linux, macOS, and Windows through its published distribution.

The product-neutral Rust crates compile and test on this Linux host. Building the complete Tauri
shell is blocked in this environment by absent system development packages for libsoup 3,
JavaScriptCoreGTK 4.1, and WebKitGTK 4.1; no source-level Tauri failure was observed before that
host dependency boundary.

## Known limitations and next action

- Installed Finder, Explorer, Linux file-manager, and Trash interactions still require the release
  matrix on their native operating systems; Linux folder reveal cannot promise file selection.
- Network filesystems, cross-device replacement details, ACL/xattr preservation, and interference by
  non-cooperating external writers retain the honest limits documented by R5 outcomes and recovery.
- The internal file clipboard intentionally does not cross windows/projects or interoperate with the
  system file clipboard.
- The startup chunk was already over the 500 kB architecture target and grew by 4.46 kB gzip for the
  operation controller/dialog integration. Later surface work must avoid another central startup
  switch and should opportunistically split operation UI without coupling feature ownership.
- A 1,000-cycle retained-heap observation, forced-colors pass, high scaling pass, and full installed
  cross-platform run remain release hardening gates.

R5 and CM1 are ready to close. CM2 should reuse the existing Changes controller plus the shared
navigation/clipboard/mutation ports; it must not duplicate filesystem or Git execution inside a
menu provider.
