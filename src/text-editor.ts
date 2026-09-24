import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { foldGutter, foldKeymap, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { asterlynSearch } from "./editor-search";
import { Compartment, EditorState, type TransactionSpec } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
} from "@codemirror/view";
import { withEditorFolding } from "./editor-folding";
import { EditorLanguageLoader, type EditorLanguageStatus } from "./editor-language";
import { asterlynEditorTheme, asterlynSyntaxHighlighting } from "./editor-theme";
import { gitBlameContextSession } from "./features/files-editor/editor-gutter-context-actions.ts";
import type { EffectiveTheme } from "./presentation/presentation-environment";
import type { ContextMenuPort } from "./shared/context-menu/context-menu-model.ts";
import { linkVerticalScrollProportionally } from "./presentation/linked-scroll";
import type { AppPreferences } from "./preferences";
import {
  applyExactTextChanges,
  computeTextChange,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
  type TextChange,
} from "./features/files-editor/text-content";
import {
  blameContentContextMenu,
  blameGutter,
  lineNumberGutter,
  type GitBlameRuntime,
  type GitBlameSource,
} from "./features/files-editor/editor-gutter.ts";
import type { GitBlameResult } from "./models.ts";
import type { EditorRuntimeTabRemap } from "./editor-path-mutation.ts";
import { remapEditorCacheEntries } from "./features/files-editor/editor-cache-remap.ts";
import {
  createEditorChangeIndicators,
  editorChangeIndicatorCopy,
  type EditorChangeIndicators,
} from "./editor-change-indicators.ts";
import type { EditorCopy } from "./localization/catalog.ts";

interface CachedTextEditor {
  id: string;
  loadEpoch: number;
  path: string;
  exactContent: ExactTextContent;
  serializedContent: string | null;
  state: EditorState;
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
  onChange: (content: string) => void;
  changePending: boolean;
  changeFrame: number | null;
  blameSource: GitBlameSource | null;
  blameUnavailableReason: string | null;
  blameResult: GitBlameResult | null;
  blameLoading: boolean;
  blameGeneration: number;
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

