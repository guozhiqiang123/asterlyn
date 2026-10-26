# Host language-service implementation plan

- Date: 2026-10-26. Status: planned; implementation follows this committed plan.
- User authorization: host foundations and sibling LSP plugin may be developed in parallel by
  subagents; the primary agent reviews, corrects, verifies and makes staged local commits.
- Governing contract: [ADR-0034](../architecture/decisions/0034-plugin-language-services.md).
- Plugin repository: `/Users/gzq/PrivateProjects/asterlyn-plugin-lsp`.
- Baseline: `4bc39ea`; working tree clean. No push, tag, remote repository creation or publication.

## Stages and commits

| Stage | Deliverable | Exit gate / intended commit |
| --- | --- | --- |
| H0 | Plan, ownership and frozen SDK/provider/resource layout | Documentation committed before source implementation |
| H1 | Additive SDK 1.11, native package/runtime contribution support, host registry, permissions, canonical vendored SDK, updated documentation | Positive/hostile contract fixtures, old-plugin compatibility; commit contracts separately |
| H2 | Pure native LSP session/transport, trusted Node/profile resolution, approved immutable server assets, workspace-bound authority, cancellation/cleanup and metadata logs | Framing/Unicode/notification/request/error/EOF/oversize/timeout/cancel/process-tree/stale-owner tests; commit session foundation |
| H3 | Real editor document stream, current-buffer versioning, TS/JS provider composition, host approval and basic diagnostics/hover/definition/completion presentation | Unsaved edits, non-BMP/CRLF, stale response, normal undo, tab/worktree/window separation, lazy startup and plugin disable tests; commit editor integration |
| H4 | Cross-repository package inspection and activation, real TS server exercise, complete host gates, signed native build and canonical local replacement | Primary review corrected; native logs and installed icon quit/reopen accepted; record exact evidence and limitations |

Only close implemented stages. If a dependency blocks a stage, retain a precise remaining-work list;
passing a metadata-only plugin fixture is not proof of an operational language service.

## Split ownership

- Host subagent: host production source, SDK, Rust crates, protocol, host contract tests, existing
  template SDK refresh and relevant operational/governance documentation. It must commit only its
  reviewed stage files, not the other agent's repository. It must not replace the installed app.
- Plugin subagent: every file in the sibling plugin repository; its own plan, runtime descriptor,
  localization, deterministic packages, pinned upstream server assets/license evidence, plugin tests
  and staged commits. It must not edit host source or publish a remote repository/Release.
- Primary: initial plans, contract decisions, integration audit and corrections, cross-repository
  actual-server acceptance, final host validation/package/installation. Coordinate ownership before
  touching subagent implementation files. All agents preserve others' changes.

## Required acceptance

1. No language server at Welcome, on nonmatching documents, or before execution approval.
2. Both TypeScript and JavaScript-family files select the provider; project matching is deterministic
   and bounded. Missing Node/server/assets produces a useful recoverable state.
3. The admitted package's runtime entry activates in the real isolated helper. The descriptor survives
   the complete contribution projection and admission path, not just direct in-process invocation.
4. Real pinned TypeScript LSP returns a diagnostic and useful hover/definition/completion based on an
   unsaved edit. Content-Length uses UTF-8 bytes; positions use negotiated UTF-16.
5. Late responses never overwrite a new buffer/workspace; replacing and reopening a path cannot reuse
   old diagnostics. Lifecycle cleanup leaves no service/server/tsserver child or listener behind.
6. Hostile URIs, external paths, malformed framing, oversized traffic, unsolicited modifications and
   unknown commands fail closed. Unsupported WorkspaceEdit has no disk/buffer side effects.
7. Resource evidence states actual limits and measurements; do not claim OS sandboxing or a hard
   process-tree memory cap without cross-platform enforcement evidence.
8. Use focused tests, then `npm run check`, `npm run build`, script tests, relevant Cargo tests,
   `cargo +1.98.1 fmt --all -- --check`, and locked all-target Clippy. Refresh vendored SDK bytes and
   checksums consistently; no sibling runtime/source import in production plugin dependencies.
9. Rebuild, ad-hoc sign, strictly verify, smoke, archive and install through
   `scripts/install-macos-app.mjs`; preserve `.app` root identity and verify both saved-icon launches
   from installed logs. Keep backups as verified ZIPs only.

## Deferred capability gates

Cross-file rename/code actions and resource operations require a common version-aware editor/disk
transaction with preview, dirty-buffer checks, path containment, rollback and undo. Do not enable
them by mapping LSP file writes onto the existing search-replacement controller. Add languages only
after their server/project model, licenses, resource behavior and compatibility have independent
evidence. Remote hosting and arbitrary executable/configuration providers require a separate review.

## Execution record

- Offline bundled-package MVP: because no remote plugin publication is authorized, the host
  development build now embeds the exact sealed sibling archive `dev.asterlyn.lsp` 0.1.0. The
  archive is admitted with repository/identity/version/digest binding and immutable extraction,
  alongside Android, without starting a server. Archive SHA-256 is
  `2a3cec68eb06fd13ece09f3935e15fda30ef853ee4d240c4c3bf9d1e82cbe6d9` and size is 4,579,083 bytes.
  Upstream provenance and licenses are recorded in the plugin repository's `docs/server-assets.md`
  and host `docs/plugins/language-service-package.md`.

- H0: plan and frozen first-provider contract recorded before implementation.
- H1: additive SDK 1.11.0 language-service metadata, complete TypeScript/native projection,
  admission capability/permission IDs, registry guards, and refreshed canonical template SDK
  artifact/checksum are implemented and tested in commit `3866ae8`. Runtime execution/session,
  editor integration, and real-server acceptance remain pending H2–H4.
- H1 primary review: reject unknown server profiles and malformed array members before external
  projection; bounded unique metadata and path-free root markers are checked in the shared host
  validator. Registry atomicity and hostile projection fixtures pass (33 focused tests). Governance
  now records the development language contract and current package schema range.
- H2–H4: in progress; native command wiring is not accepted until installed-package authority,
  asynchronous responses and lifecycle cleanup are verified. Editor and actual-server gates remain
  required.
