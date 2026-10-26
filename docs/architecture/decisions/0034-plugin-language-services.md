# ADR-0034: Plugin language services and supervised LSP sessions

- Status: accepted for implementation, 2026-10-26.
- Baseline: host `4bc39ea`, SDK `1.10.0`, package schema `3`, runtime protocol `1`.
- First provider: TypeScript/JavaScript, selected by the user.

## Ownership

Language plugins declare languages and a registered server profile. The host owns current document
identity/text/version, UI, permissions, executable provenance, LSP transport, scheduling, cancellation,
server lifecycle and edit validation. LSP objects stay in adapters rather than becoming workspace or
editor-session truth. Basic editing/highlighting remains available with every language service off.

Plugin control messages stay short. The long-lived LSP data path does not pass through the isolated
JavaScript callback lock or inherit its 30-second request lifecycle. A separate native service owns
Content-Length framing, bidirectional JSON-RPC, server notifications and bounded process cleanup.

## Frozen first-provider contract

An additive SDK `1.11.0` exports `SdkLanguageServiceContribution`, included in
`SdkPluginContribution`, with these readonly fields:

```ts
interface SdkLanguageServiceContribution {
  kind: "language-service";
  id: string;
  label: string;
  serverId: "typescript";
  languageIds: readonly string[];
  extensions: readonly string[]; // lowercase suffixes including the leading dot
  rootMarkers: readonly string[]; // bounded relative marker names; no parent traversal
}
```

The first plugin identity is `dev.asterlyn.lsp`, repository metadata
`guozhiqiang123/asterlyn-plugin-lsp`, initial plugin version `0.1.0`. Its manifest requests
capability `languageServices` and permission `host.language-services.execute`; no raw process,
filesystem, socket, task or network authority is implied. SDK/runtime/native admission all reject
unknown profiles and malformed declarations. Old hosts reject the new required capability.
The app version is not bumped or published by this implementation task.

The `typescript` profile runs a host-resolved trusted Node executable with the fixed packaged entry
`servers/typescript/server.mjs` and `--stdio`. The package supplies integrity-covered, pinned server
and TypeScript assets; the host forces the TypeScript implementation at
`servers/typescript/typescript/lib/tsserver.js`, rather than loading project-selected code. The plugin
does not choose executable paths, argv, environment, cwd or arbitrary initialization code. If a
published server requires a different fixed argument shape, both repositories must amend this ADR
before integration; do not silently ship incompatible layouts.

## Safety and lifecycle

- A provider declaration never starts a process. Lazy startup begins only for an eligible editable
  workspace document and after host-owned workspace/server execution approval.
- Approval binds workspace/window activation, plugin identity/version/digest, server assets and
  executable identity. Revalidate before launch and revoke on replacement/disable/window close.
- The enable/decline choice is in-memory for the current window's WorkspaceSession identity, not
  its Git-operation generation. Transport and one-use native reviews are independent: an idle or
  manually reactivated process still obtains a fresh review, while an identical fingerprint can
  reuse the current project's choice. Explicit plugin disable/uninstall clears that choice;
  project/provider-version changes and window shutdown prune it. No cross-restart grant is stored.
- Node/server subprocesses run as the user. No OS filesystem/network sandbox is claimed. Approval
  must describe native code execution and project/source access. No shell, automatic `npm install`,
  arbitrary download, project-local interpreter, or unreviewed project plugin loading is allowed.
- Bind every result to window, canonical worktree root, activation/session generation, document URI
  and monotonic buffer version. Independent windows with unsaved overlays do not share documents.
- Read actual normalized editor transactions, not stale `TextTabState.content` after a dirty-only
  notification. Preserve CRLF/BOM on disk; negotiate UTF-16 and test non-BMP positions.
- Coalesce document changes in order, flush before requests, cancel obsolete requests, drop stale
  responses/diagnostics, and bound messages, queues, outstanding requests, diagnostics and stderr.
