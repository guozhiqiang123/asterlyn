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
7. Branch mutations accept literal local refs or validated new names only. The UI waits for complete working-tree discovery, and the Git core independently rejects any staged, unstaged, conflicted, or untracked blocker immediately before invoking `git switch`.
8. Remote mutations accept configured remote names rather than URLs. U5 supports only the canonical branch mapping from `refs/heads/*` into `refs/remotes/<remote>/*`, disables implicit tag/submodule/signing/force expansion, and returns typed failure categories instead of child-process output.

## Runtime model

M1 uses the Tauri webview process plus a Rust host. Git operations run off the UI thread. Later language servers, debuggers, terminals, extension hosts, remote agents, and AI providers run behind supervisors with explicit lifecycle and resource budgets.

This avoids both extremes: a monolith that loads every subsystem at startup and microservices introduced before a process boundary has operational value.

## Evolution seams

- **Desktop shell:** the application protocol isolates Tauri-specific details. If operating-system webviews become a blocker, the shell can change without rewriting Git/domain code.
- **Workbench shell:** the activity rail, left tool dock, persistent editor host, and bottom tool dock are independent regions. Files and Changes share the left dock while Branches occupies the bottom dock, so tool visibility does not replace the active document. Layout preferences are versioned and contain no repository truth; they include the selected-commit summary height, while tree/flat changed-file projection is a separate presentation preference over one path selection.
- **Desktop chooser:** repository selection is a presentation/platform concern behind the frontend bridge. The Tauri runtime may present a folder-only operating-system dialog and returns only the selected path; cancellation produces no state change. Browser demo mode reports that native selection is unsupported and may expose a clearly labeled manual-path simulation. This capability does not belong to the Git domain and does not grant general filesystem access.
- **Editor engine:** CodeMirror is wrapped as an editor surface. Document models, commands, diagnostics, and navigation must not leak CodeMirror classes across the application boundary.
- **Diff presentation:** Git returns one bounded canonical patch. Unified view displays it directly; split view derives aligned before/after documents in the presentation layer and synchronizes both scroll axes by source offset. Whitespace visibility is a CodeMirror decoration over the same patch, never a different Git query, so display preferences cannot alter review truth.
- **History presentation:** Git returns topologically ordered commits with every parent object ID. A pure frontend projection owns transient graph lanes, colors, fan-out, convergence, and accessible row summaries; it never derives ancestry from ref names, decorations, dates, or visual adjacency.
- **Git backend:** system Git is the M1 reference adapter. libgit2 or specialized readers may later accelerate selected read paths, but writes retain one canonical semantics until parity is proven.
- **Language intelligence:** LSP is the first interoperability layer, not the complete product model. A bounded index may supplement it later.
- **Extensions:** internal capability boundaries mature before a public ABI. Public APIs are versioned and capability-scoped.
- **Persistence:** settings/workspace metadata use versioned schemas and atomic writes. A future SQLite store requires forward migrations, backups, and rollback evidence.

## State and event flow

The frontend requests a repository snapshot with a monotonically increasing request generation. The backend returns immutable data. Repository refresh is deliberately two-phase: tracked/index state, the bounded all-refs history, and ref state arrive first; an independently cancellable untracked-path scan completes the snapshot afterward. The UI identifies pending untracked discovery instead of briefly claiming the repository is clean, merges a supplement only into its matching generation, and cancels obsolete Git child processes when the repository changes or a mutation begins.

After a stage/unstage/commit action, the application requests fresh tracked state and starts a new untracked scan rather than manually pretending the mutation succeeded. File-system events are coalesced and treated as refresh hints, not truth. The compatibility `snapshot` operation in the pure Git crate still composes both phases for callers that require an atomic-looking complete result, while interactive callers use the phased API.

Remote work follows the same reconciliation rule but uses a repository-scoped cancellable operation. Fetch updates only the selected remote's canonical branch-tracking namespace and does not prune in the initial slice. Pull performs that bounded fetch, then revalidates `HEAD`, upstream configuration, repository-operation state, and complete cleanliness before a fast-forward-only merge to the fetched commit ID. Push sends the current full local ref to the exact configured upstream ref, or publishes the same-named branch to an explicitly selected remote; it cannot force, mirror, follow tags, sign, or recurse into submodules. Cancellation terminates the matching Git process tree and never attempts rollback. A cancelled push has an explicitly unknown remote outcome until a later fetch reconciles it.

Commit inspection is a separate, lazy read path rather than part of the repository snapshot. A selected commit first loads its NUL-delimited changed-file summary and then loads only the selected file patch. The frontend may project those files as a directory tree or a path-sorted flat list, but both modes preserve one repository-relative path selection and dispatch the same typed Diff document. Commit decorations are matched against the current ref snapshot for semantic presentation; unknown decoration types remain visibly neutral rather than being inferred from their names. Ordinary and merge commits are compared with their first parent, matching the mainline review model used by common Git clients; root commits are compared with the empty tree. The frontend rejects responses whose commit or file selection is no longer current, while the Rust boundary accepts only full hexadecimal object IDs and repository-relative paths.

The snapshot's default history is the deduplicated set reachable from the exact object IDs observed for local branches, remote-tracking branches, tags, and a detached `HEAD`. Passing observed IDs rather than open-ended revision expressions keeps the graph aligned with the snapshot's ref set. Git orders the bounded result topologically, and the frontend projects only the reported parent IDs into lanes. Non-commit refs do not create commits or fabricated edges.

Selecting one displayed ref uses a separate lazy read path. A compact Branch shortcut is logical at the workspace level: it expands the same complete local, remote-tracking, or tag ref into every currently included Git root where that ref exists, while the advanced selector retains exact root-qualified multi-ref control. The Rust boundary accepts only complete literal refs paired with their owning root, verifies each one, resolves it to a commit object, and queries the resulting object IDs with an explicit path separator and the same topological ordering. Activating the selected ref again restores the snapshot's all-refs history. The frontend rejects responses whose request generation, repository root, or selected ref no longer matches. Collapsing a ref group is presentation state only and cannot alter the selected ref, history data, repository truth, or active editor document.

Workbench state is orthogonal to repository state. A typed editor-document descriptor selects welcome, working-diff, or commit-diff content independently of left and bottom tool visibility. Views dispatch identifiers into the application state flow and never manipulate another zone's DOM or editor instance. Pointer and keyboard splitter actions update only validated layout dimensions; they do not trigger Git work. The phase-one Files view obtains a bounded, read-only repository path list and does not imply Stage 3 file editing, watching, or persistence behavior.

## Failure policy

- A failed Git command returns its operation, exit status, and sanitized stderr.
- A failed remote command returns only a typed authentication, network, rejection, or unknown category; bounded child output is discarded and remote URLs never enter application state.
- Remote credentials remain inside configured non-interactive Git credential helpers or the SSH agent. Asterlyn disables terminal/askpass interaction and inherited Git tracing for these commands and never stores a username, password, token, or authorization header.
- Unsupported repository states remain visible; they are not normalized into “clean.”
- Invalid UTF-8 is decoded lossily for display while raw paths remain an acknowledged M1 limitation.
- Crashes in optional services must not bring down the editor host.
- Any feature that can rewrite or discard work needs a preview and recovery story before release.
