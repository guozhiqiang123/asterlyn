# Editor core interaction plan

## Outcome

Stage 3 makes Asterlyn dependable as a text/code editor with language intelligence disabled. It proceeds through independently reversible slices so file safety and buffer lifetime are proven before search, services, or extensibility depend on them.

## E1 — Safe multi-tab text editing

E1 replaces the project-file placeholder with a complete explicit-save loop:

- Open tracked or non-ignored untracked files from the bounded project tree using an exact Git-root-qualified identity.
- Keep up to 20 heterogeneous tabs: persistent editable text tabs plus one replaceable read-only Diff preview.
- Deduplicate repeated file opens, switch tabs without losing exact content, close clean tabs, and retain dirty tabs until Save succeeds or the user cancels.
- Edit UTF-8 text up to two MiB in the CodeMirror adapter, preserving BOM, LF/CRLF/mixed separators, bare CR, and final-newline state.
- Save through a freshly authorized, optimistic, same-directory atomic replacement. A conflict preserves the local buffer and never exposes force overwrite.
- Preserve text tabs across repository refresh. Save All or Cancel protects repository and window transitions.

E1 intentionally adds no syntax mode, watcher, autosave, draft persistence, force/discard, file creation, workspace search, split editor, terminal, or language service.

### E1 acceptance

- Rust tests cover authorized tracked/untracked identity, path escape and link rejection, text/size/encoding policy, exact byte round trips, permission preservation, conflict safety, idempotent retry, and concurrent-save serialization.
- TypeScript tests cover tab deduplication, Diff preview replacement, stale load/save rejection, edits during save, exact mixed-line-ending composition, dirty transition guards, and the 20-tab bound.
- Browser interaction covers opening and switching at least two files, editing, dirty markers, `Ctrl/Cmd+S`, clean close, Diff preview coexistence, and refresh retention using the deterministic bridge.
- Native Linux interaction covers one real read, save, external conflict, and retry-safe result against a disposable repository. Existing working and commit Diff journeys remain usable.
- Acceptance records absolute build/resource results, limitations, and next action. Packaging and remote publication wait for the agreed larger Stage 3 checkpoint.

### E1 local acceptance — 2026-09-09

E1 is locally accepted as the first Stage 3 slice. Compared with the previous read-only project-file placeholder and single volatile Diff document, the center workbench now keeps up to 20 persistent text tabs alongside one replaceable Diff preview, preserves exact text while switching and refreshing, and protects dirty buffers with explicit Save-or-Cancel transitions.

The absolute local evidence is six `asterlyn-workspace` tests, 28 `asterlyn-git` tests, four desktop-library tests, and 68 frontend script tests. TypeScript checking and the production frontend build pass. The deterministic browser journey opened and switched between two files, edited and saved with `Ctrl/Cmd+S`, closed a clean tab, kept text tabs beside a Diff preview, retained an unsaved buffer across repository refresh, and kept a dirty tab open when close was cancelled. A native Linux debug executable remained alive for the six-second smoke interval against a disposable repository. The desktop-library boundary additionally performed a real tracked-file read/save, preserved an external edit on revision conflict, rejected an ignored file, and freshly revoked save authorization after a formerly tracked file became ignored.

The production build emitted 50.40 kB CSS (10.00 kB gzip) and 509.34 kB JavaScript (150.19 kB gzip), with a 2,048.12 kB JavaScript source map. No comparable pre-E1 asset measurement is retained, and the agreed phase checkpoint defers packaging and the normalized 60-second resource series. The interaction and correctness conclusion is **improved**; bundle-size movement, startup, and memory impact are **inconclusive**. Vite's greater-than-500-kB main-chunk warning remains visible rather than being treated as an accepted performance result.

Known limits are UTF-8 text up to two MiB, 20 text tabs, explicit save only, and no syntax modes, file watching, recovery, autosave, safe discard, file creation/rename/delete, or durable undo history for an unmounted editor adapter. Atomic replacement preserves ordinary file permissions but not ACLs or extended attributes. The final validation-to-replacement interval retains a documented local path-substitution race, and non-Unix hard-link parity is not yet accepted. Windows/macOS installed interaction also remains deferred. The next product action is E2's bounded, keyboard-first navigation and search surface.

## Later Stage 3 slices

### E2 — Navigation and search

Add file/text search and replace, recent files, go-to-file, command palette, symbol-free navigation, and keyboard-first result traversal over bounded workspace services.

E2 is split so read-only discovery cannot quietly create a bulk-write surface:

- **E2.1 — Command surface and bounded search:** add `Ctrl/Cmd+P` files, `Ctrl/Cmd+E` repository-scoped recents, `Ctrl/Cmd+Shift+F` cancellable workspace text search, `Ctrl/Cmd+Shift+P` commands, result-to-editor navigation, and visible active-buffer find/replace through CodeMirror.
- **E2.2 — Search refinement:** add measured include/exclude controls, regular expressions, context expansion, and any index only after the scan implementation supplies a comparison baseline.
- **E2.3 — Recoverable workspace replacement:** add multi-file preview and rollback/recovery only after the product can prove that interruption, conflict, partial failure, and user cancellation cannot silently lose work.

E2.1 follows [`ADR-0005`](../architecture/decisions/0005-bounded-navigation-search.md). Its acceptance requires pure ranking/recent/navigation tests; bounded search tests covering Unicode, case, CRLF/bare-CR coordinates, unsupported-file accounting, every limit, and cancellation; desktop tests proving fresh Git authorization and stale repository denial; browser keyboard journeys for all four modes and result navigation; accessibility names, selection state, and focus restoration; and recorded latency, build-size, and resource evidence. Packaging and remote publication remain at the larger Stage 3 checkpoint.

### E3 — Editor groups and preferences

Add splits, tab movement, settings/keymaps, language-neutral indentation, encoding/EOL controls, file watching, external-change comparison, and a measured large-file mode.

### E4 — Recovery and task surfaces

Add atomic draft recovery, restart/session restoration, safe discard, autosave policy, terminal/task surfaces, cancellation, trust prompts, and data-loss fault testing required by the Stage 3 exit gate.
