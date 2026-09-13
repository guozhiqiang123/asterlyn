# Interface localization and color-theme plan

- **Status:** In progress; presentation, color theme, and shell localization foundations implemented
- **Date:** 2026-09-13
- **Initial locales:** English (`en-US`) and Simplified Chinese (`zh-CN`)
- **Theme choices:** Follow system, Dark, and Light

## Outcome

Asterlyn will gain a complete English and Simplified Chinese interface plus a light color scheme.
Both settings apply without reopening the application and remain consistent across project windows.
Theme changes preserve every document, selection, disclosure, scroll position, and focused control.
Language changes preserve the same product state while replacing visible application copy,
accessibility names, dates, numbers, plurals, status messages, dialogs, and CodeMirror phrases.

This is an interface-localization slice. The existing on-demand 143-entry CodeMirror syntax
language catalog remains independent. Language servers, formatters, semantic intelligence, custom
themes, third-party locale packs, and translated repository content are outside this slice.

## Current baseline

- Settings persists eight bounded preferences in `asterlyn.preferences.v1`, schema version 5. It
  already labels localization and Light/System themes as planned.
- The web interface and `editor-theme.ts` are fixed to dark. `:root` declares
  `color-scheme: dark`, and CodeMirror registers its extension with `{ dark: true }`.
- An initial static scan found 254 distinct color literals across 19 TypeScript/CSS files. The
  largest concentrations are the editor theme, Files/Editor, shared presentation/layout, Remote,
  root tokens, and shell styles. Light mode therefore requires semantic token migration, not an
  override appended after the current CSS.
- Visible English is distributed through shell templates, feature views, controllers, dynamic
  status/error text, `title`, `aria-label`, placeholders, confirm dialogs, and editor widgets.
  There are 465 render/DOM/status call sites in the initial search surface; an implementation-time
  inventory must classify their actual user-visible strings and exclude selectors, protocol
  values, Git identities, paths, and developer diagnostics.
- Date and relative-time formatters currently use the runtime default locale. Counts and plurals
  are assembled in English at several view boundaries.
- Rust errors expose stable top-level `kind` values but many distinct causes share free-form English
  `message` and `operation` strings. These messages are useful diagnostics but are not a complete
  localization contract.
- Application preferences are profile-local. Existing windows do not yet receive another window's
  preference changes.

## Architecture decision

The presentation environment is application state, separate from repository and editor state:

```text
versioned PreferenceStore
        |
        +--> requested locale/theme --------------------+
        |                                               |
        +--> cross-window preference notification       v
                                               PresentationEnvironment
                                               | locale catalog + Intl
                                               | effective color scheme
                                               | system-change listeners
                                               v
                +----------------------+----------------+------------------+
                |                      |                                   |
          feature renderers      document/root metadata          native appearance port
          and status copy        lang, dir, theme-color          Tauri application theme
                |
                +--> CodeMirror phrase and theme compartments
```

`PreferenceStore` owns persisted requested choices. `PresentationEnvironment` derives the effective
locale and theme and owns system listeners. Feature state never stores translated text as an
identity. Repository paths, refs, operation kinds, command IDs, DOM data attributes, and protocol
values remain locale-independent.

The Settings feature edits the preference store but does not own application-wide effective theme
or locale. The composition root wires environment changes to stable feature rendering boundaries.
This keeps the dependency direction from ADR-0007: renderers consume presentation context while
Git and Workspace domain crates remain unaware of locale, CSS, the DOM, or Tauri.

## Preference and migration contract

Schema version 6 adds:

```ts
type LocalePreference = "system" | "en-US" | "zh-CN";
type ThemePreference = "system" | "dark" | "light";
```

- A fresh profile defaults to `system` for both values.
- Versions 1 through 5 migrate to explicit `en-US` and `dark`, preserving the interface users had
  before this feature.
- Malformed or unknown values fail to the same migration-safe choices rather than selecting an
  arbitrary locale or theme.
