# Activity navigation and hierarchy-alignment evidence — 2026-09-12

## Scope and comparison

This focused correction compares the preceding locally accepted Push-review package with three workbench presentation changes: reorderable activity navigation, aligned Changes inclusion controls, and explicit branch-tree indentation. It does not change Git state, repository queries, editor ownership, tool-window placement, or the Stage 3 sequence.

## Functional and accessibility evidence

The Files, Branches, and Changes activity entries can be reordered with a direct pointer gesture. A five-pixel movement threshold preserves ordinary clicks, crossing the upper or lower half of another entry provides a visible insertion edge, and release outside a valid target leaves the order unchanged. The normalized order is stored as an independent presentation preference, rejects malformed or duplicate values, and adds newly introduced known tools exactly once. Unavailable entries remain focusable with truthful `aria-disabled` state so they can still be moved without pretending their tool window can open.

The same ordering is available through `Alt+ArrowUp` and `Alt+ArrowDown`, with boundary clamping and focus retained on the moved entry. Four pure tests cover normalization, pointer-target ordering semantics, keyboard movement, persistence, and malformed-storage recovery.

Changes group, top-level directory, and top-level file inclusion controls now occupy the same horizontal selection column. Tree descendants add one consistent 13-pixel indentation step per level; the disclosure mark follows the checkbox, so expanding a directory does not shift the selection column. Branch rows now begin beneath their group rather than at the group edge, and remote branch rows add a second indentation level beneath the remote root.

## Browser interaction evidence

A production-like browser journey moved Changes above Branches with the keyboard and retained `Files, Changes, Branches` after reload. A real pointer drag then moved Changes ahead of Files and retained `Changes, Files, Branches`; the final pointer regression moved Branches to the start and retained `Branches, Changes, Files` after another reload.

Geometry inspection measured the Changes group and top-level directory checkbox centers at the same x-coordinate of 63 pixels. Descendants advanced to 76, 89, and 102 pixels in exact 13-pixel steps. The branch group label began at approximately 73 pixels after its disclosure mark, while local branch, remote root, and remote-child labels began at 84, 88, and 100 pixels respectively. The browser warning and error console remained empty.

## Validation and resource interpretation

The final validation passed all 180 script tests, 48 `asterlyn-git` tests, 25 `asterlyn-workspace` tests, 17 Tauri library tests, and the Tauri binary test. TypeScript checking, Rust formatting, strict workspace Clippy, whitespace checks, the production frontend build, Debian packaging, and a six-second native liveness smoke also passed. No delegated model or reviewer was used.

The production frontend emits 100.17 kB of CSS (22.85 kB gzip), a 732.78 kB main JavaScript chunk (207.07 kB gzip), and the unchanged separately loaded 97.28 kB Markdown-it chunk (40.86 kB gzip). Against the preceding accepted package, CSS increased by 0.40 kB raw (0.4009%) and 0.09 kB gzip (0.3954%); main JavaScript increased by 3.67 kB raw (0.5034%) and 1.07 kB gzip (0.5194%). All four are **no material change** under the one-percent threshold. Vite retains the existing main-chunk warning; code splitting remains a separate optimization.

The final Linux binary is 19,572,032 bytes and the Debian package is 6,827,984 bytes. These are increases of 3,376 bytes (0.0173%) and 4,450 bytes (0.0652%) respectively, both **no material change**. The local package is `target/release/bundle/deb/Asterlyn_0.1.0_amd64.deb` with SHA-256 `8e02f98e81547ebfa48074b365709948975bc7bbaca3e320afccad25974dc5f4`.

No matched native process-tree resource series was run for this presentation-only correction, so memory impact is **inconclusive**. Interaction hierarchy and accessibility are **improved**, while frontend and native artifact sizes show **no material change**.

## Limitations and next action

Ordering is intentionally limited to the three existing activity entries; it does not move tools between the left and bottom docks or define future plugin placement. The pointer path is browser-accepted, but installed macOS gesture feel remains part of manual package acceptance. Nested Changes checkboxes indent with their tree level rather than forming one global column, preserving the file hierarchy.

The next action is manual acceptance of the local Debian package, concentrating on repeated activity-entry dragging, ordinary click behavior after a drag, Changes tree alignment, and branch hierarchy at narrow Git-pane widths.
