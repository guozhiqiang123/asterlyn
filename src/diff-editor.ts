import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import type { LanguageSupport } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
} from "@codemirror/view";
import {
  highlightSelectionMatches,
  searchKeymap,
} from "@codemirror/search";
import { asterlynSearch } from "./editor-search";
import {
  parseUnifiedDiff,
  splitUnifiedDiff,
  type DiffPresentation,
  type DiffSideLabels,
  type SourceDiffRow,
  type UnifiedDiffRow,
} from "./diff-presentation";
import { attachSplitter } from "./presentation/splitter";
import { linkScrollElements } from "./presentation/linked-scroll";
import {
  handleOmittedDiffExpansion,
  splitChangeBlocks,
  unifiedDiffChangeBlocks,
  type DiffChangeBlock,
  type DiffDirection,
} from "./features/files-editor/diff-navigation";
import { createDiffSideLabels, createDiffUnifiedLabel, createReadOnlyDiffPane } from "./features/files-editor/diff-side-labels.ts";
import {
  asterlynEditorTheme,
  asterlynSyntaxHighlighting,
} from "./editor-theme";
import { gitBlameContextSession } from "./features/files-editor/editor-gutter-context-actions.ts";
import type { EffectiveTheme } from "./presentation/presentation-environment";
import type { ContextMenuPort } from "./shared/context-menu/context-menu-model.ts";
import { EditorLanguageLoader } from "./editor-language";
import type { GitBlameResult } from "./models.ts";
import {
  blameContentContextMenu,
  blameGutter,
  lineNumberGutter,
  type DiffGitBlameSources,
  type GitBlameCopy,
  type GitBlameRuntime,
} from "./features/files-editor/editor-gutter.ts";
import {
  applyEditorPreferences,
  sameBlameSource,
} from "./features/files-editor/editor-runtime-shared.ts";
import {
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
} from "./preferences";
import {
  renderOverviewRuler,
  splitOverviewBlocks,
  unifiedChangeGutter,
  unifiedLineDecorations,
  unifiedOverviewBlocks,
  type DiffOverviewBlock,
} from "./diff-overview-ruler";
import { removeOverviewRuler } from "./features/files-editor/change-overview-surface.ts";

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
  private sideLabels: DiffSideLabels = { before: "Before", after: "After" };
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
  private ruler: HTMLDivElement | null = null;
  private onExpandUnchanged: (() => void) | null = null;

  constructor(
    private readonly blameRuntime: GitBlameRuntime,
    private blameCopy: GitBlameCopy,
    private readonly contextMenu: ContextMenuPort,
    private readonly contextOwnerId: string,
  ) {
    this.blameSources = unavailableDiffBlameSources(blameCopy.gitBlameRequiresSplit);
  }

  mount(
    parent: HTMLElement,
    document: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    sideLabels: DiffSideLabels,
    blameSources: DiffGitBlameSources,
    onExpandUnchanged: () => void,
    restoredScroll?: { topRatio: number; scrollTop: number; left: number } | null,
  ): void {
    const isSamePath = this.parent === parent || this.sourcePath === path;
    const scroll = restoredScroll ?? (isSamePath ? this.captureScroll() : null);
    const previousLayout = this.presentation.layout;
    this.destroy();
    this.parent = parent;
    this.sourceDocument = document;
    this.sourcePath = path;
    this.editorPreferences = { ...preferences };
    this.presentation = { ...presentation };
    this.sideLabels = { ...sideLabels };
    this.blameSources = blameSources;
    this.onExpandUnchanged = onExpandUnchanged;
    this.render();
    if (scroll) {
      this.restoreScroll(scroll, previousLayout === this.presentation.layout);
    }
    void this.loadLanguage(parent, path);
  }

  setPresentation(presentation: DiffPresentation): void {
    const previousLayout = this.presentation.layout;
    const scroll = this.captureScroll();
    this.presentation = { ...presentation };
    if (!this.parent) return;
    this.render();
    this.restoreScroll(scroll, previousLayout === this.presentation.layout);
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

    const onSelect = (block: DiffOverviewBlock) => {
      this.activeChangeStart = block.fromLine;
      for (const view of this.views) {
        if (block.fromLine > view.state.doc.lines) continue;
        const line = view.state.doc.line(block.fromLine);
        view.dispatch({
          selection: { anchor: line.from },
          effects: [
            setActiveDiffBlock.of({ fromLine: block.fromLine, toLine: block.toLine }),
            EditorView.scrollIntoView(line.from, { y: "center" }),
          ],
        });
      }
      this.views[0]?.focus();
    };

    if (this.presentation.layout === "unified") {
      const unified = parseUnifiedDiff(this.sourceDocument);
      this.changeBlocks = unifiedDiffChangeBlocks(unified.rows);
      const grid = window.document.createElement("div");
      grid.className = "diff-unified-grid";
      grid.append(createDiffUnifiedLabel(this.sideLabels, window.document));
      const host = window.document.createElement("div");
      host.className = "diff-editor-host";
      grid.append(host);
      parent.append(grid);
      const view = this.createView(host, unified.document, undefined, undefined, unified.rows);
      this.views.push(view);
      const blocks = unifiedOverviewBlocks(unified.rows, view);
      if (blocks.length > 0) {
        this.ruler = renderOverviewRuler(parent, view.state.doc.lines, blocks, onSelect);
      }
      return;
    }

    const split = splitUnifiedDiff(this.sourceDocument);
    this.changeBlocks = splitChangeBlocks(split.rows);
    const grid = window.document.createElement("div");
    grid.className = "diff-split-grid";
    let splitPercentage = clampPercentage(this.presentation.splitPercentage ?? 50);
    grid.style.setProperty("--diff-before-width", `${splitPercentage}%`);
    grid.append(createDiffSideLabels(this.sideLabels, window.document));
    const oldHost = createReadOnlyDiffPane(
      grid, this.sideLabels.before, "old", window.document,
    );
    const divider = window.document.createElement("div");
    divider.className = "workbench-splitter vertical diff-splitter";
    divider.setAttribute("aria-label", "Resize Diff sides");
    grid.append(divider);
    const newHost = createReadOnlyDiffPane(
      grid, this.sideLabels.after, "new", window.document,
    );
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

    const blocks = splitOverviewBlocks(split.rows, newView);
    if (blocks.length > 0) {
      this.ruler = renderOverviewRuler(parent, newView.state.doc.lines, blocks, onSelect);
    }
  }

  private createView(
    parent: HTMLElement,
    document: string,
    rows?: SourceDiffRow[],
    side?: "old" | "new",
    unifiedRows?: readonly UnifiedDiffRow[],
  ): EditorView {
    const language = new Compartment();
    const tabSize = new Compartment();
    const theme = new Compartment();
    const phrases = new Compartment();
    const blame = new Compartment();
    const openBlameMenu = (event: MouseEvent, view: EditorView) =>
      this.openBlameMenu(side ?? null, event, view);
    const activeBlame = side ? this.blameState[side].result : null;
    const sourceLine = rows && side
      ? (documentLine: number) => rows[documentLine - 1]?.[side].lineNumber ?? null
      : unifiedRows
        ? (documentLine: number) => unifiedRows[documentLine - 1]?.newLineNumber ?? unifiedRows[documentLine - 1]?.oldLineNumber ?? null
        : (documentLine: number) => documentLine;
    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      tabSize.of(EditorState.tabSize.of(this.editorPreferences.editorTabSize)),
      EditorView.editable.of(false),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      asterlynSearch(),
      highlightSelectionMatches(),
      theme.of(asterlynEditorTheme(this.themeValue)),
      phrases.of(EditorState.phrases.of(this.phrasesValue)),
      blameContentContextMenu(openBlameMenu),
      blame.of(activeBlame
        ? blameGutter(activeBlame, this.blameCopy, openBlameMenu, sourceLine)
        : []),
      asterlynSyntaxHighlighting,
      language.of(this.languageSupport ?? []),
      activeDiffBlockDecoration,
      EditorView.domEventHandlers({
        click: (event) => handleOmittedDiffExpansion(
          event.target,
          () => this.onExpandUnchanged?.(),
        ),
      }),
      keymap.of([
        ...searchKeymap.filter((binding) => binding.key !== "Mod-f"),
      ]),
    ];
    if (rows && side) {
      extensions.push(
        lineNumberGutter(
          openBlameMenu,
          (lineNumber) => rows[lineNumber - 1]?.[side].lineNumber?.toString() ?? "",
          side === "old" ? "after" : "before",
        ),
        sourceChangeGutter(rows, side),
        sourceLineDecorations(rows, side),
      );
    } else if (unifiedRows) {
      extensions.push(
        lineNumberGutter(
          openBlameMenu,
          (lineNumber) => {
            const r = unifiedRows[lineNumber - 1];
            if (!r || r.kind === "omitted" || r.kind === "notice") return "";
            return (r.newLineNumber ?? r.oldLineNumber)?.toString() ?? "";
          },
          "before",
        ),
        unifiedChangeGutter(unifiedRows),
        unifiedLineDecorations(unifiedRows),
      );
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
    view.dom.tabIndex = -1;
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

  private openBlameMenu(
    side: "old" | "new" | null,
    event: MouseEvent,
    view: EditorView,
  ): void {
    const availability = side
      ? this.blameSources[side]
      : { source: null, unavailableReason: this.blameSources.unifiedReason };
    const state = side ? this.blameState[side] : null;
    const source = availability.source;
    const generation = state?.generation ?? -1;
    const active = Boolean(state?.result);
    const loading = state?.loading ?? false;
    const isCurrent = () => {
      const currentAvailability = side
        ? this.blameSources[side]
        : { source: null, unavailableReason: this.blameSources.unifiedReason };
      const currentState = side ? this.blameState[side] : null;
      return this.languageBindings.some(
        (binding) => binding.view === view && binding.side === side,
      ) &&
        sameBlameSource(source, currentAvailability.source) &&
        generation === (currentState?.generation ?? -1) &&
        active === Boolean(currentState?.result) &&
        loading === (currentState?.loading ?? false);
    };
    this.contextMenu.open(
      { x: event.clientX, y: event.clientY },
      gitBlameContextSession(this.contextOwnerId, {
        active,
        loading,
        enabled: source !== null,
        unavailableReason: availability.unavailableReason,
        copy: this.blameCopy,
        isCurrent,
        toggle: () => side ? this.toggleBlame(side) : undefined,
        blocked: (reason) => this.blameRuntime.status(reason, "warning"),
        restoreFocus: () => {
          if (this.languageBindings.some((binding) => binding.view === view)) view.dom.focus();
        },
      }),
    );
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
            (event, view) => this.openBlameMenu(side, event, view),
            binding.sourceLine,
          ),
        ),
      });
    }
  }

  private clearBlame(side: "old" | "new"): void {
    this.contextMenu.close(this.contextOwnerId);
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

  currentPath(): string {
    return this.sourcePath;
  }

  captureScroll(): { topRatio: number; scrollTop: number; left: number } {
    const first = this.views[0]?.scrollDOM;
    const maximum = first ? Math.max(0, first.scrollHeight - first.clientHeight) : 0;
    return {
      topRatio: first && maximum > 0 ? first.scrollTop / maximum : 0,
      scrollTop: first?.scrollTop ?? 0,
      left: first?.scrollLeft ?? 0,
    };
  }

  private restoreScroll(
    scroll: { topRatio: number; scrollTop: number; left: number },
    preserveExact: boolean,
  ): void {
    let attempts = 0;
    const apply = () => {
      if (!this.parent || this.views.length === 0) return;
      for (const view of this.views) {
        const dom = view.scrollDOM;
        const max = Math.max(0, dom.scrollHeight - dom.clientHeight);
        if (max > 0 || attempts >= 5) {
          dom.scrollTop = preserveExact ? Math.min(max, scroll.scrollTop) : max * scroll.topRatio;
        } else {
          dom.scrollTop = scroll.scrollTop;
        }
        dom.scrollLeft = preserveExact ? scroll.left : 0;
      }
      const first = this.views[0]?.scrollDOM;
      if (first && preserveExact && first.scrollTop < scroll.scrollTop && attempts < 5) {
        attempts += 1;
        window.requestAnimationFrame(apply);
      }
    };
    apply();
    window.requestAnimationFrame(apply);
  }

  private destroyViews(): void {
    this.contextMenu.close(this.contextOwnerId);
    this.scrollDispose?.();
    this.scrollDispose = null;
    this.splitDispose?.();
    this.splitDispose = null;
    removeOverviewRuler(this.ruler);
    this.ruler = null;
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
    this.onExpandUnchanged = null;
    this.resetBlame();
    this.blameSources = unavailableDiffBlameSources(this.blameCopy.gitBlameRequiresSplit);
  }
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
      for (const range of sourceSide.changed) {
        if (range.to <= range.from || range.from >= line.length) continue;
        decorations.push(
          Decoration.mark({ class: inlineChangeClass(range.kind) }).range(
            line.from + range.from,
            line.from + Math.min(line.length, range.to),
          ),
        );
      }
    }
    return Decoration.set(decorations, true);
  });
}

