import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { foldGutter, foldKeymap, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { asterlynSearch } from "./editor-search";
import { Compartment, EditorState, type Text, type TransactionSpec } from "@codemirror/state";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
} from "@codemirror/view";
import { withEditorFolding } from "./editor-folding";
import { EditorLanguageLoader, type EditorLanguageStatus } from "./editor-language";
import { asterlynEditorTheme, asterlynSyntaxHighlighting } from "./editor-theme";
import type { EffectiveTheme } from "./presentation/presentation-environment";
import { linkVerticalScrollProportionally } from "./presentation/linked-scroll";
import type { AppPreferences } from "./preferences";
import {
  computeTextChange,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
} from "./features/files-editor/text-content";
import {
  applyLineSeparatorChanges,
  countLineSeparators,
  type LineSeparatorChange,
  type LineSeparatorCounts,
} from "./features/files-editor/text-line-separators.ts";
import {
  lineNumberGutter,
  type GitBlameRuntime,
  type GitBlameSource,
} from "./features/files-editor/editor-gutter.ts";
import {
  NOOP_CONTEXT_MENU_PORT,
  type ContextMenuPort,
} from "./shared/context-menu/context-menu-model.ts";
import { GitBlamePaneController, sourceBlameTarget } from "./features/files-editor/git-blame-pane-controller.ts";
import type { EditorRuntimeTabRemap } from "./editor-path-mutation.ts";
import { remapEditorCacheEntries } from "./features/files-editor/editor-cache-remap.ts";
import {
  createEditorChangeIndicators,
  editorChangeIndicatorCopy,
  type EditorChangeIndicators,
} from "./editor-change-indicators.ts";
import type { EditorCopy } from "./localization/catalog.ts";
import {
  applyEditorPreferences,
  codeMirrorFocusOwnership,
} from "./features/files-editor/editor-runtime-shared.ts";
import type { EditorLanguageServiceHandle, EditorLanguageServicePort, EditorLanguageServicePortFactory, EditorLanguageServiceDiagnostic, EditorLanguageServicePosition, EditorLanguageServiceCompletionItem, EditorLanguageServiceLocation } from "./protocol/editor-language-service.ts";

interface CachedTextEditor {
  id: string;
  loadEpoch: number;
  path: string;
  exactContent: ExactTextContent;
  separatorCounts: LineSeparatorCounts;
  serializedContent: string | null;
  state: EditorState;
  baselineText: Text;
  view: EditorView | null;
  scrollLeft: number;
  scrollTop: number;
  readOnly: Compartment;
  editable: Compartment;
  language: Compartment;
  indent: Compartment;
  tabSize: Compartment;
  theme: Compartment;
  phrases: Compartment;
  blame: Compartment;
  changeIndicators: EditorChangeIndicators;
  languageLoader: EditorLanguageLoader;
  languageActivation: number;
  languageName: string;
  languageStatus: EditorLanguageStatus | "loading";
  onChange: (content: string | null, dirty: boolean) => void;
  changePending: boolean;
  changeFrame: number | null;
  blameController: GitBlamePaneController;
  languageServices: Compartment;
  languageServicePort: EditorLanguageServicePort | null;
  languageServiceHandle: EditorLanguageServiceHandle;
  languageServiceVersion: number;
  disposeLanguageDiagnostics: (() => void) | null;
  languageServiceUpdateTimer: number | null;
  languageServicePendingText: string | null;
}

/**
 * Owns one bounded CodeMirror state per open text tab while mounting only the
 * active view. Ordinary text-tab switches reuse that view and replace only its
 * state, preserving parsing, history, selection, and scroll state without
 * retaining a hidden DOM editor for every file.
 */
