# Search controls and lazy History paths — 2026-09-21

## Scope

This acceptance slice closes five interaction gaps without introducing a second repository index:

- Branch filtering keeps one focus ring instead of drawing a second border around the native input.
- Branch, author, date, and path History filters expose an adjacent clear action only while active.
- `Paths → Select in Tree` projects and mounts one collapsed directory level at a time from the existing bounded project catalog.
- Quick Open owns one `Filter Git-ignored files` checkbox, visible in Files, Recent, Text, and Commands and enabled by default.
- Workspace Text and every CodeMirror editor surface share `New line`, `Match case`, `Whole words`, and `Regex` controls. Editable buffers retain replace actions; historical Diff panes do not.

Ignored files can be revealed for navigation and search, but are read-only. The native replacement boundary rejects ignored-file and multiline replacement independently of the presentation state.

## Functional and interaction evidence

Browser acceptance used the deterministic local demo at `127.0.0.1:1420`:

- Focusing Branch search produced no input border, outline, or shadow; the owning `.branch-filter` retained the single themed focus border.
- Selecting `main` added an accessible `Clear: refs/heads/main` action and clearing it restored `All refs`.
- Opening `Select in Tree` took 303 ms including dialog presentation, mounted eight root rows for the demo catalog, and expanded none of them.
- Quick Open showed the checked ignored-file filter in Files and retained it after switching to Text.
- Text mode rendered the four embedded search buttons in the requested order. The ordinary editor's `Ctrl+F` panel rendered the same four controls, and each moved independently from `aria-pressed=false` to `true`.
- The browser console contained no warnings or errors after the interaction sequence.

Contract tests also require the shared search extension in the ordinary editor, editable working Diff, read-only historical Diff, and three-pane conflict editor.

## Performance and memory evidence

A local Node process projected a synthetic 100,000-file catalog with 1,000 immediate children under `src` over ten iterations:

| Projection | Mounted/result rows | Median | Maximum |
| --- | ---: | ---: | ---: |
| Repository roots | 1 | 33.96 ms | 53.32 ms |
| Expanded `src` directory | 1,000 | 71.37 ms | 81.81 ms |

The expanded-level result retained an additional 106,528 bytes after garbage collection relative to the retained root result. The root heap delta was inside garbage-collection noise and is intentionally not reported as a positive saving. The important bound is architectural: dialog open performs one catalog pass, retains only immediate-child candidates, and mounts no descendant DOM until the user expands a directory. No watcher, background scan, or persistent file index was added.

These figures are single-process local evidence, not cross-machine latency guarantees.

## Validation

- `npm run check` — passed.
- `npm run test:scripts` — 561 passed, 0 failed.
- `npm run build` — passed; main application chunk 334.42 kB (71.75 kB gzip), editor-theme chunk 34.37 kB (10.18 kB gzip).
- `cargo test --workspace` — passed: application 56 passed/2 OS-watcher tests ignored, desktop main 1, desktop library 3, Git 105, terminal 4, workspace 53, and all doctests.
- `cargo fmt --all -- --check` and `git diff --check` — passed before the feature commit.

## Accessibility

- Search options are real buttons with localized accessible names and `aria-pressed` state.
- The ignored-file checkbox has a persistent label and remains reachable in all navigation modes.
- Active History filters expose separate named clear buttons rather than relying on an unlabeled glyph.
- Enter, Shift+Enter, and Escape retain their search navigation behavior; read-only editors omit replacement controls.

## Known limitations

- Ignored-file results are deliberately read-only and cannot enter workspace replacement.
- New-line queries are search-only; cross-line replacement remains unsupported.
- Path expansion still scans the bounded catalog for the requested level. A persistent index remains deferred until measurements justify its lifecycle and invalidation cost.
- This slice received browser interaction acceptance on Linux. It did not add a new installed-package pass for macOS or Windows.

## Follow-up: unified search fields and quick-open query options (2026-09-21)

Three follow-up corrections were requested from installed-package use:

- The command-surface query field now matches the Git History search control: a neutral
  `--border-strong` border that only lights up with the focus ring while the field owns focus, and
  contiguous in-field segments separated by 1px dividers instead of gap-separated filled chips. The
  trailing `Enter to search` keystroke chip is removed; Enter keeps its search/open behavior and the
  footer keystroke legend is unchanged. `scripts/style-ownership.test.mjs` now locks both fields to
  the same border, focus-ring, and flat-segment contract.
- Files and Recent present the same four in-field controls as Text. `Match case`, `Whole words`, and
  `Regex` now select the quick-open path matcher: the exact workspace path for case-sensitive
  matching, Unicode word boundaries around a contiguous occurrence for whole words, and a Unicode
  expression over the workspace path for Regex. An invalid expression matches nothing instead of
  throwing. With all three off, the existing case-insensitive fuzzy ranking is byte-for-byte
  unchanged, which the existing quick-open tests continue to assert.
- `New line` is now the editing action it was documented to be: it inserts one line break at the
  caret in the query field, which is a textarea that grows with its own text up to 124 pixels. Editing
  the query dispatches the surface's own `input` path, so request invalidation, result rendering, and
  the caret stay consistent. A workspace text request now derives `new_line` from the query itself,
  so a multi-line query is searched across lines and replacement is presented as unavailable, while a
  line-local query can never be sent with the mode enabled. `docs/architecture/decisions/0005` records
  the amendment.

Measured in the production stylesheet order (every feature stylesheet before `main-*.css`) at a
1000-pixel viewport: the reference History field and all four command-surface tabs render one
bordered field with flat `↵ Cc W .*` segments, the Files and Recent tabs filter paths with the
selected options, a two-line Text query grows the field to two rows, and the Commands tab renders no
query options. A headless production-bundle run then drove the surface through its own shortcuts:
`Ctrl+P` opened Files, `Match case` with the query `APP` reduced two fuzzy matches to zero, `Whole
words` reduced the query `app` to the single exact basename, `Regex` with `^src/.*\.ts$` selected
three source files, the line-break control turned `alpha` into `"alpha\n"` with the caret after the
break and grew the field from 31 to 50 pixels, and a searched `Asterlyn\n` query reported one
cross-line match with replacement unavailable while the line-local `Asterlyn` query reported four
matches with replacement available. The browser demo's own search validation was aligned with the
native boundary in the same change: it now rejects direct line breaks only while the multi-line
option is off, which is what allowed the cross-line evidence above to run in the demo at all.

`npm run check`, the complete 582-test script suite, and the production build passed; `src/app.ts`
remained at 8,772 lines against its 8,781-line reviewed ceiling by moving the query-input behavior
into a feature-owned `command-surface-input.ts` module. These figures are single-viewport render and
demo-interaction evidence, not native-package interaction acceptance.
