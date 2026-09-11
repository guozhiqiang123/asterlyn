import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { foldGutter, foldKeymap, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type TransactionSpec } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { withEditorFolding } from "./editor-folding";
import { EditorLanguageLoader, type EditorLanguageStatus } from "./editor-language";
import { asterlynEditorTheme, asterlynSyntaxHighlighting } from "./editor-theme";
import { linkVerticalScrollProportionally } from "./workbench/linked-scroll";
import type { AppPreferences } from "./workbench/preferences";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
  type TextChange,
} from "./workbench/text-content";

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
  languageLoader: EditorLanguageLoader;
  languageName: string;
  languageStatus: EditorLanguageStatus | "loading";
  onChange: (content: string) => void;
  changePending: boolean;
  changeFrame: number | null;
}

/**
 * Owns one bounded CodeMirror state per open text tab while mounting only the
 * active view. Tab switches preserve parsing, history, selection, and scroll
 * state without retaining a hidden DOM editor for every file.
 */
export class TextEditor {
  private readonly entries = new Map<string, CachedTextEditor>();
  private activeId: string | null = null;
  private readOnlyValue = false;

  mount(
    parent: HTMLElement,
    tabId: string,
    loadEpoch: number,
    content: string,
    path: string,
    preferences: AppPreferences,
    onChange: (content: string) => void,
  ): void {
    const active = this.activeEntry();
    if (
      active?.id === tabId &&
      active.loadEpoch === loadEpoch &&
      active.view?.dom.parentElement === parent
    ) {
      active.onChange = onChange;
      applyEditorPreferences(active.view, preferences);
      active.view.requestMeasure();
      return;
    }

    this.detach();
    let entry = this.entries.get(tabId);
    if (entry && (entry.loadEpoch !== loadEpoch || entry.path !== path)) {
      this.dispose(tabId);
      entry = undefined;
    }
    if (!entry) {
      entry = this.createEntry(tabId, loadEpoch, content, path, preferences, onChange);
      this.entries.set(tabId, entry);
      this.loadLanguage(entry);
    } else {
      entry.onChange = onChange;
    }

    const mountedEntry = entry;
    const view = new EditorView({ parent, state: mountedEntry.state });
    mountedEntry.view = view;
    this.activeId = tabId;
    applyEditorPreferences(view, preferences);
    this.updateLanguageDataset(mountedEntry);
    view.scrollDOM.scrollLeft = mountedEntry.scrollLeft;
    view.scrollDOM.scrollTop = mountedEntry.scrollTop;
    window.requestAnimationFrame(() => {
      if (mountedEntry.view !== view || this.activeId !== tabId) return;
      view.scrollDOM.scrollLeft = mountedEntry.scrollLeft;
      view.scrollDOM.scrollTop = mountedEntry.scrollTop;
      view.requestMeasure();
    });
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
    const view = this.activeEntry()?.view;
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
    view.dispatch({
      selection: { anchor: fromUtf16, head: toUtf16 },
      effects: EditorView.scrollIntoView(fromUtf16, { y: "center" }),
    });
    view.focus();
    return true;
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

  detach(): void {
    const entry = this.activeEntry();
    if (!entry?.view) {
      this.activeId = null;
      return;
    }
    this.flushEntryChange(entry);
    entry.scrollLeft = entry.view.scrollDOM.scrollLeft;
    entry.scrollTop = entry.view.scrollDOM.scrollTop;
    entry.state = entry.view.state;
    const dom = entry.view.dom;
    entry.view.destroy();
    entry.view = null;
    dom.remove();
    this.activeId = null;
  }

  retain(tabIds: readonly string[]): void {
    const retained = new Set(tabIds);
    for (const tabId of this.entries.keys()) {
      if (!retained.has(tabId)) this.dispose(tabId);
    }
  }

  dispose(tabId: string): void {
    const entry = this.entries.get(tabId);
    if (!entry) return;
    if (this.activeId === tabId) this.detach();
    if (entry.changeFrame !== null) window.cancelAnimationFrame(entry.changeFrame);
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
    path: string,
    preferences: AppPreferences,
    onChange: (content: string) => void,
  ): CachedTextEditor {
    const readOnly = new Compartment();
    const editable = new Compartment();
    const language = new Compartment();
    const indent = new Compartment();
    const tabSize = new Compartment();
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
      languageLoader: new EditorLanguageLoader(),
      languageName: "Plain Text",
      languageStatus: "loading",
      onChange,
      changePending: false,
      changeFrame: null,
    };
    entry.state = EditorState.create({
      doc: entry.exactContent.text,
      extensions: [
        tabSize.of(EditorState.tabSize.of(preferences.editorTabSize)),
        indent.of(indentUnit.of(" ".repeat(preferences.editorIndentSize))),
        readOnly.of(EditorState.readOnly.of(this.readOnlyValue)),
        editable.of(EditorView.editable.of(!this.readOnlyValue)),
        language.of([]),
        lineNumbers(),
        foldGutter({ markerDOM: createFoldMarker }),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        asterlynEditorTheme,
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
          if (!update.docChanged) return;
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

  private loadLanguage(entry: CachedTextEditor): void {
    void entry.languageLoader.load(entry.path).then((result) => {
      if (!result || this.entries.get(entry.id) !== entry) return;
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