  constructor(
    private readonly blameRuntime: GitBlameRuntime,
    private blameCopy: EditorCopy,
    private readonly contextMenu: ContextMenuPort,
    private readonly contextOwnerId: string,
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
    onChange: (content: string) => void,
  ): void {
    const active = this.activeEntry();
    if (
      active?.id === tabId &&
      active.view?.dom.parentElement === parent &&
      active.path === path
    ) {
      active.loadEpoch = loadEpoch;
      active.onChange = onChange;
      active.changeIndicators.setBaseline(active.view, baselineContent);
      active.changeIndicators.setCopy(active.view, editorChangeIndicatorCopy(this.blameCopy));
      this.updateBlameAvailability(active, blameSource, blameUnavailableReason);
      applyEditorPreferences(active.view, preferences);

      const currentText = active.view.state.doc.toString();
      const decoded = decodeExactText(content);
      if (currentText !== decoded.text) {
        const prevScrollTop = active.view.scrollDOM.scrollTop;
        const prevScrollLeft = active.view.scrollDOM.scrollLeft;
        active.exactContent = decoded;
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
      } else {
        active.exactContent = decoded;
        active.serializedContent = content;
      }
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
      entry.loadEpoch = loadEpoch;
      const decoded = decodeExactText(content);
      entry.exactContent = decoded;
      entry.serializedContent = content;
      const currentText = entry.state.doc.toString();
      if (currentText !== decoded.text) {
        const change = computeTextChange(currentText, decoded.text);
        if (change) entry.state = entry.state.update({ changes: change }).state;
      }
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
    applyEditorPreferences(view, preferences);
    mountedEntry.changeIndicators.setBaseline(view, baselineContent);
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
    }
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
      if (entry.blameResult) this.installBlame(entry, entry.blameResult);
      if (entry.view) entry.changeIndicators.setCopy(entry.view, editorChangeIndicatorCopy(copy));
    }
  }

  detach(): void {
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
    this.contextMenu.close(this.contextOwnerId);
    if (entry.blameResult || entry.blameLoading) this.clearBlame(entry);
    this.flushEntryChange(entry);
    entry.scrollLeft = entry.view.scrollDOM.scrollLeft;
    entry.scrollTop = entry.view.scrollDOM.scrollTop;
    entry.state = entry.view.state;
    const view = entry.view;
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
    if (entry.view) {
      const dom = entry.view.dom;
      entry.view.destroy();
      dom.remove();
    }
    this.entries.delete(tabId);
  }

  destroy(): void {
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
    onChange: (content: string) => void,
  ): CachedTextEditor {
    const readOnly = new Compartment();
    const editable = new Compartment();
    const language = new Compartment();
    const indent = new Compartment();
    const tabSize = new Compartment();
    const theme = new Compartment();
    const phrases = new Compartment();
    const blame = new Compartment();
    const changeIndicators = createEditorChangeIndicators(
      baselineContent,
      editorChangeIndicatorCopy(this.blameCopy),
    );
    const entry: CachedTextEditor = {
      id,
      loadEpoch,
      path,
      exactContent: decodeExactText(content),
      serializedContent: content,
      state: null as unknown as EditorState,
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
      blameSource,
      blameUnavailableReason,
      blameResult: null,
      blameLoading: false,
      blameGeneration: 0,
    };
    entry.state = EditorState.create({
      doc: entry.exactContent.text,
      extensions: [
        tabSize.of(EditorState.tabSize.of(preferences.editorTabSize)),
        indent.of(indentUnit.of(" ".repeat(preferences.editorIndentSize))),
        readOnly.of(EditorState.readOnly.of(this.readOnlyValue)),
        editable.of(EditorView.editable.of(!this.readOnlyValue)),
        language.of([]),
        blame.of([]),
        changeIndicators.extension,
        lineNumberGutter((event, view) => this.openBlameMenu(entry, event, view)),
        blameContentContextMenu((event, view) => this.openBlameMenu(entry, event, view)),
        foldGutter({ markerDOM: createFoldMarker }),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        asterlynSearch(),
        highlightSelectionMatches(),
        theme.of(asterlynEditorTheme(this.themeValue)),
        phrases.of(EditorState.phrases.of(this.phrasesValue)),
        asterlynSyntaxHighlighting,
        keymap.of([
          ...foldKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          { key: "Mod-f", run: openSearchPanel },
        ]),
        EditorView.updateListener.of((update) => {
          entry.state = update.state;
          if (!update.docChanged || this.synchronizing) return;
          this.invalidateBlameForEdit(entry);
          const changes: TextChange[] = [];
          update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
            changes.push({ from, to, insert: inserted.toString() });
          });
          entry.exactContent = applyExactTextChanges(entry.exactContent, changes);
          entry.serializedContent = null;
          entry.changePending = true;
          this.scheduleEntryChange(entry);
        }),
      ],
    });
    return entry;
  }

  private openBlameMenu(
    entry: CachedTextEditor,
    event: MouseEvent,
    view: EditorView,
  ): void {
    const source = entry.blameSource;
    const generation = entry.blameGeneration;
    const active = entry.blameResult !== null;
    const loading = entry.blameLoading;
    const isCurrent = () =>
      this.entries.get(entry.id) === entry &&
      entry.view === view &&
      generation === entry.blameGeneration &&
      active === (entry.blameResult !== null) &&
      loading === entry.blameLoading &&
      sameBlameSource(source, entry.blameSource);
    this.contextMenu.open(
      { x: event.clientX, y: event.clientY },
      gitBlameContextSession(this.contextOwnerId, {
        active,
        loading,
        enabled: source !== null,
        unavailableReason: entry.blameUnavailableReason,
        copy: this.blameCopy,
        isCurrent,
        toggle: () => this.toggleBlame(entry),
        blocked: (reason) => this.blameRuntime.status(reason, "warning"),
        restoreFocus: () => {
          if (this.entries.get(entry.id) === entry && entry.view === view && view.dom.isConnected) {
            view.focus();
          }
        },
      }),
    );
  }

  private async toggleBlame(entry: CachedTextEditor): Promise<void> {
    if (entry.blameResult || entry.blameLoading) {
      this.clearBlame(entry);
      this.blameRuntime.status(this.blameCopy.gitBlameHidden, "information");
      return;
    }
    const source = entry.blameSource;
    if (!source) return;
    const generation = ++entry.blameGeneration;
    entry.blameLoading = true;
    this.blameRuntime.status(this.blameCopy.loadingGitBlame, "information");
    try {
      const result = await this.blameRuntime.load(source);
      if (
        generation !== entry.blameGeneration ||
        this.entries.get(entry.id) !== entry ||
        !sameBlameSource(entry.blameSource, source)
      ) return;
      entry.blameLoading = false;
      entry.blameResult = result;
      this.installBlame(entry, result);
      const lines = result.hunks.reduce((total, hunk) => total + hunk.lineCount, 0);
      this.blameRuntime.status(
        result.truncated
          ? this.blameCopy.gitBlameLimited(lines)
          : this.blameCopy.gitBlameLoaded(lines),
        result.truncated ? "warning" : "information",
      );
    } catch (error) {
      if (generation !== entry.blameGeneration || this.entries.get(entry.id) !== entry) return;
      entry.blameLoading = false;
      this.blameRuntime.error(error);
    }
  }

  private installBlame(entry: CachedTextEditor, result: GitBlameResult): void {
    this.dispatchEffects(
      entry,
      entry.blame.reconfigure(
        blameGutter(
          result,
          this.blameCopy,
          (event, view) => this.openBlameMenu(entry, event, view),
        ),
      ),
    );
  }

  private clearBlame(entry: CachedTextEditor): void {
    this.contextMenu.close(this.contextOwnerId);
    entry.blameGeneration += 1;
    entry.blameLoading = false;
    entry.blameResult = null;
    this.dispatchEffects(entry, entry.blame.reconfigure([]));
  }

  private invalidateBlameForEdit(entry: CachedTextEditor): void {
    entry.blameSource = null;
    entry.blameUnavailableReason = this.blameCopy.gitBlameRequiresSavedFile;
    if (entry.blameResult || entry.blameLoading) this.clearBlame(entry);
  }

  private updateBlameAvailability(
    entry: CachedTextEditor,
    source: GitBlameSource | null,
    unavailableReason: string | null,
  ): void {
    if (!sameBlameSource(entry.blameSource, source)) {
      this.contextMenu.close(this.contextOwnerId);
    }
    if (!sameBlameSource(entry.blameSource, source) && (entry.blameResult || entry.blameLoading)) {
      this.clearBlame(entry);
    }
    entry.blameSource = source;
    entry.blameUnavailableReason = unavailableReason;
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
    entry.onChange(this.content(entry.id));
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

function sameBlameSource(
  left: GitBlameSource | null,
  right: GitBlameSource | null,
): boolean {
  return left === right || Boolean(
    left && right &&
      left.repositoryRoot === right.repositoryRoot &&
      left.repositoryId === right.repositoryId &&
      left.path === right.path &&
      left.commitOid === right.commitOid &&
      left.parent === right.parent,
  );
}

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = `asterlyn-fold-marker ${open ? "open" : "closed"}`;
  marker.title = open ? "Fold code region" : "Unfold code region";
  marker.setAttribute("aria-hidden", "true");
  marker.innerHTML = `<svg viewBox="0 0 16 16" focusable="false" aria-hidden="true"><path d="${open ? "M3.5 5.5 8 10l4.5-4.5" : "M5.5 3.5 10 8l-4.5 4.5"}" /></svg>`;
  return marker;
}

function applyEditorPreferences(
  view: EditorView,
  preferences: AppPreferences,
): void {
  view.dom.style.setProperty("--editor-font-size", `${preferences.editorFontSize}px`);
  view.dom.style.setProperty(
    "--editor-line-height",
    preferences.editorLineHeight.toString(),
  );
  view.dom.style.setProperty(
    "--editor-letter-spacing",
    `${preferences.editorLetterSpacing}px`,
  );
}