- `system` locale resolves Simplified Chinese for `zh-CN`, `zh-SG`, or `zh-Hans`; all other initial
  system locales resolve to English. Traditional Chinese is not silently mapped to Simplified
  Chinese.
- The requested preference is persisted; changes in the operating-system theme do not rewrite it.
- Preference events carry a source/window ID and serialized preference version. `BroadcastChannel`
  supplies immediate profile-window updates, with the browser `storage` event as a fallback. A
  receiver ignores its own event, rereads the persisted value, and applies it without writing it
  again. The persisted value remains the source of truth, so simultaneous windows converge without
  trying to order independent per-window counters or creating notification loops.

## Localization contract

Use repository-owned typed TypeScript catalogs and the platform `Intl` implementations. Do not add
a runtime localization dependency for two bundled locales.

- Catalogs use stable semantic keys and plain text or typed formatter functions. The Chinese
  catalog must satisfy the English catalog's exact key and parameter shape at compile time.
- Locale modules are lazy chunks. Startup resolves the saved/system locale and loads it before the
  first shell render, so a Chinese profile does not flash an English workbench. Failure loads the
  English fallback and reports one bounded diagnostic.
- Translation entries never contain trusted HTML. Renderers own structure and escape translated
  text and interpolated repository/user values at the existing boundary.
