# E2.2a on-demand syntax highlighting evidence

## Scope and comparison

This evidence accepts the parser-backed syntax-highlighting slice pulled forward from the broad E3 backlog. It adds automatic filename-based CodeMirror language selection and an Asterlyn dark token theme, but no language server, semantic token, diagnostics, completion, refactoring, formatter, or project-model claim. Packaging and remote publication remain deferred to the larger Stage 3 checkpoint.

The local machine and repository match the [`E2.1 evidence`](2026-09-09-e2-1-navigation-search.md): Deepin 23.1 on Linux 6.12, AMD Ryzen 5 3600X, 19 GiB RAM, Rust 1.98.1, Node.js 24.19.0, Git 2.47.2, and the current Asterlyn checkout. E2.1 is the comparison baseline for frontend assets.

## Functional and safety evidence

- The CodeMirror language-data catalog exposes 143 descriptions. Automatic matching was checked for TypeScript, TSX, Kotlin, Rust, Markdown, Groovy/Gradle, TOML, Dockerfile, uppercase extensions, Windows-style paths, and unknown-file plain-text fallback.
- The language catalog and selected parser are dynamically imported only after a text editor is mounted. One generation gate prevents a parser that resolves for an old tab from reconfiguring its replacement. Catalog or parser failure leaves the file readable and editable as plain text.
- Five focused tests cover catalog matching, a real TypeScript parser load, stale asynchronous completion, failure fallback, and normal-text color contrast. The complete frontend suite passes 88 tests.
- The unchanged native boundary remains green with 13 workspace, 28 Git, and seven desktop tests. Rust formatting, strict all-target workspace Clippy, TypeScript checking, and the production frontend build pass.

The production-browser journey opened `src/app.ts`, observed the adapter's `TypeScript` / `ready` state, and verified visibly distinct computed colors for keywords, a class name, punctuation, and a comment. It then edited and saved the file, switched to `README.md`, observed the `Markdown` / `ready` state, and verified the bold heading style. Both tabs reported `Saved`, and the browser console contained no warning or error. This used the deterministic local bridge; it did not write the repository checkout.

## Accessibility evidence

Every custom token foreground is tested against the `#1e1f22` editor background at the WCAG normal-text threshold of 4.5:1. The lowest ratio is the `#8c919b` comment color at 5.21:1. The production browser confirmed that exact comment color and the intended TypeScript and Markdown styles. Syntax color remains supplemental presentation over editable source text; it does not replace text, keyboard behavior, or selection semantics.

## Build and load movement

| Output | E2.1 | E2.2a | Movement |
| --- | ---: | ---: | ---: |
| CSS | 54.70 kB | 54.70 kB | no material change |
| CSS gzip | 10.64 kB | 10.64 kB | no material change |
| Main JavaScript | 533.11 kB | 557.48 kB | +24.37 kB / +4.57% |
| Main JavaScript gzip | 156.05 kB | 164.41 kB | +8.36 kB / +5.36% |
| Main JavaScript source map | 2,114.11 kB | 2,148.78 kB | +34.67 kB / +1.64% |

The main-bundle conclusion is **regressed** and the existing greater-than-500-kB warning remains open. The first implementation also placed the language catalog in the main chunk and produced a 576.44 kB main script; changing the catalog to a dynamic import reduced the final result by 18.96 kB. A second attempt to defer the shared syntax-theme engine increased the main script to 569.22 kB and emitted an ineffective-import warning, so it was rejected rather than recorded as an optimization.

The complete catalog emits 121 JavaScript files totaling 1,797,976 bytes before compression; a command-line gzip stream totals 637,431 bytes. This packaged frontend footprint is **regressed**, though it is not startup traffic. A clean production-preview welcome page requested only the 557,488-byte main script and 54,709-byte stylesheet. Opening TypeScript then requested five lazy scripts: the 19,537-byte language catalog plus 84,668, 158, 26,494, and 8,474-byte parser/runtime dependencies. Together they were 139,331 decoded bytes and 51,857 transferred bytes in this local HTTP observation. Individual resource durations ranged from 4.0 to 13.0 milliseconds on a warm local machine; they are not a cold-disk or remote-network latency claim.

## Focused browser heap observation

The same production-preview tab reported 7,015,904 bytes of used JavaScript heap on the welcome surface and 8,906,316 bytes after opening and settling the TypeScript editor, an increase of 1,890,412 bytes or 1.80 MiB. Total heap capacity increased from 10,313,728 to 13,242,368 bytes. This one-run browser metric had no forced garbage collection and includes editor-instance creation, language metadata, parser state, DOM, and test instrumentation; it is not comparable with Linux process-tree PSS and cannot isolate syntax highlighting.

The focused memory conclusion is **inconclusive**. It confirms that parser resources are absent from the clean-page request set and gives an absolute loaded-state observation, but it neither proves a memory improvement nor replaces the pending normalized five-run, 60-second native series at the Stage 3 checkpoint.

## Decision and limits

E2.2a is locally accepted because editing readability and automatic language coverage are **improved**, parser races fail closed, and parser work is absent until a text file opens. Main and packaged frontend sizes are **regressed**; focused heap impact is **inconclusive**. The broad catalog is retained for this slice because its runtime parsers are lazy, but its 120 auxiliary chunks must be reconsidered against curated or separately installed language packs before the Stage 3 package checkpoint.

Known limits are filename/extension matching without shebang or content detection, no visible manual language override, plain-text fallback without a user-facing parser-error notice, uneven precision between native Lezer parsers and legacy stream modes, no configured language-aware Markdown fenced-code selection, the existing two-MiB UTF-8 file boundary, and no LSP or semantic intelligence. E2.2b read-only search refinement remains next; Stage 4 retains language services and semantic features.
