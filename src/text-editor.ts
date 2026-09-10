import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap,
} from "@codemirror/search";
import {
  asterlynEditorTheme,
  asterlynSyntaxHighlighting,
} from "./editor-theme";
import { EditorLanguageLoader } from "./editor-language";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
  type TextChange,
} from "./workbench/text-content";
import type { AppPreferences } from "./workbench/preferences";

export class TextEditor {
  private view: EditorView | null = null;
  private exactContent: ExactTextContent | null = null;
  private readonly readOnly = new Compartment();
  private readonly editable = new Compartment();
  private readonly language = new Compartment();
  private readonly tabSize = new Compartment();
  private readonly languageLoader = new EditorLanguageLoader();
  private readOnlyValue = false;

  mount(
    parent: HTMLElement,
    content: string,
    path: string,
    preferences: AppPreferences,
    onChange: () => void,
  ): void {
    this.destroy();
    this.exactContent = decodeExactText(content);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.exactContent.text,
        extensions: [
          this.tabSize.of(EditorState.tabSize.of(preferences.editorTabSize)),
          this.readOnly.of(EditorState.readOnly.of(this.readOnlyValue)),
          this.editable.of(EditorView.editable.of(!this.readOnlyValue)),
          this.language.of([]),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          asterlynEditorTheme,
          asterlynSyntaxHighlighting,
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            { key: "Mod-f", run: openSearchPanel },
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || !this.exactContent) return;
            const changes: TextChange[] = [];
            update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
              changes.push({ from, to, insert: inserted.toString() });
            });
            this.exactContent = applyExactTextChanges(this.exactContent, changes);
            onChange();
          }),
        ],
      }),
    });
    const mountedView = this.view;
    applyEditorPreferences(mountedView, preferences);
    mountedView.dom.dataset.language = "Plain Text";
    mountedView.dom.dataset.languageStatus = "loading";
    void this.languageLoader.load(path).then((result) => {
      if (!result || this.view !== mountedView) return;
      mountedView.dom.dataset.languageStatus = result.status;
      if (!result.support) {
        mountedView.dom.dataset.language =
          result.status === "failed" ? "Plain Text" : result.name;
        return;
      }
      mountedView.dom.dataset.language = result.name;
      mountedView.dispatch({
        effects: this.language.reconfigure(result.support),
      });
    });
  }

  content(): string {
    return this.exactContent ? encodeExactText(this.exactContent) : "";
  }

  focus(): void {
    this.view?.focus();
  }

  openFindReplace(): boolean {
    return this.view ? openSearchPanel(this.view) : false;
  }

  selectRange(fromUtf16: number, toUtf16: number): boolean {
    if (!this.view) return false;
    const length = this.view.state.doc.length;
    if (
      !Number.isInteger(fromUtf16) ||
      !Number.isInteger(toUtf16) ||
      fromUtf16 < 0 ||
      toUtf16 < fromUtf16 ||
      toUtf16 > length
    ) {
      return false;
    }
    this.view.dispatch({
      selection: { anchor: fromUtf16, head: toUtf16 },
      effects: EditorView.scrollIntoView(fromUtf16, { y: "center" }),
    });
    this.view.focus();
    return true;
  }

  requestMeasure(): void {
    this.view?.requestMeasure();
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnlyValue = readOnly;
    this.view?.dispatch({
      effects: [
        this.readOnly.reconfigure(EditorState.readOnly.of(readOnly)),
        this.editable.reconfigure(EditorView.editable.of(!readOnly)),
      ],
    });
  }

  setPreferences(preferences: AppPreferences): void {
    if (!this.view) return;
    applyEditorPreferences(this.view, preferences);
    this.view.dispatch({
      effects: this.tabSize.reconfigure(
        EditorState.tabSize.of(preferences.editorTabSize),
      ),
    });
  }

  destroy(): void {
    this.languageLoader.cancel();
    this.view?.destroy();
    this.view = null;
    this.exactContent = null;
  }
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
}
