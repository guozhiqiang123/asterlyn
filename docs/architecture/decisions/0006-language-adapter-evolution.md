# ADR-0006: Language adapter evolution

## Status

Accepted for incremental implementation. Stage 3 implements syntax-only capabilities; semantic intelligence remains deferred to Stage 4.

## Context

CodeMirror's language catalog mixes full incremental Lezer parsers with legacy stream tokenizers. A full parser can publish structural nodes used for highlighting, folding, indentation, brackets, and later editor projections. A stream tokenizer primarily classifies text and does not provide equivalent structure. In the current catalog Java and XML use Lezer parsers, while Kotlin and Groovy/Gradle use legacy stream modes. Treating every highlighted language as structurally equivalent therefore makes editor behavior inconsistent.

Asterlyn is a 3–5 year cross-platform editor with an explicit low-resource goal. Writing and indefinitely maintaining complete Kotlin and Groovy grammars from scratch would duplicate specialized ecosystem work, tie product progress to grammar completeness, and still not provide semantic completion, navigation, or diagnostics. Conversely, exposing CodeMirror, Lezer, Tree-sitter, or an LSP protocol as the product model would make later engine changes unnecessarily invasive.

## Decision

Asterlyn owns a capability-oriented language adapter. It does not make a particular parser technology or third-party grammar part of editor-session, workspace, or domain state. A language pack may independently declare support for syntax highlighting, folding, bracket matching, indentation, structural selection, and outline projection. Missing capabilities degrade explicitly and cannot be inferred from the presence of syntax colors.

Implementation proceeds in three boundaries:

1. **Stage 3 syntax baseline.** Continue loading CodeMirror language descriptions on demand. Use existing Lezer node properties when available. Kotlin and Groovy/Gradle receive a bounded token-aware brace-folding fallback over the already loaded stream tokenizer; XML receives a first-line element fold service. The fallback scans at most one MiB of the active immutable editor state, caches ranges by editor state and syntax tree, ignores tokenized strings/comments, and fails closed for incomplete, oversized, or unmatched structures. This phase adds folding only. It does not add completion, navigation, diagnostics, symbols, formatting, refactoring, a language server, or a repository index.
2. **Optional structural language packs.** When Stage 4 requires richer structure, evaluate maintained upstream Tree-sitter grammars rather than starting new Kotlin or Groovy grammars. Tree-sitter is not a drop-in Lezer replacement, so an adapter maps its incremental tree into editor capabilities. Parser modules load only for requested languages, run outside the UI thread in one supervised worker, retain trees only for active documents, have large-file and inactivity eviction limits, and fall back to the Stage 3 adapter after load or parse failure. Adoption requires representative Android, Gradle, Kotlin script, Groovy, and Jenkinsfile corpora; license and maintenance review; startup, edit-latency, memory, bundle-size, and malformed-input evidence; and a pinned, reproducible supply-chain boundary.
3. **Semantic intelligence.** Completion, go-to-definition, references, diagnostics, rename/refactoring, formatter orchestration, project models, and semantic symbols enter through separate Stage 4 services. LSP is the first interoperability adapter but not the language product model. Syntax-tree availability must never be presented as semantic correctness, and semantic service failure cannot remove basic editing, highlighting, or folding.

Upstream grammars are consumed at pinned versions. If a grammar misses important real projects, Asterlyn first contributes tests and fixes upstream. A maintained fork is allowed only when upstream responsiveness, release cadence, compatibility, licensing, or critical dialect coverage fails an acceptance gate. A greenfield grammar requires evidence that no suitable upstream base exists and a separately approved ownership and corpus-maintenance budget.

## Resource and lifecycle invariants

1. Welcome/startup does not load a language catalog, parser, worker, or language server.
2. Opening one language cannot load every language parser.
3. Stage 3 fallback folding performs no filesystem access, process launch, repository traversal, or background polling.
4. One active document state owns at most one cached fallback fold map; immutable editor-state replacement naturally invalidates it.
5. Optional Tree-sitter integration uses one bounded worker rather than one worker per tab, and inactive document trees are evictable.
6. Parser and semantic requests carry document identity and version; late results cannot update a newer buffer or another tab.
7. Files above an adapter's measured limit retain plain text editing and saving even when structural or semantic capabilities are disabled.
8. Native indexing or project analysis may reuse grammar sources later, but keystroke interaction cannot depend on synchronous Tauri IPC.

## Consequences

The immediate editor gains consistent basic folding without waiting for a new parser platform. Kotlin and Groovy folding remains intentionally structural rather than grammar-complete, and the one-MiB fallback limit is visible technical debt to reassess with representative files. The adapter seam lets Asterlyn adopt Tree-sitter, Lezer, or another parser per language without rewriting editor-session state.

This decision deliberately postpones expensive language intelligence. Stage 3 remains useful with every semantic service disabled; Stage 4 must establish separate supervision, cancellation, stale-result, trust, packaging, and resource evidence before exposing semantic controls.

## References

- [CodeMirror language and folding reference](https://codemirror.net/docs/ref/#language)
- [Lezer system guide](https://lezer.codemirror.net/docs/guide/)
- [Tree-sitter Kotlin grammar](https://github.com/fwcd/tree-sitter-kotlin)
- [Tree-sitter Groovy grammar](https://github.com/murtaza64/tree-sitter-groovy)
