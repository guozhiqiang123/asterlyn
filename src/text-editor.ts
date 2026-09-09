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
import { asterlynEditorTheme } from "./editor-theme";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
  type TextChange,
} from "./workbench/text-content";

export class TextEditor {
  private view: EditorView | null = null;
  private exactContent: ExactTextContent | null = null;
  private readonly readOnly = new Compartment();
  private readonly editable = new Compartment();
  private readOnlyValue = false;

  mount(parent: HTMLElement, content: string, onChange: () => void): void {
    this.destroy();
    this.exactContent = decodeExactText(content);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.exactContent.text,
        extensions: [
          EditorState.tabSize.of(4),
          this.readOnly.of(EditorState.readOnly.of(this.readOnlyValue)),
          this.editable.of(EditorView.editable.of(!this.readOnlyValue)),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          asterlynEditorTheme,
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
  }

  content(): string {
    return this.exactContent ? encodeExactText(this.exactContent) : "";
  }

  focus(): void {
    this.view?.focus();
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

  destroy(): void {
    this.view?.destroy();
    this.view = null;
    this.exactContent = null;
  }
}