export class TextEditor {
  private readonly entries = new Map<string, CachedTextEditor>();
  private activeId: string | null = null;
  private readOnlyValue = false;
  private themeValue: EffectiveTheme = "dark";
  private phrasesValue: Readonly<Record<string, string>> = {};
  private synchronizing = false;
  private scrollRestorationGeneration = 0;
  private languageServiceFactory: EditorLanguageServicePortFactory | null = null;

  constructor(
    private readonly blameRuntime: GitBlameRuntime,
    private blameCopy: EditorCopy,
    private readonly contextMenu: ContextMenuPort = NOOP_CONTEXT_MENU_PORT,
  ) {}

  mount(
    parent: HTMLElement,
    tabId: string,
    loadEpoch: number,
    content: string,
    baselineContent: string,
    path: string,
    preferences: AppPreferences,
    blameSource: GitBlameSource | null,
    blameUnavailableReason: string | null,
    onChange: (content: string | null, dirty: boolean) => void,
  ): void {
    const active = this.activeEntry();
    if (
      active?.id === tabId &&
      active.view?.dom.parentElement === parent &&
      active.path === path
    ) {
      const loadEpochChanged = active.loadEpoch !== loadEpoch;
      if (loadEpochChanged) {
        this.closeLanguageService(active);
        active.loadEpoch = loadEpoch;
        active.languageServiceHandle = { tabId, path, loadEpoch };
      }
      active.onChange = onChange;
      active.changeIndicators.setBaseline(active.view, baselineContent);
      active.changeIndicators.setCopy(active.view, editorChangeIndicatorCopy(this.blameCopy));
      this.updateBlameAvailability(active, blameSource, blameUnavailableReason);
      applyEditorPreferences(active.view, preferences);

      if (loadEpochChanged || (active.serializedContent !== null && active.serializedContent !== content)) {
        const currentText = active.view.state.doc.toString();
        const decoded = decodeExactText(content);
        const prevScrollTop = active.view.scrollDOM.scrollTop;
        const prevScrollLeft = active.view.scrollDOM.scrollLeft;
        active.exactContent = decoded;
        active.separatorCounts = countLineSeparators(decoded.separators);
        active.serializedContent = content;
        const change = computeTextChange(currentText, decoded.text);
        if (change) {
          this.synchronizing = true;
          try {
            active.view.dispatch({ changes: change });
          } finally {
            this.synchronizing = false;
          }
        }
        this.restoreScroll(active.view.scrollDOM, prevScrollTop, prevScrollLeft);
        this.refreshLanguageService(active);
      }
      this.updateBaseline(active, baselineContent);
      active.view.requestMeasure();
      return;
    }

    const reusableView =
      active?.view?.dom.parentElement === parent
        ? this.releaseActiveView(true)
        : (this.detach(), null);
    let entry = this.entries.get(tabId);
    if (entry && entry.path !== path) {
      this.dispose(tabId);
      entry = undefined;
    }
    if (entry && entry.loadEpoch !== loadEpoch) {
      this.closeLanguageService(entry);
      entry.loadEpoch = loadEpoch;
      entry.languageServiceHandle = { tabId, path, loadEpoch };
      const decoded = decodeExactText(content);
      entry.exactContent = decoded;
      entry.separatorCounts = countLineSeparators(decoded.separators);
      entry.serializedContent = content;
      const currentText = entry.state.doc.toString();
      if (currentText !== decoded.text) {
        const change = computeTextChange(currentText, decoded.text);
        if (change) entry.state = entry.state.update({ changes: change }).state;
      }
      this.refreshLanguageService(entry);
    }
    if (!entry) {
      entry = this.createEntry(
        tabId,
        loadEpoch,
        content,
        baselineContent,
        path,
        preferences,
        blameSource,
        blameUnavailableReason,
        onChange,
      );
      this.entries.set(tabId, entry);
    } else {
      entry.onChange = onChange;
      this.updateBlameAvailability(entry, blameSource, blameUnavailableReason);
    }

    const mountedEntry = entry;
    const view = reusableView ?? new EditorView({ parent, state: mountedEntry.state });
    if (reusableView) view.setState(mountedEntry.state);
    mountedEntry.view = view;
    this.activeId = tabId;
    mountedEntry.blameController.register("text", view, mountedEntry.blame);
    applyEditorPreferences(view, preferences);
    mountedEntry.changeIndicators.setBaseline(view, baselineContent);
    this.updateBaseline(mountedEntry, baselineContent);
    mountedEntry.changeIndicators.setCopy(view, editorChangeIndicatorCopy(this.blameCopy));
    this.updateLanguageDataset(mountedEntry);
    this.restoreScroll(view.scrollDOM, mountedEntry.scrollTop, mountedEntry.scrollLeft);
    if (mountedEntry.languageStatus === "loading") {
      this.loadLanguage(mountedEntry);
    }
  }

