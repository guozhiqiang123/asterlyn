# TypeScript / JavaScript language services — 2026-10-26

## Scope and identities

Host source stages: native/authority `5fcc641`, editor composition `d8887b6`. App version remains
0.1.20; SDK 1.11.0 is a development artifact, not a published Release. Independent plugin repository:
`/Users/gzq/PrivateProjects/asterlyn-plugin-lsp`, package `dev.asterlyn.lsp` 0.1.0. Offline pinned
archive is 4,579,083 bytes, SHA-256
`2a3cec68eb06fd13ece09f3935e15fda30ef853ee4d240c4c3bf9d1e82cbe6d9`.

## Automated evidence

- 1307 script tests pass with test concurrency 4, including architecture/ownership budgets, SDK,
  old Android package, hostile contribution projection, controller and desktop protocol guards.
  Unbounded file parallelism exposed an existing timing-sensitive XML folding test; its focused
  rerun and the complete bounded-concurrency run passed without changing its product time budget.
- `cargo +1.98.1 test --locked --workspace`, with `ASTERLYN_LSP_PACKAGE_ROOT` pointing to the sibling
  package and `ASTERLYN_LANGUAGE_SERVICE_NODE=/opt/homebrew/bin/node`: 493 pass, 6 existing ignored.
- Actual native actor: unsaved TS type error at version 1, version 2 fixed-buffer diagnostic clear,
  foreign-owner rejection, stale-version rejection and revocation-driven termination. Approximately
  1.2 seconds for the complete fixture under the test load; not a production performance promise.
- Controlled stdio fixture: one stalled hover does not block another request or cancellation;
  foreign-window stop is rejected. Framing/JSON-RPC shape/EOF, UTF-8 lengths, UTF-16/non-BMP,
  sequential changes and atomic failed updates have focused tests.
- Real CodeMirror rendering: actual unsaved update stream, diagnostics, completion text edits,
  normal undo, deferred stale completion suppression, read-only service removal, epoch close/open.
- `npm run check`, `npm run build`, standalone `npm run plugin-template:verify`, locked all-target
  strict Clippy, and Rust formatting pass. Existing architecture budgets were preserved by moving
  capability-specific editor code and native fixtures to their own modules, not raising ceilings.
- Final signed native package: strict ad-hoc signature verification passed with identifier
  `dev.asterlyn.desktop` and sealed resources version 2; the native app rendered its shell during
  the 15-second smoke window. The canonical installer preserved the installed `.app` root identity
  and verified frontend readiness on initial saved-icon launch and quit/reopen via the same icon.
  The installed executable matches the accepted signed artifact. The detach-diagnostics regression
  assertion passes on the final code. Exact build/digests are in
  [the native evidence](2026-10-26-language-services-install.json).
- Installed build: `10df7d69a30f070232ed97fe8737f3e7d567cd27-clean-1792985414996`; application version remains 0.1.20.
  Archive SHA-256: `9a4b5406448d11926ac5efb8251ef974e587e7c79aac5946b0455c9f07393b6f`.
  The final archive is `target/release/bundle/macos/Asterlyn-0.1.20-lsp-20261026-final-macos.app.zip`.
- Installed startup logs also contained `existing_project_directories` validation errors and one
  initial `open_project` I/O failure; frontend readiness succeeded for both icon launches, and no
  language server was started at Welcome. These recent-project/startup-data errors are not claimed
  fixed by this milestone. Follow up on the existing native eight-path recent-directory bound and
  macOS smoke profile isolation (XDG-only variables do not isolate WebKit's saved project state).


## Resource behavior

One session per window, lazy and approved only for supported editable files. No language server is
started at Welcome or merely by activating plugin metadata. Native review includes the package,
resource and Node identity and is bound to the current native workspace activation. Approval does
not claim an OS sandbox: the processes run with the user's system permissions. Node must be
22.22.2+ in a standard system installation; no runtime download or workspace-local interpreter.

Bounds: 2 MiB per open document, 32 documents, 64 outstanding native feature/diagnostic requests,
16 queued native commands and 16 incoming frames, 4 MiB per frame, 8 KiB headers, 512 diagnostics,
10-second requests, one approved startup per window. Stderr is drained and discarded; document
text, diagnostic messages, completion data and full JSON-RPC are not logged. Lifecycle logs carry
session/version/count/timing metadata and hashed document identities. Failed servers do not enter
an automatic restart loop. The trusted child process group is forcefully terminated during cleanup.

The current host profile forces TypeScript 5.9.3 resources, disables automatic typing acquisition
and project plugins, and uses a single semantic server (`useSyntaxServer: never`). The 512 MiB
TypeScript heap setting is not a hard aggregate memory cap. Sibling process-group samples were
362,944 KiB for TS and 380,528 KiB for JS; initialization was about 66–76 ms. These are macOS
samples for tiny fixtures and exclude application memory. All owned child PIDs were gone after
cleanup (about 96–382 ms in the measurement; the JS fixture required its bounded kill fallback).

## Accessibility and limits

The host execution dialog uses the existing localized modal/focus/Escape behavior. Completion and
lint tooltips use CodeMirror keyboard controls; hover is plain text and F12 navigates definitions.
Rendered tests are programmatic; user manual acceptance of the installed language-service UI is
not claimed. macOS runtime was tested; Windows/Linux runtime acceptance remains open.

Definition navigation is limited to editable files present in the current workspace catalog.
External libraries and historical documents are not projected as editable worktree overlays.
Snippets, completion commands, additional text edits, rename, code actions and WorkspaceEdit are
not enabled. Other languages, remote servers and arbitrary server executables need separate plans.
