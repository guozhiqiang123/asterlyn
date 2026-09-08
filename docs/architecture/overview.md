# Architecture overview

## Architectural objective

The architecture must let Asterlyn grow from a Git workbench into a mature developer environment without placing every future capability in one process, one state store, or one framework.

```text
Presentation (TypeScript, CodeMirror, design system)
                         |
Versioned application commands and events
                         |
Application services (use cases, jobs, cancellation, policy)
                         |
Domain capabilities (Git, workspace, editor, language, debug, tasks)
                         |
Adapters (system Git, filesystem, LSP/DAP, terminal, OS keychain)

Tauri is a shell/transport adapter, not the domain center.
```

## Initial repository layout

- `crates/asterlyn-git`: pure Rust models, parsers, and safe system-Git invocation. It has no Tauri dependency.
- `src-tauri`: desktop command registration and serialization boundary.
- `src`: frontend application state, views, and CodeMirror integration.
- Future capabilities become separate crates or supervised processes when their lifecycle, failure domain, or dependency weight justifies it.

## Dependency rules

1. Domain code cannot import Tauri, DOM, or CodeMirror types.
2. UI code consumes serializable application models and never parses raw Git porcelain.
3. All external process invocation uses argument arrays, never shell interpolation.
4. Mutation commands are narrower than query commands and return enough state for the UI to reconcile.
5. UI state is replaceable; repository truth is re-read from Git after mutations.
6. Long-running work supports cancellation, progress, bounded output, and stale-result rejection.

## Runtime model

M1 uses the Tauri webview process plus a Rust host. Git operations run off the UI thread. Later language servers, debuggers, terminals, extension hosts, remote agents, and AI providers run behind supervisors with explicit lifecycle and resource budgets.

This avoids both extremes: a monolith that loads every subsystem at startup and microservices introduced before a process boundary has operational value.

## Evolution seams

- **Desktop shell:** the application protocol isolates Tauri-specific details. If operating-system webviews become a blocker, the shell can change without rewriting Git/domain code.
- **Editor engine:** CodeMirror is wrapped as an editor surface. Document models, commands, diagnostics, and navigation must not leak CodeMirror classes across the application boundary.
- **Git backend:** system Git is the M1 reference adapter. libgit2 or specialized readers may later accelerate selected read paths, but writes retain one canonical semantics until parity is proven.
- **Language intelligence:** LSP is the first interoperability layer, not the complete product model. A bounded index may supplement it later.
- **Extensions:** internal capability boundaries mature before a public ABI. Public APIs are versioned and capability-scoped.
- **Persistence:** settings/workspace metadata use versioned schemas and atomic writes. A future SQLite store requires forward migrations, backups, and rollback evidence.

## State and event flow

The frontend requests a repository snapshot with a monotonically increasing request generation. The backend returns immutable data. After a stage/unstage/commit action, the application requests a fresh snapshot rather than manually pretending the mutation succeeded. File-system events are coalesced and treated as refresh hints, not truth.

## Failure policy

- A failed Git command returns its operation, exit status, and sanitized stderr.
- Unsupported repository states remain visible; they are not normalized into “clean.”
- Invalid UTF-8 is decoded lossily for display while raw paths remain an acknowledged M1 limitation.
- Crashes in optional services must not bring down the editor host.
- Any feature that can rewrite or discard work needs a preview and recovery story before release.

