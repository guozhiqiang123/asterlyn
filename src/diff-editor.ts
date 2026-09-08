import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap,
} from "@codemirror/search";
import { splitUnifiedDiff, type DiffPresentation } from "./diff-presentation";

const diffLineDecorations = EditorView.decorations.compute(["doc"], (state) => {
  const builder = new RangeSetBuilder<Decoration>();
  let inHunk = false;
  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const text = line.text;
    let className = "";
    if (text.startsWith("diff --git ")) inHunk = false;
    if (text.startsWith("@@")) inHunk = true;
    if (text.startsWith("+") && (inHunk || !text.startsWith("+++ "))) {
      className = "cm-diff-added";
    } else if (text.startsWith("-") && (inHunk || !text.startsWith("--- "))) {
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
  private readonly views: EditorView[] = [];
  private parent: HTMLElement | null = null;
  private sourceDocument = "";
  private presentation: DiffPresentation = {
    layout: "unified",
    showWhitespace: false,
  };

  mount(
    parent: HTMLElement,
    document: string,
    presentation: DiffPresentation = this.presentation,
  ): void {
    this.destroy();
    this.parent = parent;
    this.sourceDocument = document;
    this.presentation = { ...presentation };
    this.render();
  }

  setPresentation(presentation: DiffPresentation): void {
    const previousLayout = this.presentation.layout;
    const scroll = this.captureScroll();
    this.presentation = { ...presentation };
    if (!this.parent) return;
    this.render();
    window.requestAnimationFrame(() => {
      for (const [index, view] of this.views.entries()) {
        const maximum = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
        view.scrollDOM.scrollTop = maximum * scroll.topRatio;
        view.scrollDOM.scrollLeft =
          previousLayout === this.presentation.layout ? (scroll.left[index] ?? 0) : 0;
      }
    });
  }

  private render(): void {
    const parent = this.parent;
    if (!parent) return;
    this.destroyViews();
    parent.replaceChildren();
    parent.classList.toggle("split-diff", this.presentation.layout === "split");

    if (this.presentation.layout === "unified") {
      this.views.push(this.createView(parent, this.sourceDocument));
      return;
    }

    const split = splitUnifiedDiff(this.sourceDocument);
    const grid = window.document.createElement("div");
    grid.className = "diff-split-grid";
    const oldHost = this.createPane(grid, "Before", "old");
    const newHost = this.createPane(grid, "After", "new");
    parent.append(grid);
    const oldView = this.createView(oldHost, split.oldDocument);
    const newView = this.createView(newHost, split.newDocument);
    this.views.push(oldView, newView);
    this.synchronizeVerticalScroll(oldView, newView);
  }

  private createPane(
    parent: HTMLElement,
    label: string,
    side: "old" | "new",
  ): HTMLElement {
    const pane = window.document.createElement("section");
    pane.className = `diff-pane diff-pane-${side}`;
    pane.setAttribute("aria-label", `${label} side of patch`);
    const heading = window.document.createElement("div");
    heading.className = "diff-pane-label";
    heading.textContent = label;
    const host = window.document.createElement("div");
    host.className = "diff-editor-host";
    pane.append(heading, host);
    parent.append(pane);
    return host;
  }

  private createView(parent: HTMLElement, document: string): EditorView {
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      EditorState.tabSize.of(4),
      EditorView.editable.of(false),
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
    ];
    if (this.presentation.layout === "unified") {
      extensions.push(EditorView.lineWrapping);
    }
    if (this.presentation.showWhitespace) {
      extensions.push(highlightWhitespace(), highlightTrailingWhitespace());
    }

    return new EditorView({
      parent,
      state: EditorState.create({
        doc: document,
        extensions,
      }),
    });
  }

  private synchronizeVerticalScroll(first: EditorView, second: EditorView): void {
    let synchronizing = false;
    const mirror = (source: HTMLElement, target: HTMLElement) => {
      if (synchronizing) return;
      synchronizing = true;
      target.scrollTop = source.scrollTop;
      window.requestAnimationFrame(() => {
        synchronizing = false;
      });
    };
    first.scrollDOM.addEventListener("scroll", () => mirror(first.scrollDOM, second.scrollDOM));
    second.scrollDOM.addEventListener("scroll", () => mirror(second.scrollDOM, first.scrollDOM));
  }

  private captureScroll(): { topRatio: number; left: number[] } {
    const first = this.views[0]?.scrollDOM;
    const maximum = first ? Math.max(0, first.scrollHeight - first.clientHeight) : 0;
    return {
      topRatio: first && maximum > 0 ? first.scrollTop / maximum : 0,
      left: this.views.map((view) => view.scrollDOM.scrollLeft),
    };
  }

  private destroyViews(): void {
    for (const view of this.views) view.destroy();
    this.views.length = 0;
  }

  destroy(): void {
    this.destroyViews();
    this.parent?.classList.remove("split-diff");
    this.parent = null;
    this.sourceDocument = "";
  }
}