- One locale formatter owns `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `Intl.NumberFormat`,
  `Intl.PluralRules`, and any future list formatting. No renderer constructs a formatter with
  `undefined` locale after migration.
- `document.documentElement.lang`, `dir`, and the accessible document description update with the
  effective locale. Both initial locales are left-to-right; RTL layout acceptance is deferred.
- CodeMirror receives a locale-specific `EditorState.phrases` compartment. Its Find/Replace panel,
  fold controls, and other built-in phrases are included in the coverage audit. Upstream syntax
  language names and source-code tokens may retain their technical names.
- Command IDs remain stable while command labels, categories, keywords, and descriptions come from
  the catalog. Chinese search may include reviewed English aliases for common Git commands without
  changing command identity.
- Paths, branch names, remote names, commit messages, file content, Git output, and recovery paths
  are user/repository data and are never translated.

### Error localization

Domain errors remain product-neutral. Rust adds stable reason codes only where the existing broad
`kind` cannot identify a user action. The frontend maps `kind + reason` to a localized summary and
may expose the original bounded `message`, Git diagnostic, path, status, or blocker count as
technical detail. Unknown future codes use a localized generic summary and retain the diagnostic;
they never disappear or masquerade as a known cause.

Expected workflows must not surface free-form English as their primary message. Arbitrary system,
Git, network, and repository-originated diagnostics are permitted in the detail view and are not
counted as translated product copy.

## Theme contract

Create one semantic palette registry for Dark and Light. Raw color literals are allowed only in
that registry and narrowly documented generated/media cases. Component styles consume roles such
as canvas, surface, raised surface, hover, selection, border, primary/secondary/muted text, focus,
accent, success, warning, danger, overlay, shadow, file states, and Diff additions/removals.

- Apply the effective theme through `html[data-theme="dark|light"]` and `color-scheme` so native
  form controls, scrollbars, selection, and browser surfaces agree with the palette.
- The system preference listens to `prefers-color-scheme` in browser mode and Tauri's window theme
  event in native mode. Explicit Light/Dark ignores later system changes.
- A small native appearance port calls Tauri's application `setTheme`: `null` for System and the
  explicit value otherwise. This keeps macOS chrome and application menus aligned while the pure
  controller remains testable without Tauri.
- Update `meta[name="theme-color"]` with the active canvas/shell color.
- Theme changes update attributes/tokens and CodeMirror compartments. They do not rerender the
  shell, recreate an editor state, reload a parser, or emit application content changes.
- TextEditor and DiffEditor receive theme compartments. Both visible and retained editor states
  reconfigure the view theme and syntax highlight style. Dark/light extension metadata must match
  CodeMirror's actual scheme.
- Semantic status and Diff meaning retains a label/icon/shape in addition to color. Both palettes
  meet the contrast gates below.
- The startup entry reads the minimal presentation preferences, resolves the initial locale and
  theme, and only then dynamically imports the main shell and its CSS. A system-aware CSS default
  still covers a fresh profile. This prevents both a Chinese profile from flashing English and a
  migrated dark profile from briefly rendering in a light system scheme.

## Delivery sequence and commits

Each item is independently reviewable and ends with focused tests plus the repository checks that
its surface affects.

Implementation progress:

- [x] Preference and presentation foundation
- [x] Semantic theme foundation
- [x] Localization foundation and shell
- [x] Feature localization by ownership boundary
- [ ] Coverage, accessibility, and platform acceptance

Browser, source, accessibility, performance, and frontend packaging gates are recorded in
[`../benchmarks/2026-09-13-localization-color-themes.md`](../benchmarks/2026-09-13-localization-color-themes.md).
The final item remains open until the current revision completes the native Linux, Windows, and
macOS packaging matrix; the present macOS host does not have `cargo` installed.

### 1. Preference and presentation foundation

- Add schema-v6 migration, `PreferenceStore`, system resolvers, cross-window synchronization, and a
  pure `PresentationEnvironment` controller.
- Define the typed locale-loader/catalog contract with a minimal boot failure path.
- Add the native appearance adapter and browser fallback without adding visible controls yet.
- Commit: `feat(preferences): add presentation environment choices`.

### 2. Semantic theme foundation

- Establish Dark/Light semantic tokens, first for root/shared/shell/settings and then for each
  feature-owned stylesheet. Replace hard-coded component colors rather than shadowing them.
- Add Light/Dark CodeMirror view and syntax styles behind compartments in TextEditor and DiffEditor.
- Activate System/Dark/Light settings and synchronize native chrome, theme-color metadata, and
  live system changes.
- Add a raw-color allowlist test, token completeness tests, two-palette contrast tests, and state/
  focus preservation tests.
- Prefer two commits: `refactor(theme): move interface colors to semantic tokens`, then
  `feat(theme): add light and system color schemes`.

### 3. Localization foundation and shell

- Add complete English and Chinese catalogs for bootstrap, shell, Settings, window controls,
  activity rail, common controls, dialogs, toasts, status, and command palette.
- Make the language setting functional, update document metadata, and prove no first-render English
  flash for a saved Chinese profile.
- Add locale-aware formatters, command aliases, and CodeMirror phrases.
- Commit: `feat(i18n): localize shell and settings`.

### 4. Feature localization by ownership boundary

Migrate complete vertical features so no screen is left half translated:

1. Files, Editor, Markdown, image/Diff surfaces, Search, and Replacement.
2. Changes/Commit and shared Git presentation.
3. History/Details/Branches.
4. Remote/Push, Git operations, conflict handling, and recovery.
5. Startup, authorization, watcher, file/editor, Git, and remote error summaries.

Each feature passes its catalog through its view/controller boundary instead of importing a mutable
global translator. Commits use `feat(i18n): localize <capability>` and retain current DOM/state
ownership.

### 5. Coverage, accessibility, and platform acceptance

- Add an AST/source audit for user-visible literals in HTML templates, `textContent`, labels,
  placeholders, titles, status/error/confirm calls, and CodeMirror UI. Maintain a reviewed allowlist
  for brand names, Git terminology, protocol constants, selectors, and developer-only diagnostics.
- Exercise English/Chinese × Dark/Light/System in Settings, every main workbench surface, dialogs,
  empty/loading/error states, Markdown, editable text, unified/split Diff, and recovery.
- Record macOS, Windows, and Linux native theme/chrome behavior and produce target-native packages.
- Commit documentation and evidence separately: `docs: accept localization and color themes`.

## Acceptance gates

### Correctness and state

- Fresh profiles follow system language/theme; v1-v5 profiles remain English/Dark after migration.
- Changing locale or theme in one window updates all open project windows once, survives restart,
  and cannot form a storage/BroadcastChannel loop.
- System theme changes update System windows and leave explicit Light/Dark windows unchanged.
- Theme changes preserve active focus, dirty bytes, undo history, parser state, tab and Diff scroll,
  file-tree disclosure/selection, Git selections, open dialogs, and layout.
- Locale changes preserve the same state. Any necessary rerender restores focus by stable control ID
  and never identifies an action by its old label.
- Late lazy-locale completions cannot replace a newer locale. Locale-load failure renders English
  and leaves Settings available for recovery.

### Language coverage and safety

- English and Chinese catalogs have exactly matching keys and formatter signatures.
- The visible-literal audit has no unreviewed result in production presentation code.
- Every expected status/error path has localized primary copy. Technical details preserve exact,
  bounded diagnostics and escape all untrusted values.
- Dates, relative times, numbers, counts, and plural forms use the selected locale. Repository/path
  ordering and identities do not change with locale.
- Chinese UI passes at 920 × 640 and 1,280 × 720, maximum application font size, and 200% zoom
  without clipped primary actions or horizontal workbench overflow.
- Keyboard navigation, focus return, accessible names, live regions, and native close protection
  pass in both languages.

### Visual quality

- Normal text meets WCAG AA 4.5:1; large text and essential UI boundaries meet 3:1; focus indication
  meets 3:1 against adjacent colors. Disabled controls are measured and documented separately.
- Added, modified, deleted, renamed, conflict, success, warning, and danger states remain
  understandable without color alone.
- Browser acceptance covers both palettes in shell, Settings, editor, Markdown, unified/split Diff,
  menus, dialogs, toasts, disabled/hover/focus/selection states, and empty/loading/error states.
- `forced-colors` does not hide focus, selection, checkboxes, or primary actions. Full custom
  high-contrast themes remain future work.

### Performance and packaging

- No localization framework dependency is introduced. Non-default locale catalogs remain lazy.
- The main JavaScript stays below the repository's 500 kB uncompressed gate. Record each locale
  chunk and CSS raw/gzip movement.
- On a named production fixture after warm-up, record 30 theme and 30 locale changes. Theme apply
  script p95 should fit one 16 ms frame; complete locale reconciliation p95 should remain below
  100 ms with no lost focus/state. A miss blocks acceptance or requires a documented measured
  decision.
- A System theme left idle for 60 seconds produces no timer, observer, storage, or render loop.
- Record five-run native process-tree memory and idle CPU on the standard platform fixture; do not
  claim improvement without a matched baseline.
- `npm run check`, `npm run build`, the complete script suite, Rust formatting/tests/Clippy, native
  theme smoke, and host-native packaging pass before acceptance.

## Risks and containment

- **Broad string migration:** move one feature boundary at a time and fail the visible-literal audit
  only for migrated directories until the final cutover.
- **Token gaps produce unreadable Light mode:** the raw-color gate and computed contrast checks land
  before the Light control becomes writable.
- **Large composition-root rerender:** locale change is rare but still routes through feature-owned
  render entry points. Theme change never uses that path. Record timing before acceptance.
- **Native/system disagreement:** use one effective-theme reducer and adapter events; tests cover the
  requested × system-state matrix.
- **Free-form backend English:** add machine reason codes incrementally and keep raw diagnostics in
  an expandable detail boundary. Do not move localized prose into Rust domain crates.
- **Main-bundle growth:** dynamically import locale catalogs and keep formatters on native `Intl`.
  Measure after each vertical migration rather than at the final package only.

## Completion boundary

The slice is complete when English and Simplified Chinese users can operate all currently shipped
workflows in System, Dark, or Light appearance, including expected failures and accessibility text,
with the acceptance evidence above. A language or theme selector backed by a partially migrated
workbench does not satisfy completion.