  private restoreScroll(
    scrollDOM: HTMLElement,
    scrollTop: number,
    scrollLeft: number,
  ): void {
    const generation = ++this.scrollRestorationGeneration;
    let attempts = 0;
    const apply = () => {
      if (generation !== this.scrollRestorationGeneration || !scrollDOM.isConnected) return;
      const max = Math.max(0, scrollDOM.scrollHeight - scrollDOM.clientHeight);
      if (max > 0 || attempts >= 5) {
        scrollDOM.scrollTop = Math.min(max, scrollTop);
      } else {
        scrollDOM.scrollTop = scrollTop;
      }
      scrollDOM.scrollLeft = scrollLeft;
      if (scrollDOM.scrollTop < scrollTop && max > scrollDOM.scrollTop && attempts < 5) {
        attempts += 1;
        window.requestAnimationFrame(apply);
      }
    };
    apply();
    window.requestAnimationFrame(apply);
  }

  isMountedIn(parent: HTMLElement): boolean {
    return this.activeEntry()?.view?.dom.parentElement === parent;
  }

  content(tabId = this.activeId): string {
    if (!tabId) return "";
    const entry = this.entries.get(tabId);
    if (!entry) return "";
    if (entry.serializedContent === null) {
      entry.exactContent.text = entry.state.doc.toString();
      entry.serializedContent = encodeExactText(entry.exactContent);
    }
    return entry.serializedContent;
  }

  flushChanges(): void {
    const entry = this.activeEntry();
    if (entry) this.flushEntryChange(entry);
  }

  focus(): void {
    this.activeEntry()?.view?.focus();
  }

  openFindReplace(): boolean {
    const view = this.activeEntry()?.view;
    return view ? openSearchPanel(view) : false;
  }

  selectRange(fromUtf16: number, toUtf16: number): boolean {
    const active = this.activeEntry();
    const view = active?.view;
    if (!view) return false;
    const length = view.state.doc.length;
    if (
      !Number.isInteger(fromUtf16) ||
      !Number.isInteger(toUtf16) ||
      fromUtf16 < 0 ||
      toUtf16 < fromUtf16 ||
      toUtf16 > length
    ) {
      return false;
    }
    // A search result takes precedence over scroll restoration queued by a newly mounted tab.
    const scrollGeneration = ++this.scrollRestorationGeneration;
    const loadEpoch = active.loadEpoch;
    view.dispatch({
      selection: { anchor: fromUtf16, head: toUtf16 },
      effects: EditorView.scrollIntoView(fromUtf16, { y: "center" }),
    });
    view.focus();
    // On the first lazy mount, CodeMirror may not have measured the viewport yet.
    window.requestAnimationFrame(() => {
      if (this.scrollRestorationGeneration !== scrollGeneration || this.activeEntry() !== active ||
        active.loadEpoch !== loadEpoch || active.view !== view || !view.dom.isConnected) return;
      view.dispatch({ effects: EditorView.scrollIntoView(fromUtf16, { y: "center" }) });
    });
    return true;
  }

