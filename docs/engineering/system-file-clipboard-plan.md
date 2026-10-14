# System file clipboard interoperability plan

Status: implemented and installed; manual interoperability acceptance pending (2026-10-13)

## Problem

The Files tree already owns scoped Copy, Cut, and Paste commands, but its
`WorkspaceFileClipboard` is window-local. Copying a selected file therefore does not publish a
file-list payload that Finder or Explorer can paste, and Paste cannot see a file-list payload
created outside Asterlyn. Text fields and CodeMirror correctly retain their own ordinary text
clipboard behavior; this change must not broaden Files shortcuts into those scopes.

## Decision

1. Keep `WorkspaceFileClipboard` as the reviewed source identity for in-workspace Copy and Cut.
   A successful Files Copy/Cut also publishes the resolved entry to the operating-system file
   clipboard and records an opaque clipboard token. A later Paste uses internal Copy/Move only
   while the current system file clipboard still has that token. Copying another file in the
   operating system therefore supersedes stale internal state.
2. Add a native clipboard adapter behind `WorkspaceBridge`. The web layer receives only an opaque
   token, UTF-8 display name, and file/directory kind; it never receives an arbitrary external
   absolute path. Import re-reads the clipboard and requires the token to match before any write.
3. Import exactly one regular file or real directory in this slice. Reject symbolic links/reparse
   points, nested repositories, multiple hard links, non-UTF-8 names, over-limit inventories, and a
   destination inside the imported directory. The existing transfer limits remain 20,000 entries,
   512 MiB, depth 64, and 4,096 path bytes.
4. Build the complete external entry in a temporary sibling location, verify both the staged copy
   and the source inventory, then install it with a no-replace rename. A destination that already
   exists returns a typed collision so the existing rename dialog remains the recovery path.
5. A completed import emits the same workspace-catalog and working-tree invalidations as an
   internal Copy and passes through the existing reconciliation barrier before UI completion.

## Dependency and supply-chain record

- Package: `clipboard-rs` 0.3.5 from crates.io, pinned exactly and compiled with default features
  disabled so its unrelated image stack is not shipped.
- Upstream: `https://github.com/ChurchTao/clipboard-rs`; license: MIT. The upstream license text is
  stored at `third-party/licenses/clipboard-rs-0.3.5-MIT.txt` and bundled in native packages.
- Integrity: crates.io checksum
  `d1c988a897ea030e32f0668c90b0192800e0c561b3d941fc366f9ad5a1bf26ba`, locked by
  `Cargo.lock`.
- Package impact: one native clipboard implementation plus its platform support dependencies. No
  frontend dependency or eager JavaScript chunk is added. macOS and Windows use their native file
  clipboard formats. The default Linux build uses X11; Wayland support is not enabled in this
  slice and remains a documented limitation.

## Acceptance matrix

- Files focus + platform Copy publishes a selected file and directory for Finder/Explorer paste.
- Finder/Explorer Copy + Files folder selection + platform Paste imports the entry and refreshes
  Files/Changes without a manual reload.
- A system clipboard overwrite supersedes an older internal copy/cut entry.
- Same-name imports open the existing rename dialog and never replace the destination.
- Empty, text-only, multi-entry, unsafe, changed-during-copy, and over-limit clipboards fail without
  modifying the workspace and show localized feedback.
- Editor/input text Copy and Paste remain native text operations; Files commands stay scoped to
  the Files tree.
- Focused TypeScript/protocol tests, native workspace tests, full `npm run check`, production
  frontend build, native Rust tests, and a freshly installed macOS app all pass. Performance,
  memory, artifact size, accessibility, and limitations are recorded before closure.

## Acceptance evidence

- Implementation boundaries: OS clipboard access is isolated in the native adapter; the renderer
  sees only a SHA-256 token, display name, and kind. External paths are re-read from the clipboard
  and revalidated under the active workspace write lock. Imports use a 64 KiB streaming buffer and
  a bounded inventory rather than loading file content into renderer or native memory wholesale.
- Automated behavior: system-token-preserving internal paste, external clipboard precedence,
  protocol validation, file/directory import, no-replace collisions, nested-repository rejection,
  and symbolic-link rejection have focused regression coverage.
- Verification on macOS arm64 (Rust 1.97.1, Node 26.8.1, npm 11.19.0):
  - `npm run check` passed.
  - `npm run test:scripts` passed all 970 tests. One earlier unrelated XML-fold timing failure passed
    both its isolated rerun and the final full-suite rerun.
  - `npm run build` passed.
  - `cargo test -p asterlyn-workspace --lib` passed all 79 tests.
  - `cargo test -p asterlyn --lib` passed 70 tests; two existing real-watcher tests remained ignored
    by design.
  - `cargo test -p asterlyn-git` passed 143 tests across unit and integration suites.
  - The rendered native smoke test passed within its six-second budget.
- Packaging: the fresh `0.1.6` arm64 application is ad-hoc signed with hardened runtime and passed
  `codesign --verify --deep --strict`. The `clipboard-rs` MIT license is present in the bundle.
  The application grew from 24,829,952 to 24,997,888 bytes (+167,936 bytes, about 0.68%); the
  executable grew from 24,680,144 to 24,844,800 bytes (+164,656 bytes).
- Acceptance archive:
  `target/release/bundle/macos/Asterlyn-0.1.6-local-2026-10-13-system-file-clipboard.app.zip`,
  9,490,243 bytes, SHA-256
  `7872166270e3c1b25b66c80bbac81103485c21b11922b8dd551a3eb5932f4247`.
- Installation: `/Applications/Asterlyn.app` was replaced and relaunched. Its executable SHA-256
  is `910ce6d9089741634ef1074c6fd409763fd1f1f442173f67433c0b9cc7ef4b02`, exactly matching the
  verified build. The previous app is recoverable at
  `/Users/gzq/.Trash/Asterlyn-before-system-file-clipboard-20261013.app`.
- Manual acceptance remains for Finder-to-Asterlyn and Asterlyn-to-Finder file/directory transfers,
  collision renaming, and confirming editor/input text clipboard behavior in the installed app.
  This slice intentionally supports one clipboard entry at a time. Linux Wayland file clipboard
  interoperability remains outside this dependency configuration; Linux uses its X11 backend.
