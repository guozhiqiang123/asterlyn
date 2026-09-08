import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
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

const diffLineDecorations = EditorView.decorations.compute(["doc"], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const text = line.text;
    let className = "";
    if (text.startsWith("+") && !text.startsWith("+++")) {
      className = "cm-diff-added";
    } else if (text.startsWith("-") && !text.startsWith("---")) {
      className = "cm-diff-removed";
    } else if (text.startsWith("@@")) {
      className = "cm-diff-hunk";
    } else if (
      text.startsWith("diff --git") ||
      text.startsWith("index ") ||
      text.startsWith("---") ||
      text.startsWith("+++") ||
      text.startsWith("new file") ||
      text.startsWith("deleted file")
    ) {
      className = "cm-diff-meta";
    }
    if (className) builder.add(line.from, line.from, Decoration.line({ class: className }));
  }
  return builder.finish();
});

const asterlynTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "#dfe1e5",
      backgroundColor: "#1e1f22",
      fontSize: "12px",
    },
    ".cm-content": {
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      padding: "10px 0 40px",
      caretColor: "#a8c7fa",
    },
    ".cm-line": { padding: "0 14px" },
    ".cm-scroller": { overflow: "auto", lineHeight: "1.62" },
    ".cm-gutters": {
      color: "#6f737b",
      backgroundColor: "#1e1f22",
      borderRight: "1px solid #2b2d30",
    },
    ".cm-activeLineGutter": { backgroundColor: "#26282c" },
    ".cm-activeLine": { backgroundColor: "#26282c80" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#214283 !important",
    },
    ".cm-searchMatch": { backgroundColor: "#725b19", outline: "none" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#9c7320" },
    ".cm-panels": { backgroundColor: "#2b2d30", color: "#dfe1e5" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid #393b40" },
    ".cm-panel.cm-search": { padding: "6px 10px" },
    ".cm-textfield": {
      backgroundColor: "#1e1f22",
      color: "#dfe1e5",
      border: "1px solid #4e5157",
      borderRadius: "4px",
    },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "#393b40",
      color: "#dfe1e5",
      border: "1px solid #4e5157",
      borderRadius: "4px",
    },
    ".cm-diff-added": { backgroundColor: "#29443666", color: "#b8e2c4" },
    ".cm-diff-removed": { backgroundColor: "#5b2d3266", color: "#f0b8bd" },
    ".cm-diff-hunk": { backgroundColor: "#233d6166", color: "#a8c7fa" },
    ".cm-diff-meta": { color: "#858a94", fontStyle: "italic" },
  },
  { dark: true },
);

export class DiffEditor {
  private view: EditorView | null = null;

  mount(parent: HTMLElement, document: string): void {
    this.destroy();
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: document,
        extensions: [
          EditorState.readOnly.of(true),
          EditorState.tabSize.of(4),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          diffLineDecorations,
          asterlynTheme,
          keymap.of([
            ...searchKeymap,
            {
              key: "Mod-f",
              run: openSearchPanel,
            },
          ]),
        ],
      }),
    });
  }

  destroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}