  revealFirstChange(): boolean {
    const entry = this.activeEntry();
    return entry?.view
      ? entry.changeIndicators.revealFirst(entry.view)
      : false;
  }

  requestMeasure(): void {
    this.activeEntry()?.view?.requestMeasure();
  }

  linkVerticalScroll(peer: HTMLElement): () => void {
    const source = this.activeEntry()?.view?.scrollDOM;
    return source
      ? linkVerticalScrollProportionally(source, peer)
      : () => undefined;
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnlyValue = readOnly;
    for (const entry of this.entries.values()) {
      this.dispatchEffects(entry, [
        entry.readOnly.reconfigure(EditorState.readOnly.of(readOnly)),
        entry.editable.reconfigure(EditorView.editable.of(!readOnly)),
      ]);
      this.refreshLanguageService(entry);
    }
  }

  setLanguageServices(factory: EditorLanguageServicePortFactory | null): void {
    if (this.languageServiceFactory === factory) return;
    this.languageServiceFactory = factory;
    for (const entry of this.entries.values()) this.refreshLanguageService(entry);
  }

  setPreferences(preferences: AppPreferences): void {
    for (const entry of this.entries.values()) {
      if (entry.view) applyEditorPreferences(entry.view, preferences);
      this.dispatchEffects(
        entry,
        [
          entry.tabSize.reconfigure(
            EditorState.tabSize.of(preferences.editorTabSize),
          ),
          entry.indent.reconfigure(
            indentUnit.of(" ".repeat(preferences.editorIndentSize)),
          ),
        ],
      );
    }
  }

  setTheme(theme: EffectiveTheme): void {
    if (this.themeValue === theme) return;
    this.themeValue = theme;
    for (const entry of this.entries.values()) {
      this.dispatchEffects(
        entry,
        entry.theme.reconfigure(asterlynEditorTheme(theme)),
      );
    }
  }

  setPhrases(phrases: Readonly<Record<string, string>>): void {
    this.phrasesValue = phrases;
    for (const entry of this.entries.values()) {
      this.dispatchEffects(
        entry,
        entry.phrases.reconfigure(EditorState.phrases.of(phrases)),
      );
    }
  }

  setBlameCopy(copy: EditorCopy): void {
    if (this.blameCopy === copy) return;
    this.blameCopy = copy;
    for (const entry of this.entries.values()) {
      entry.blameController.setCopy(copy);
      if (entry.view) entry.changeIndicators.setCopy(entry.view, editorChangeIndicatorCopy(copy));
    }
  }

  detach(): void {
    this.contextMenu.close("editor.text.git-blame");
    this.releaseActiveView(false);
  }

  private releaseActiveView(reuse: true): EditorView | null;
  private releaseActiveView(reuse: false): null;
  private releaseActiveView(reuse: boolean): EditorView | null {
    const entry = this.activeEntry();
    if (!entry?.view) {
      this.activeId = null;
      return null;
    }
    this.flushEntryChange(entry);
    entry.scrollLeft = entry.view.scrollDOM.scrollLeft;
    entry.scrollTop = entry.view.scrollDOM.scrollTop;
    entry.state = entry.view.state;
    const view = entry.view;
    entry.blameController.unregister(view);
    entry.view = null;
    this.activeId = null;
    if (entry.languageStatus === "loading") {
      entry.languageActivation += 1;
      entry.languageLoader.cancel();
    }
    if (reuse) return view;
    const dom = view.dom;
    view.destroy();
    dom.remove();
    return null;
  }

  retain(tabIds: readonly string[]): void {
    const retained = new Set(tabIds);
    for (const tabId of this.entries.keys()) {
      if (!retained.has(tabId)) this.dispose(tabId);
    }
  }

  remap(remaps: readonly EditorRuntimeTabRemap[]): boolean {
    const result = remapEditorCacheEntries(this.entries, this.activeId, remaps);
    if (result.status === "conflict") return false;
    this.activeId = result.activeId;
    return true;
  }

