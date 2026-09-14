import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
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
  splitChangeBlocks,
  unifiedChangeBlocks,
  type DiffChangeBlock,
  type DiffDirection,
} from "./workbench/diff-navigation";
import {
  asterlynEditorTheme,
  asterlynSyntaxHighlighting,
} from "./editor-theme";
import type { EffectiveTheme } from "./presentation/presentation-environment";
import { EditorLanguageLoader } from "./editor-language";
import type { GitBlameResult } from "./models.ts";
import {
  blameGutter,
  closeGutterMenu,
  lineNumberGutter,
  type DiffGitBlameSources,
  type GitBlameCopy,
  type GitBlameRuntime,
  type GitBlameSource,
  type GutterBlameMenuState,
} from "./workbench/editor-gutter.ts";
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

const setActiveDiffBlock = StateEffect.define<DiffChangeBlock | null>();
const activeDiffBlockDecoration = StateField.define({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    const active = transaction.effects.find((effect) => effect.is(setActiveDiffBlock));
    if (!active) return decorations.map(transaction.changes);
    const block = active.value;
    if (block === null || block.fromLine > transaction.newDoc.lines) {
      return Decoration.none;
    }
    const fromLine = Math.max(1, block.fromLine);
    const toLine = Math.min(transaction.newDoc.lines, block.toLine);
    const ranges: Array<Range<Decoration>> = [];
    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      const line = transaction.newDoc.line(lineNumber);
      const classes = [
        "cm-diff-current-change",
        lineNumber === fromLine ? "cm-diff-current-change-start" : "",
        lineNumber === toLine ? "cm-diff-current-change-end" : "",
      ].filter(Boolean).join(" ");
      ranges.push(Decoration.line({ class: classes }).range(line.from));
    }
    return Decoration.set(ranges, true);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export class DiffEditor {
  private readonly views: EditorView[] = [];
  private readonly languageBindings: Array<{
    view: EditorView;
    compartment: Compartment;
    tabSize: Compartment;
    theme: Compartment;
    phrases: Compartment;
    blame: Compartment;
    side: "old" | "new" | null;
    sourceLine: (documentLine: number) => number | null;
  }> = [];
  private readonly languageLoader = new EditorLanguageLoader();
  private parent: HTMLElement | null = null;
  private sourceDocument = "";
  private sourcePath = "";
  private languageSupport: LanguageSupport | null = null;
  private languageName = "Plain Text";
  private languageStatus = "loading";
  private editorPreferences: AppPreferences = { ...DEFAULT_APP_PREFERENCES };
  private themeValue: EffectiveTheme = "dark";
  private phrasesValue: Readonly<Record<string, string>> = {};
  private presentation: DiffPresentation = {
    layout: "split",
    showWhitespace: false,
  };
  private splitDispose: (() => void) | null = null;
  private scrollDispose: (() => void) | null = null;
  private changeBlocks: DiffChangeBlock[] = [];
  private activeChangeStart: number | null = null;
  private blameSources: DiffGitBlameSources;
  private readonly blameState: Record<"old" | "new", {
    result: GitBlameResult | null;
    loading: boolean;
    generation: number;
  }> = {
    old: { result: null, loading: false, generation: 0 },
    new: { result: null, loading: false, generation: 0 },
  };

  constructor(
    private readonly blameRuntime: GitBlameRuntime,
    private blameCopy: GitBlameCopy,
  ) {
    this.blameSources = unavailableDiffBlameSources(blameCopy.gitBlameRequiresSplit);
  }

  mount(
    parent: HTMLElement,
    document: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    blameSources: DiffGitBlameSources,
  ): void {
    this.destroy();
    this.parent = parent;
    this.sourceDocument = document;
    this.sourcePath = path;
    this.editorPreferences = { ...preferences };
    this.presentation = { ...presentation };
    this.blameSources = blameSources;
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

  navigateChange(direction: DiffDirection): boolean {
    const target = this.activeChangeStart === null
      ? direction === 1
        ? this.changeBlocks[0]
        : this.changeBlocks.at(-1)
      : direction === 1
        ? this.changeBlocks.find((block) => block.fromLine > this.activeChangeStart!)
        : this.changeBlocks.slice().reverse().find((block) => block.fromLine < this.activeChangeStart!);
    if (!target) return false;
    this.activeChangeStart = target.fromLine;
    for (const view of this.views) {
      if (target.fromLine > view.state.doc.lines) continue;
      const line = view.state.doc.line(target.fromLine);
      view.dispatch({
        selection: { anchor: line.from },
        effects: [
          setActiveDiffBlock.of(target),
          EditorView.scrollIntoView(line.from, { y: "center" }),
        ],
      });
    }
    this.views[0]?.focus();
    return true;
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

  setTheme(theme: EffectiveTheme): void {
    if (this.themeValue === theme) return;
    this.themeValue = theme;
    for (const binding of this.languageBindings) {
      binding.view.dispatch({
        effects: binding.theme.reconfigure(asterlynEditorTheme(theme)),
      });
    }
  }

  setPhrases(phrases: Readonly<Record<string, string>>): void {
    this.phrasesValue = phrases;
    for (const binding of this.languageBindings) {
      binding.view.dispatch({
        effects: binding.phrases.reconfigure(EditorState.phrases.of(phrases)),
      });
    }
  }

  setBlameCopy(copy: GitBlameCopy): void {
    if (this.blameCopy === copy) return;
    this.blameCopy = copy;
    for (const side of ["old", "new"] as const) {
      const result = this.blameState[side].result;
      if (result) this.installBlame(side, result);
    }
  }

  private render(): void {
    const parent = this.parent;
    if (!parent) return;
    this.destroyViews();
    this.activeChangeStart = null;
    parent.replaceChildren();
    parent.classList.toggle("split-diff", this.presentation.layout === "split");

    if (this.presentation.layout === "unified") {
      this.changeBlocks = unifiedChangeBlocks(this.sourceDocument);
      this.views.push(this.createView(parent, this.sourceDocument));
      return;
    }

    const split = splitUnifiedDiff(this.sourceDocument);
    this.changeBlocks = splitChangeBlocks(split.rows);
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
    const theme = new Compartment();
    const phrases = new Compartment();
    const blame = new Compartment();
    const openBlameMenu = () => this.blameMenuState(side ?? null);
    const activeBlame = side ? this.blameState[side].result : null;
    const sourceLine = rows && side
      ? (documentLine: number) => rows[documentLine - 1]?.[side].lineNumber ?? null
      : (documentLine: number) => documentLine;
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      tabSize.of(EditorState.tabSize.of(this.editorPreferences.editorTabSize)),
      EditorView.editable.of(false),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      theme.of(asterlynEditorTheme(this.themeValue)),
      phrases.of(EditorState.phrases.of(this.phrasesValue)),
      blame.of(activeBlame
        ? blameGutter(activeBlame, this.blameCopy, openBlameMenu, sourceLine)
        : []),
      asterlynSyntaxHighlighting,
      language.of(this.languageSupport ?? []),
      activeDiffBlockDecoration,
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
        lineNumberGutter(
          openBlameMenu,
          (lineNumber) => rows[lineNumber - 1]?.[side].lineNumber?.toString() ?? "",
        ),
        sourceLineDecorations(rows, side),
      );
    } else {
      extensions.push(lineNumberGutter(openBlameMenu), unifiedLineDecorations);
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
    this.languageBindings.push({
      view,
      compartment: language,
      tabSize,
      theme,
      phrases,
      blame,
      side: side ?? null,
      sourceLine,
    });
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

  private blameMenuState(side: "old" | "new" | null): GutterBlameMenuState {
    const availability = side
      ? this.blameSources[side]
      : { source: null, unavailableReason: this.blameSources.unifiedReason };
    const state = side ? this.blameState[side] : null;
    return {
      active: Boolean(state?.result),
      loading: state?.loading ?? false,
      enabled: availability.source !== null,
      unavailableReason: availability.unavailableReason,
      copy: this.blameCopy,
      toggle: () => side ? this.toggleBlame(side) : undefined,
    };
  }

  private async toggleBlame(side: "old" | "new"): Promise<void> {
    const state = this.blameState[side];
    if (state.result || state.loading) {
      this.clearBlame(side);
      this.blameRuntime.status(this.blameCopy.gitBlameHidden, "information");
      return;
    }
    const source = this.blameSources[side].source;
    if (!source) return;
    const generation = ++state.generation;
    state.loading = true;
    this.blameRuntime.status(this.blameCopy.loadingGitBlame, "information");
    try {
      const result = await this.blameRuntime.load(source);
      if (
        generation !== state.generation ||
        !sameBlameSource(this.blameSources[side].source, source)
      ) return;
      state.loading = false;
      state.result = result;
      this.installBlame(side, result);
      const lines = result.hunks.reduce((total, hunk) => total + hunk.lineCount, 0);
      this.blameRuntime.status(
        result.truncated
          ? this.blameCopy.gitBlameLimited(lines)
          : this.blameCopy.gitBlameLoaded(lines),
        result.truncated ? "warning" : "information",
      );
    } catch (error) {
      if (generation !== state.generation) return;
      state.loading = false;
      this.blameRuntime.error(error);
    }
  }

  private installBlame(side: "old" | "new", result: GitBlameResult): void {
    for (const binding of this.languageBindings) {
      if (binding.side !== side) continue;
      binding.view.dispatch({
        effects: binding.blame.reconfigure(
          blameGutter(
            result,
            this.blameCopy,
            () => this.blameMenuState(side),
            binding.sourceLine,
          ),
        ),
      });
    }
  }

  private clearBlame(side: "old" | "new"): void {
    const state = this.blameState[side];
    state.generation += 1;
    state.loading = false;
    state.result = null;
    for (const binding of this.languageBindings) {
      if (binding.side === side) {
        binding.view.dispatch({ effects: binding.blame.reconfigure([]) });
      }
    }
  }

  private resetBlame(): void {
    for (const side of ["old", "new"] as const) {
      const state = this.blameState[side];
      state.generation += 1;
      state.loading = false;
      state.result = null;
    }
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
    closeGutterMenu();
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
    this.changeBlocks = [];
    this.activeChangeStart = null;
    this.resetBlame();
    this.blameSources = unavailableDiffBlameSources(this.blameCopy.gitBlameRequiresSplit);
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
  view.dom.style.setProperty(
    "--editor-letter-spacing",
    `${preferences.editorLetterSpacing}px`,
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

function unavailableDiffBlameSources(reason: string): DiffGitBlameSources {
  return {
    old: { source: null, unavailableReason: reason },
    new: { source: null, unavailableReason: reason },
    unifiedReason: reason,
  };
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