function sourceChangeGutter(
  rows: SourceDiffRow[],
  side: "old" | "new",
): Extension {
  return gutter({
    class: "cm-change-indicator-gutter cm-source-change-indicator-gutter",
    side: side === "old" ? "after" : "before",
    initialSpacer: () => new SourceChangeGutterMarker(null),
    lineMarker: (view, line) => {
      const row = rows[view.state.doc.lineAt(line.from).number - 1];
      if (!row || row[side].lineNumber === null) return null;
      const kind = row.kind === "modified"
        ? "modified"
        : side === "old" && row.kind === "removed"
          ? "deleted"
          : side === "new" && row.kind === "added"
            ? "added"
            : null;
      return kind ? new SourceChangeGutterMarker(kind) : null;
    },
  });
}

class SourceChangeGutterMarker extends GutterMarker {
  readonly elementClass: string;

  constructor(private readonly kind: "added" | "modified" | "deleted" | null) {
    super();
    this.elementClass = kind
      ? `cm-change-gutter-element cm-change-${kind}`
      : "cm-change-gutter-element";
  }

  eq(other: SourceChangeGutterMarker): boolean {
    return other.kind === this.kind;
  }

  toDOM(): Node {
    const marker = document.createElement("span");
    marker.className = "cm-change-gutter-marker";
    marker.textContent = this.kind === "deleted" ? "−" : "";
    return marker;
  }
}

function sourceLineClass(row: SourceDiffRow, side: "old" | "new"): string {
  if (row.kind === "omitted") return "cm-source-omitted";
  if (row.kind === "notice") return "cm-source-notice";
  if (row[side].lineNumber === null) return "cm-source-spacer";
  if (row.kind === "modified") return "cm-source-modified";
  if (side === "old" && row.kind === "removed") {
    return "cm-source-removed";
  }
  if (side === "new" && row.kind === "added") {
    return "cm-source-added";
  }
  return "";
}

function inlineChangeClass(kind: "added" | "removed" | "modified"): string {
  if (kind === "modified") return "cm-source-word-modified";
  return kind === "removed" ? "cm-source-word-removed" : "cm-source-word-added";
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