- Completion edits apply through a version-checked editor transaction with normal undo. Do not
  advertise rename, resource operations, executeCommand or workspace.applyEdit in this milestone;
  reject unsupported server requests with a protocol response, without modifying files.
- Stop/disable/project replacement/app exit closes document state and terminates the owned process
  tree with finite waits. Crash/restart is bounded and cannot restart indefinitely.
- Record metadata-only lifecycle, timing, drop and cancellation evidence. Never log document text,
  full JSON-RPC payloads, completion content or diagnostics containing source snippets.

## Delivery boundary

This milestone establishes first-party language-service foundations and the first independently
packaged TS/JS plugin. Cross-file WorkspaceEdit/rename, server download/update UI, arbitrary server
configuration, remote servers, historical-document semantics and additional languages are explicit
future milestones. Their client capabilities remain disabled until their own transactions and tests
exist. Local development may vendor the new canonical SDK artifact before its first host Release,
but documentation must identify that unreleased dependency; no GitHub publication is authorized.

See [implementation plan](../../engineering/2026-10-26-language-services-host-plan.md).

Rust remains a planned follow-up, documented in the
[Rust compatibility plan](../../engineering/2026-10-26-rust-language-services-plan.md). The accepted
runtime/SDK now adds the fixed `rust-analyzer` profile in SDK 1.12.0 / host 0.1.21 / plugin 0.2.0.
It accepts only language `rust`, extension `.rs`, and sealed `servers/rust-analyzer/profile.json`:
`{"serverId":"rust-analyzer","toolchain":"1.98.1","policy":"cargo-offline-no-build-v1"}`.
The host resolves real Rustup component binaries outside the workspace, fingerprints rust-analyzer,
Cargo and rustc, fixes their environment and sysroot/rust-src, and runs Cargo offline/locked.
Project/user Cargo configuration remains part of the reviewed trust boundary. Build scripts,
proc-macro, auto-import completion and check-on-save stay disabled. Cargo model reload stays enabled:
disabling it prevented the initial virtual-workspace graph from becoming usable in the real probe.
Rust has separate process/startup/review/consent keys from TypeScript. Status is projected only as
bounded indexing/ready/degraded events, never raw server messages. Native diagnostics use negotiated
pull capability or versioned push; pull results bind the document version at dispatch, and stale
responses are discarded. Rust requests have a 30-second bound for cold semantic queries (TS stays at
10 seconds); edits/navigation continue to cancel stale work. Existing 0.1.0 TS packages remain valid.
Workspace-catalog navigation is supported first; authorized read-only dependency/standard-library
sources remain the separate R3 gate. Adding a language extension alone does not satisfy this ADR.

The [reference navigation follow-up](../../engineering/2026-10-26-language-reference-navigation-plan.md)
adds only the read-only `textDocument/references` operation. The host constructs
`includeDeclaration: false` and validates the existing document/version/position/owner. Definition
and reference results share bounded workspace-catalog navigation; querying them does not grant a
new executable, arbitrary JSON-RPC method, file read, preview transaction or WorkspaceEdit permission.

## Implemented first profile

The host uses TypeScript language-server 6.0.2 and TypeScript 5.9.3 (7.0.2 is not a drop-in
`tsserver.js` resource). Initialization forces the admitted absolute `tsserver.path`, one semantic
server (`useSyntaxServer: never`), no plugins, disabled automatic typing acquisition and a
512 MiB tsserver heap setting. This heap option is not an OS process-tree memory limit.

TLS 6 push diagnostics omit document versions. They are not relabeled with the latest editor
clock. The fixed native profile instead requests `semanticDiagnosticsSync` and
`syntacticDiagnosticsSync` through TLS's internal `typescript.tsserverRequest` read interface,
after ordered document changes. Only these two internally constructed requests are allowed; no
command name/arguments are provided by a renderer or plugin. Replies are bound to the URI/version
that scheduled them, and obsolete replies are discarded. General execute-command and workspace
mutation requests remain unavailable.