  dispose(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (!entry) return;
    if (this.activeId === tabId) this.detach();
    if (entry.changeFrame !== null) window.cancelAnimationFrame(entry.changeFrame);
    entry.languageActivation += 1;
    entry.languageLoader.cancel();
    this.closeLanguageService(entry);
    entry.blameController.destroy();
    if (entry.view) {
      const dom = entry.view.dom;
      entry.view.destroy();
      dom.remove();
    }
    this.entries.delete(tabId);
  }

  destroy(): void {
    this.contextMenu.close("editor.text.git-blame");
    for (const tabId of [...this.entries.keys()]) this.dispose(tabId);
  }

  private createEntry(
    id: string,
    loadEpoch: number,
    content: string,
    baselineContent: string,
    path: string,
    preferences: AppPreferences,
    blameSource: GitBlameSource | null,
    blameUnavailableReason: string | null,
    onChange: (content: string | null, dirty: boolean) => void,
  ): CachedTextEditor {
    const readOnly = new Compartment();
    const editable = new Compartment();
    const language = new Compartment();
    const indent = new Compartment();
    const tabSize = new Compartment();
    const theme = new Compartment();
    const phrases = new Compartment();
    const blame = new Compartment();
    const languageServices = new Compartment();
    const languageServiceHandle = { tabId: id, path, loadEpoch };
    const changeIndicators = createEditorChangeIndicators(
      baselineContent,
      editorChangeIndicatorCopy(this.blameCopy),
      { patchPopover: true },
    );
    const exactContent = decodeExactText(content);
    const entry: CachedTextEditor = {
      id,
      loadEpoch,
      path,
      exactContent,
      separatorCounts: countLineSeparators(exactContent.separators),
      serializedContent: content,
      state: null as unknown as EditorState,
      baselineText: null as unknown as Text,
      view: null,
      scrollLeft: 0,
      scrollTop: 0,
      readOnly,
      editable,
      language,
      indent,
      tabSize,
      theme,
      phrases,
      blame,
      changeIndicators,
      languageLoader: new EditorLanguageLoader(),
      languageActivation: 0,
      languageName: "Plain Text",
      languageStatus: "loading",
      onChange,
      changePending: false,
      changeFrame: null,
      blameController: new GitBlamePaneController(
        this.blameRuntime, this.blameCopy, this.contextMenu, "editor.text.git-blame",
      ),
      languageServices,
      languageServicePort: null,
      languageServiceHandle,
      languageServiceVersion: 1,
      disposeLanguageDiagnostics: null,
      languageServiceUpdateTimer: null,
      languageServicePendingText: null,
    };
    this.updateBlameAvailability(entry, blameSource, blameUnavailableReason);
    entry.state = EditorState.create({
      doc: entry.exactContent.text,
      extensions: [
        tabSize.of(EditorState.tabSize.of(preferences.editorTabSize)),
        indent.of(indentUnit.of(" ".repeat(preferences.editorIndentSize))),
        readOnly.of(EditorState.readOnly.of(this.readOnlyValue)),
        editable.of(EditorView.editable.of(!this.readOnlyValue)),
        codeMirrorFocusOwnership,
        language.of([]),
        ...entry.blameController.extensions("text", blame),
        changeIndicators.extension,
        lineNumberGutter(
          undefined,
          "before",
          entry.blameController.menu("text"),
        ),
        foldGutter({ markerDOM: createFoldMarker }),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        asterlynSearch(),
        highlightSelectionMatches(),
        theme.of(asterlynEditorTheme(this.themeValue)),
        phrases.of(EditorState.phrases.of(this.phrasesValue)),
        languageServices.of([]),
        asterlynSyntaxHighlighting,
        keymap.of([
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap.filter((binding) => binding.key !== "Mod-f"),
        ]),
        EditorView.updateListener.of((update) => {
          entry.state = update.state;
          if (!update.docChanged || this.synchronizing) return;
          if (entry.languageServicePort && !this.readOnlyValue) {
            entry.languageServiceVersion += 1;
            entry.languageServicePendingText = update.state.doc.toString();
            if (entry.languageServiceUpdateTimer === null) {
              entry.languageServiceUpdateTimer = window.setTimeout(() => {
                entry.languageServiceUpdateTimer = null;
                const text = entry.languageServicePendingText;
                entry.languageServicePendingText = null;
                if (text !== null && entry.languageServicePort && !this.readOnlyValue) entry.languageServicePort.update(entry.languageServiceHandle, { version: entry.languageServiceVersion, text });
              }, 50);
            }
          }
          this.invalidateBlameForEdit(entry);
          const changes: LineSeparatorChange[] = [];
          update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
            const fromLine = update.startState.doc.lineAt(from).number;
            const toLine = update.startState.doc.lineAt(to).number;
            changes.push({
              separatorStart: fromLine - 1,
              removedSeparators: toLine - fromLine,
              insertedSeparators: inserted.lines - 1,
            });
          });
          applyLineSeparatorChanges(entry.exactContent, entry.separatorCounts, changes);
          entry.serializedContent = null;
          entry.changePending = true;
          this.scheduleEntryChange(entry);
        }),
      ],
    });
    entry.baselineText = content === baselineContent
      ? entry.state.doc
      : EditorState.create({ doc: decodeExactText(baselineContent).text }).doc;
    this.refreshLanguageService(entry);
    return entry;
  }

  private refreshLanguageService(entry: CachedTextEditor): void {
    this.closeLanguageService(entry);
    const next = this.readOnlyValue ? null : this.languageServiceFactory?.(entry.languageServiceHandle) ?? null;
    entry.languageServicePort = next;
    this.dispatchEffects(entry, [entry.languageServices.reconfigure(next ? this.languageServiceExtensions(entry) : [])]);
    if (!next) return;
    entry.languageServiceVersion = 1;
    next.open(entry.languageServiceHandle, { version: 1, text: entry.state.doc.toString() });
    entry.disposeLanguageDiagnostics = next.subscribeDiagnostics((event) => {
      if (event.handle.tabId !== entry.id || event.handle.loadEpoch !== entry.loadEpoch || event.version !== entry.languageServiceVersion || !entry.view) return;
      entry.view.dispatch(setDiagnostics(entry.view.state, event.diagnostics.map((diagnostic) => this.toCodeMirrorDiagnostic(entry.view!, diagnostic))));
    });
  }

  private closeLanguageService(entry: CachedTextEditor): void {
    entry.disposeLanguageDiagnostics?.();
    entry.disposeLanguageDiagnostics = null;
    if (entry.languageServiceUpdateTimer !== null) window.clearTimeout(entry.languageServiceUpdateTimer);
    entry.languageServiceUpdateTimer = null;
    entry.languageServicePendingText = null;
    entry.languageServicePort?.close(entry.languageServiceHandle);
    entry.languageServicePort = null;
  }

  private toCodeMirrorDiagnostic(view: EditorView, diagnostic: EditorLanguageServiceDiagnostic): Diagnostic {
    const position = (value: EditorLanguageServicePosition): number => {
      const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, value.line + 1)));
      return Math.min(line.to, line.from + Math.max(0, value.character));
    };
    return { from: position(diagnostic.range.start), to: position(diagnostic.range.end), severity: diagnostic.severity === 1 ? "error" : diagnostic.severity === 2 ? "warning" : "info", message: diagnostic.message, source: diagnostic.source };
  }

  private languageServiceExtensions(entry: CachedTextEditor) {
    const port = entry.languageServicePort;
    if (!port) return [];
    return [
      lintGutter(),
      autocompletion({ override: [(context) => this.complete(entry, context)] }),
      hoverTooltip((view, pos) => this.hover(entry, view, pos)),
      keymap.of([{ key: "F12", run: (view) => { void this.definition(entry, view); return true; } }]),
    ];
  }

  private async hover(entry: CachedTextEditor, view: EditorView, pos: number) {
    const port = entry.languageServicePort;
    if (!port || this.readOnlyValue) return null;
    const version = entry.languageServiceVersion;
    const line = view.state.doc.lineAt(pos);
    const response = await port.request<{ contents?: unknown }>(entry.languageServiceHandle, "textDocument/hover", { position: { line: line.number - 1, character: pos - line.from }, textDocument: { uri: `file://${entry.path}` } }, version);
    if (!response || entry.languageServicePort !== port || entry.languageServiceVersion !== version) return null;
    const plain = typeof response.contents === "string" ? response.contents : Array.isArray(response.contents) ? response.contents.map((item) => typeof item === "string" ? item : (item as { value?: string }).value ?? "").join("\n") : (response.contents as { value?: string } | undefined)?.value ?? "";
    if (!plain) return null;
    return { pos, end: pos, above: true, create: () => { const dom = document.createElement("div"); dom.className = "cm-tooltip-language-service"; dom.textContent = plain; return { dom }; } };
  }

  private async definition(entry: CachedTextEditor, view: EditorView): Promise<void> {
    const port = entry.languageServicePort;
    if (!port || this.readOnlyValue) return;
    const version = entry.languageServiceVersion;
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const response = await port.request<EditorLanguageServiceLocation | readonly EditorLanguageServiceLocation[]>(entry.languageServiceHandle, "textDocument/definition", { position: { line: line.number - 1, character: pos - line.from }, textDocument: { uri: `file://${entry.path}` } }, version);
    if (!response || entry.languageServicePort !== port || entry.languageServiceVersion !== version) return;
    const location = Array.isArray(response) ? response[0] : response;
    if (location) port.navigate?.(location);
  }

  private async complete(entry: CachedTextEditor, context: CompletionContext): Promise<CompletionResult | null> {
    const port = entry.languageServicePort;
    if (!port || this.readOnlyValue) return null;
    const version = entry.languageServiceVersion;
    const line = context.state.doc.lineAt(context.pos);
    const response = await port.request<{ items?: readonly EditorLanguageServiceCompletionItem[] } | readonly EditorLanguageServiceCompletionItem[]>(entry.languageServiceHandle, "textDocument/completion", { position: { line: line.number - 1, character: context.pos - line.from }, textDocument: { uri: `file://${entry.path}` } }, version);
    if (!response || entry.languageServicePort !== port || entry.languageServiceVersion !== version) return null;
    const match = context.matchBefore(/[\w$]*/);
    const from = match?.from ?? context.pos;
    const items: readonly EditorLanguageServiceCompletionItem[] = Array.isArray(response) ? response : ("items" in response ? response.items ?? [] : []);
    const toOffset = (position: EditorLanguageServicePosition): number | null => {
      if (position.line < 0 || position.line >= context.state.doc.lines || position.character < 0) return null;
      const target = context.state.doc.line(position.line + 1);
      const offset = target.from + position.character;
      return offset <= target.to ? offset : null;
    };
    return { from, options: items.filter((item) => item.insertTextFormat !== 2 && !item.insertReplaceEdit && !item.additionalTextEdits?.length && !item.command).map((item) => ({ label: item.label, detail: item.detail, type: "text", apply: (view: EditorView, _completion: unknown, _from: number, to: number) => {
      if (entry.languageServiceVersion !== version || entry.languageServicePort !== port) return;
      const edit = item.textEdit;
      const editFrom = edit ? toOffset(edit.range.start) : from;
      const editTo = edit ? toOffset(edit.range.end) : to;
      if (edit && (editFrom === null || editTo === null || editFrom > editTo)) return;
      view.dispatch({ changes: { from: editFrom ?? from, to: editTo ?? to, insert: edit?.newText ?? item.insertText ?? item.label }, userEvent: "input.complete" });
    } })) };
  }

  private invalidateBlameForEdit(entry: CachedTextEditor): void {
    this.updateBlameAvailability(entry, null, this.blameCopy.gitBlameRequiresSavedFile);
  }

  private updateBlameAvailability(
    entry: CachedTextEditor,
    source: GitBlameSource | null,
    unavailableReason: string | null,
  ): void {
    entry.blameController.setTarget("text", sourceBlameTarget(
      { source, unavailableReason }, `text-${entry.loadEpoch}`,
    ));
  }

  private loadLanguage(entry: CachedTextEditor): void {
    const activation = ++entry.languageActivation;
    void entry.languageLoader.load(entry.path).then(async (result) => {
      if (!result || !this.canInstallLanguage(entry, activation)) return;
      if (result.support) {
        // Let the plain document paint before parser installation. A rapid
        // selection change cancels this activation instead of parsing a file
        // that is no longer visible on the UI thread.
        await afterNextEditorPaint();
        if (!this.canInstallLanguage(entry, activation)) return;
      }
      entry.languageStatus = result.status;
      if (!result.support) {
        entry.languageName =
          result.status === "failed" ? "Plain Text" : result.name;
        this.updateLanguageDataset(entry);
        return;
      }
      entry.languageName = result.name;
      this.dispatchEffects(
        entry,
        entry.language.reconfigure(
          withEditorFolding(result.name, result.support),
        ),
      );
      this.updateLanguageDataset(entry);
    });
  }

  private canInstallLanguage(
    entry: CachedTextEditor,
    activation: number,
  ): boolean {
    return (
      entry.languageActivation === activation &&
      this.entries.get(entry.id) === entry &&
      this.activeId === entry.id &&
      entry.view !== null
    );
  }

  private scheduleEntryChange(entry: CachedTextEditor): void {
    if (entry.changeFrame !== null) return;
    entry.changeFrame = window.requestAnimationFrame(() => {
      entry.changeFrame = null;
      this.flushEntryChange(entry);
    });
  }

  private flushEntryChange(entry: CachedTextEditor): void {
    if (entry.changeFrame !== null) {
      window.cancelAnimationFrame(entry.changeFrame);
      entry.changeFrame = null;
    }
    if (!entry.changePending) return;
    entry.changePending = false;
    entry.onChange(null, !entry.state.doc.eq(entry.baselineText));
  }

  private updateBaseline(entry: CachedTextEditor, baselineContent: string): void {
    if (entry.serializedContent === baselineContent) {
      entry.baselineText = entry.state.doc;
      return;
    }
    entry.baselineText = EditorState.create({ doc: decodeExactText(baselineContent).text }).doc;
  }

  private dispatchEffects(
    entry: CachedTextEditor,
    effects: NonNullable<TransactionSpec["effects"]>,
  ): void {
    if (entry.view) {
      entry.view.dispatch({ effects });
    } else {
      entry.state = entry.state.update({ effects }).state;
    }
  }

  private updateLanguageDataset(entry: CachedTextEditor): void {
    if (!entry.view) return;
    entry.view.dom.dataset.language = entry.languageName;
    entry.view.dom.dataset.languageStatus = entry.languageStatus;
  }

  private activeEntry(): CachedTextEditor | null {
    return this.activeId ? (this.entries.get(this.activeId) ?? null) : null;
  }
}

function afterNextEditorPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = `asterlyn-fold-marker ${open ? "open" : "closed"}`;
  marker.title = open ? "Fold code region" : "Unfold code region";
  marker.setAttribute("aria-hidden", "true");
  marker.innerHTML = `<svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path d="${open ? "M3.5 5.5 8 10l4.5-4.5" : "M5.5 3.5 10 8l-4.5 4.5"}" /></svg>`;
  return marker;
}
