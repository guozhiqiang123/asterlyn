import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  type Extension,
  type Range,
} from "@codemirror/state";
import type { LanguageSupport } from "@codemirror/language";
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
import {
  splitUnifiedDiff,
  type DiffPresentation,
  type SourceDiffRow,
} from "./diff-presentation";
import { attachSplitter } from "./workbench/splitter";
import { linkScrollElements } from "./workbench/linked-scroll";
import {
  asterlynEditorTheme,
  asterlynSyntaxHighlighting,
} from "./editor-theme";
import { EditorLanguageLoader } from "./editor-language";
import {
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
} from "./workbench/preferences";

const unifiedLineDecorations = EditorView.decorations.compute(["doc"], (state) => {
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

export class DiffEditor {
  private readonly views: EditorView[] = [];
  private readonly languageBindings: Array<{
    view: EditorView;
    compartment: Compartment;
    tabSize: Compartment;
  }> = [];
  private readonly languageLoader = new EditorLanguageLoader();
  private parent: HTMLElement | null = null;
  private sourceDocument = "";
  private sourcePath = "";
  private languageSupport: LanguageSupport | null = null;
  private languageName = "Plain Text";
  private languageStatus = "loading";
  private editorPreferences: AppPreferences = { ...DEFAULT_APP_PREFERENCES };
  private presentation: DiffPresentation = {
    layout: "split",
    showWhitespace: false,
  };
  private splitDispose: (() => void) | null = null;
  private scrollDispose: (() => void) | null = null;

  mount(
    parent: HTMLElement,
    document: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation = this.presentation,
  ): void {
    this.destroy();
    this.parent = parent;
    this.sourceDocument = document;
    this.sourcePath = path;
    this.editorPreferences = { ...preferences };
    this.presentation = { ...presentation };
    this.render();
    void this.loadLanguage(parent, path);
  }

  setPresentation(presentation: DiffPresentation): void {
    const previousLayout = this.presentation.layout;
    const scroll = this.captureScroll();
    this.presentation = { ...presentation };
    if (!this.parent) return;
    this.render();
    window.requestAnimationFrame(() => {
      for (const view of this.views) {
        const maximum = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
        view.scrollDOM.scrollTop = maximum * scroll.topRatio;
        view.scrollDOM.scrollLeft =
          previousLayout === this.presentation.layout ? scroll.left : 0;
      }
    });
  }

  requestMeasure(): void {
    for (const view of this.views) view.requestMeasure();
  }

  setPreferences(preferences: AppPreferences): void {
    this.editorPreferences = { ...preferences };
    for (const binding of this.languageBindings) {
      applyEditorPreferences(binding.view, preferences);
      binding.view.dispatch({
        effects: binding.tabSize.reconfigure(
          EditorState.tabSize.of(preferences.editorTabSize),
        ),
      });
    }
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
    let splitPercentage = clampPercentage(this.presentation.splitPercentage ?? 50);
    grid.style.setProperty("--diff-before-width", `${splitPercentage}%`);
    const oldHost = this.createPane(grid, "Before · bounded patch", "old");
    const divider = window.document.createElement("div");
    divider.className = "workbench-splitter vertical diff-splitter";
    divider.setAttribute("aria-label", "Resize Diff sides");
    grid.append(divider);
    const newHost = this.createPane(grid, "After · bounded patch", "new");
    parent.append(grid);
    this.splitDispose = attachSplitter(divider, {
      orientation: "vertical",
      getValue: () =>
        (Math.max(1, grid.getBoundingClientRect().width) * splitPercentage) / 100,
      getRange: () => {
        const width = Math.max(1, grid.getBoundingClientRect().width);
        return { minimum: width * 0.25, maximum: width * 0.75 };
      },
      onChange: (value) => {
        const width = Math.max(1, grid.getBoundingClientRect().width);
        splitPercentage = clampPercentage((value / width) * 100);
        grid.style.setProperty("--diff-before-width", `${splitPercentage}%`);
        this.presentation = { ...this.presentation, splitPercentage };
        this.presentation.onSplitPercentageChange?.(splitPercentage, false);
        this.requestMeasure();
      },
      onCommit: () => {
        this.presentation.onSplitPercentageChange?.(splitPercentage, true);
      },
      onReset: () => {
        splitPercentage = 50;
        grid.style.setProperty("--diff-before-width", "50%");
        this.presentation = { ...this.presentation, splitPercentage };
      },
    });
    const oldView = this.createView(oldHost, split.oldDocument, split.rows, "old");
    const newView = this.createView(newHost, split.newDocument, split.rows, "new");
    this.views.push(oldView, newView);
    this.scrollDispose = linkScrollElements(oldView.scrollDOM, newView.scrollDOM);
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

  private createView(
    parent: HTMLElement,
    document: string,
    rows?: SourceDiffRow[],
    side?: "old" | "new",
  ): EditorView {
    const language = new Compartment();
    const tabSize = new Compartment();
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      tabSize.of(EditorState.tabSize.of(this.editorPreferences.editorTabSize)),
      EditorView.editable.of(false),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      asterlynEditorTheme,
      asterlynSyntaxHighlighting,
      language.of(this.languageSupport ?? []),
      keymap.of([
        ...searchKeymap,
        {
          key: "Mod-f",
          run: openSearchPanel,
        },
      ]),
    ];
    if (rows && side) {
      extensions.push(
        lineNumbers({
          formatNumber: (lineNumber) =>
            rows[lineNumber - 1]?.[side].lineNumber?.toString() ?? "",
        }),
        sourceLineDecorations(rows, side),
      );
    } else {
      extensions.push(lineNumbers(), unifiedLineDecorations);
    }
    if (this.presentation.layout === "unified") {
      extensions.push(EditorView.lineWrapping);
    }
    if (this.presentation.showWhitespace) {
      extensions.push(highlightWhitespace(), highlightTrailingWhitespace());
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: document,
        extensions,
      }),
    });
    this.languageBindings.push({ view, compartment: language, tabSize });
    applyEditorPreferences(view, this.editorPreferences);
    this.describeLanguage(view);
    return view;
  }

  private async loadLanguage(parent: HTMLElement, path: string): Promise<void> {
    const result = await this.languageLoader.load(path);
    if (!result || this.parent !== parent || this.sourcePath !== path) return;
    this.languageSupport = result.support;
    this.languageName = result.name;
    this.languageStatus = result.status;
    for (const binding of this.languageBindings) {
      this.describeLanguage(binding.view);
      if (result.support) {
        binding.view.dispatch({
          effects: binding.compartment.reconfigure(result.support),
        });
      }
    }
  }

  private describeLanguage(view: EditorView): void {
    view.dom.dataset.language = this.languageName;
    view.dom.dataset.languageStatus = this.languageStatus;
  }

  private captureScroll(): { topRatio: number; left: number } {
    const first = this.views[0]?.scrollDOM;
    const maximum = first ? Math.max(0, first.scrollHeight - first.clientHeight) : 0;
    return {
      topRatio: first && maximum > 0 ? first.scrollTop / maximum : 0,
      left: first?.scrollLeft ?? 0,
    };
  }

  private destroyViews(): void {
    this.scrollDispose?.();
    this.scrollDispose = null;
    this.splitDispose?.();
    this.splitDispose = null;
    for (const view of this.views) view.destroy();
    this.views.length = 0;
    this.languageBindings.length = 0;
  }

  destroy(): void {
    this.languageLoader.cancel();
    this.destroyViews();
    this.parent?.classList.remove("split-diff");
    this.parent = null;
    this.sourceDocument = "";
    this.sourcePath = "";
    this.languageSupport = null;
    this.languageName = "Plain Text";
    this.languageStatus = "loading";
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

function sourceLineDecorations(
  rows: SourceDiffRow[],
  side: "old" | "new",
): Extension {
  return EditorView.decorations.compute(["doc"], (state) => {
    const decorations: Array<Range<Decoration>> = [];
    for (const [index, row] of rows.entries()) {
      if (index >= state.doc.lines) break;
      const line = state.doc.line(index + 1);
      const sourceSide = row[side];
      const className = sourceLineClass(row, side);
      if (className) {
        decorations.push(Decoration.line({ class: className }).range(line.from));
      }
      const markClass =
        side === "old" ? "cm-source-word-removed" : "cm-source-word-added";
      for (const range of sourceSide.changed) {
        if (range.to <= range.from || range.from >= line.length) continue;
        decorations.push(
          Decoration.mark({ class: markClass }).range(
            line.from + range.from,
            line.from + Math.min(line.length, range.to),
          ),
        );
      }
    }
    return Decoration.set(decorations, true);
  });
}

function sourceLineClass(row: SourceDiffRow, side: "old" | "new"): string {
  if (row.kind === "omitted") return "cm-source-omitted";
  if (row.kind === "notice") return "cm-source-notice";
  if (row[side].lineNumber === null) return "cm-source-spacer";
  if (side === "old" && (row.kind === "removed" || row.kind === "modified")) {
    return "cm-source-removed";
  }
  if (side === "new" && (row.kind === "added" || row.kind === "modified")) {
    return "cm-source-added";
  }
  return "";
}

function clampPercentage(value: number): number {
  return Math.min(75, Math.max(25, value));
}
