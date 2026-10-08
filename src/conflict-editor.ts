import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { MergeView } from "@codemirror/merge";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { asterlynSearch } from "./editor-search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorLanguageLoader } from "./editor-language.ts";
import { asterlynEditorTheme, asterlynSyntaxHighlighting } from "./editor-theme.ts";
import {
  createEditorChangeIndicators,
  editorChangeIndicatorCopy,
  type EditorChangeIndicators,
} from "./editor-change-indicators.ts";
import { LINE_AWARE_DIFF_CONFIG } from "./shared/diff-review/line-aware-diff.ts";
import { diffLineNumberGutter, type DiffGutterSide } from "./features/files-editor/editor-gutter.ts";
import { codeMirrorFocusOwnership } from "./features/files-editor/editor-runtime-shared.ts";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
  type TextChange,
} from "./features/files-editor/text-content.ts";
import {
  ConflictResolutionModel,
  type ConflictBulkApplyResult,
  type ConflictBulkApplyScope,
  type ConflictResolutionDecision,
  type ConflictResolutionSide,
  type ConflictSourceRange,
} from "./conflict-resolution-model.ts";
import { ConflictCollapseCoordinator, type ConflictCollapseSide } from "./conflict-collapse.ts";
import type { EditorCopy, GitOperationCopy } from "./localization/catalog.ts";
import type { GitConflictContent } from "./models.ts";
import { linkHorizontalScrollGroup, linkVerticalScrollByDocument } from "./presentation/linked-scroll.ts";
import { mergeDiffSemanticHighlighting } from "./merge-diff-highlighting.ts";
import type { EffectiveTheme } from "./presentation/presentation-environment.ts";
import type { AppPreferences } from "./preferences.ts";
import type { DiffPresentation } from "./diff-presentation.ts";
import { projectConflictDiff } from "./shared/diff-review/diff-review-projection.ts";
import type { DiffReviewSnapshot, DiffReviewSummary } from "./shared/diff-review/diff-review-model.ts";
import { createDiffReviewPaneHeaders } from "./shared/diff-review/diff-review-pane-header.ts";
import { attachSplitter } from "./presentation/splitter.ts";
import { createDiffReviewActionGroup } from "./shared/diff-review/diff-review-action-gutter.ts";
import {
  diffReviewBlockDecorations,
  setDiffReviewBlockDecorations,
} from "./shared/diff-review/diff-review-block-decoration.ts";
import type { DiffReviewBlock, DiffReviewPaneId } from "./shared/diff-review/diff-review-model.ts";
import { DiffReviewOverlay } from "./shared/diff-review/diff-review-overlay.ts";
import { CONFLICT_PANE_MIN_PERCENTAGE, conflictPaneLayout, normalizeConflictPercentages, resizeConflictOursPercentage } from "./shared/diff-review/conflict-diff-review-layout.ts";

interface ViewBinding {
  view: EditorView;
  language: Compartment;
  indent: Compartment;
  tabSize: Compartment;
  theme: Compartment;
  phrases: Compartment;
  whitespace: Compartment;
  changeIndicators: EditorChangeIndicators | null;
  referenceTracksResult: boolean;
  paneId: "ours" | "result" | "theirs";
}

interface ConflictScrollbars {
  readonly container: HTMLDivElement;
  readonly panes: readonly HTMLDivElement[];
  readonly contents: readonly HTMLDivElement[];
  readonly corner: HTMLDivElement;
  readonly resizeObserver: ResizeObserver;
}

/** Three-column conflict editor built from two synchronized merge projections. */
export class ConflictEditor {
  private leftMerge: MergeView | null = null;
  private rightMerge: MergeView | null = null;
  private scrollDispose: (() => void) | null = null;
  private diffScrollbars: ConflictScrollbars | null = null;
  private bindings: ViewBinding[] = [];
  private languageLoader = new EditorLanguageLoader();
  private languageActivation = 0;
  private exactResult: ExactTextContent = decodeExactText("");
  private serializedResult: string | null = "";
  private onChange: (content: string) => void = () => undefined;
  private changePending = false;
  private changeFrame: number | null = null;
  private synchronizing = false;
  private applyingConflictDecision = false;
  private resolutionModel: ConflictResolutionModel | null = null;
  private collapseCoordinator: ConflictCollapseCoordinator | null = null;
  private conflictControlObserver: MutationObserver | null = null;
  private preferences: AppPreferences | null = null;
  private readonly resultReadOnly = new Compartment();
  private readonly resultEditable = new Compartment();
  private resultReadOnlyValue = false;
  private theme: EffectiveTheme = "dark";
  private phrases: Readonly<Record<string, string>> = {};
  private activeReviewBlock = -1;
  private presentation: DiffPresentation = { layout: "split", showWhitespace: false };
  private splitDisposers: Array<() => void> = [];
  private conflictRoot: HTMLElement | null = null;
  private reviewOverlay: DiffReviewOverlay | null = null;

  mount(
    parent: HTMLElement,
    conflict: GitConflictContent,
    result: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    copy: GitOperationCopy,
    editorCopy: EditorCopy,
    onChange: (content: string) => void,
  ): void {
    this.destroy();
    this.preferences = { ...preferences };
    this.presentation = { ...presentation };
    this.exactResult = decodeExactText(result);
    this.serializedResult = result;
    this.onChange = onChange;

    const ours = decodeExactText(conflict.ours ?? "").text;
    const theirs = decodeExactText(conflict.theirs ?? "").text;
    const base = decodeExactText(conflict.base ?? "").text;
    this.resolutionModel = ConflictResolutionModel.create(base, ours, theirs, this.exactResult.text);
    this.activeReviewBlock = -1;
    this.collapseCoordinator = new ConflictCollapseCoordinator(base, ours, this.exactResult.text, theirs);
    const root = document.createElement("section");
    root.className = "conflict-three-pane";
    root.setAttribute("aria-label", copy.conflictInputs);
    const review = projectConflictDiff(this.resolutionModel.snapshots());
    root.dataset.oursChanges = String(review.blocks.filter((block) => block.actions.some((action) => action.side === "ours")).length);
    root.dataset.theirsChanges = String(review.blocks.filter((block) => block.actions.some((action) => action.side === "theirs")).length);
    root.innerHTML = `<div class="conflict-merge-content"><div class="conflict-left-merge"></div><div class="conflict-right-merge"></div></div>
    <div class="conflict-scrollbars" aria-hidden="true">
      <div class="conflict-scrollbar-pane"><div class="conflict-scrollbar-content"></div></div><div class="conflict-scrollbar-spacer"></div>
      <div class="conflict-scrollbar-pane"><div class="conflict-scrollbar-content"></div></div><div class="conflict-scrollbar-spacer"></div>
      <div class="conflict-scrollbar-pane"><div class="conflict-scrollbar-content"></div></div><div class="conflict-scrollbar-corner"></div>
    </div>`;
    root.prepend(createDiffReviewPaneHeaders([
      { id: "ours", label: copy.ours, count: Number(root.dataset.oursChanges) },
      { id: "result", label: copy.resolvedResult, writable: true, writableLabel: copy.editableResult },
      { id: "theirs", label: copy.theirs, count: Number(root.dataset.theirsChanges) },
    ], { actionGutters: true, className: "conflict-pane-labels" }));
    parent.replaceChildren(root);
    this.conflictRoot = root;

    const leftHost = root.querySelector<HTMLElement>(".conflict-left-merge")!;
    const rightHost = root.querySelector<HTMLElement>(".conflict-right-merge")!;
    const oursBinding = this.binding("ours");
    const primaryBinding = this.binding("result");
    const mirrorBinding = this.binding("result");
    const theirsBinding = this.binding("theirs");
    this.leftMerge = new MergeView({
      parent: leftHost,
      a: {
        doc: ours,
        extensions: this.extensions(oursBinding, false, editorCopy, "ours", undefined, "after", {
          reference: this.exactResult.text,
          documentSide: "a",
          overview: false,
          referenceTracksResult: true,
        }),
      },
      b: {
        doc: this.exactResult.text,
        extensions: this.extensions(primaryBinding, true, editorCopy, "result", "primary", "before", {
          reference: ours,
          documentSide: "b",
          overview: true,
          referenceTracksResult: false,
        }),
      },
      gutter: false,
      revertControls: "a-to-b",
      renderRevertControl: () => this.conflictControls("ours", "right", copy),
      diffConfig: LINE_AWARE_DIFF_CONFIG,
    });
    this.rightMerge = new MergeView({
      parent: rightHost,
      a: {
        doc: theirs,
        extensions: this.extensions(theirsBinding, false, editorCopy, "theirs", undefined, "before", {
          reference: this.exactResult.text,
          documentSide: "a",
          overview: true,
          referenceTracksResult: true,
        }),
      },
      b: {
        doc: this.exactResult.text,
        extensions: this.extensions(mirrorBinding, false, editorCopy, "result", "mirror", "after", {
          reference: theirs,
          documentSide: "b",
          overview: false,
          referenceTracksResult: false,
        }),
      },
      orientation: "b-a",
      gutter: false,
      revertControls: "a-to-b",
      renderRevertControl: () => this.conflictControls("theirs", "left", copy),
      diffConfig: LINE_AWARE_DIFF_CONFIG,
    });
    oursBinding.view = this.leftMerge.a;
    primaryBinding.view = this.leftMerge.b;
    mirrorBinding.view = this.rightMerge.b;
    theirsBinding.view = this.rightMerge.a;
    theirsBinding.view.dom.classList.add("conflict-theirs-pane");
    this.bindings.push(oursBinding, primaryBinding, mirrorBinding, theirsBinding);
    this.syncReviewDecorations();
    this.mountSplitLayout(root);
    for (const binding of this.bindings) this.collapseCoordinator.register(binding.view);
    this.observeConflictControls(root);
    this.mountScrollbars(root);
    this.mountReviewOverlay(root);
    this.syncReviewDecorations();
    this.loadLanguage(conflict.path);
  }

  content(): string {
    if (this.serializedResult === null) this.serializedResult = encodeExactText(this.exactResult);
    return this.serializedResult;
  }

  flushChanges(): void {
    if (this.changeFrame !== null) window.cancelAnimationFrame(this.changeFrame);
    this.changeFrame = null;
    if (!this.changePending) return;
    this.changePending = false;
    this.onChange(this.content());
  }

  openFindReplace(): boolean {
    const view = this.leftMerge?.b;
    return view ? openSearchPanel(view) : false;
  }

  reviewSnapshot(): DiffReviewSnapshot | null {
    return this.resolutionModel ? projectConflictDiff(this.resolutionModel.snapshots()) : null;
  }

  reviewSummary(): DiffReviewSummary | null {
    return this.reviewSnapshot()?.summary ?? null;
  }

  applyNonConflicting(scope: ConflictBulkApplyScope): ConflictBulkApplyResult {
    const result = this.leftMerge?.b;
    if (!result || !this.resolutionModel || this.resultReadOnlyValue) {
      return { changes: [], appliedBlocks: 0, skippedManualBlocks: 0 };
    }
    const bulk = this.resolutionModel.applyNonConflicting(scope, result.state.doc.toString());
    if (bulk.changes.length > 0) {
      this.applyingConflictDecision = true;
      try {
        result.dispatch({ changes: bulk.changes, userEvent: `input.conflict.bulk.${scope}` });
      } finally {
        this.applyingConflictDecision = false;
      }
    }
    this.syncConflictControls();
    this.syncReviewDecorations();
    return bulk;
  }

  unchangedExpanded(): boolean {
    return this.collapseCoordinator?.isExpanded() ?? true;
  }

  setUnchangedExpanded(expanded: boolean): void {
    this.collapseCoordinator?.setExpanded(expanded);
    this.requestMeasure();
  }

  navigateChange(direction: 1 | -1): boolean {
    const blocks = this.resolutionModel?.snapshots() ?? [];
    if (blocks.length === 0 || !this.leftMerge || !this.rightMerge) return false;
    const next = this.activeReviewBlock < 0
      ? direction === 1 ? 0 : blocks.length - 1
      : this.activeReviewBlock + direction;
    if (next < 0 || next >= blocks.length) return false;
    this.activeReviewBlock = next;
    const block = blocks[next]!;
    const targets = [
      { view: this.leftMerge.a, range: block.ours },
      { view: this.leftMerge.b, range: block.result },
      { view: this.rightMerge.b, range: block.result },
      { view: this.rightMerge.a, range: block.theirs },
    ];
    for (const { view, range } of targets) {
      const position = Math.min(view.state.doc.length, range.from);
      view.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: "center" }),
      });
    }
    this.leftMerge.b.focus();
    this.syncReviewDecorations();
    return true;
  }

  requestMeasure(): void {
    for (const binding of this.bindings) binding.view.requestMeasure();
    this.updateScrollbars();
  }

  setPreferences(preferences: AppPreferences): void {
    this.preferences = { ...preferences };
    for (const binding of this.bindings) {
      binding.view.dispatch({ effects: [
        binding.tabSize.reconfigure(EditorState.tabSize.of(preferences.editorTabSize)),
        binding.indent.reconfigure(indentUnit.of(" ".repeat(preferences.editorIndentSize))),
        binding.whitespace.reconfigure(preferences.showWhitespace
          ? [highlightWhitespace(), highlightTrailingWhitespace()]
          : []),
      ] });
    }
  }

  setTheme(theme: EffectiveTheme): void {
    this.theme = theme;
    for (const binding of this.bindings) {
      binding.view.dispatch({ effects: binding.theme.reconfigure(asterlynEditorTheme(theme)) });
    }
  }

  setPhrases(phrases: Readonly<Record<string, string>>): void {
    this.phrases = phrases;
    for (const binding of this.bindings) {
      binding.view.dispatch({ effects: binding.phrases.reconfigure(EditorState.phrases.of(phrases)) });
    }
  }

  setResultReadOnly(readOnly: boolean): void {
    this.resultReadOnlyValue = readOnly;
    const view = this.leftMerge?.b;
    if (view) view.dispatch({ effects: [
      this.resultReadOnly.reconfigure(EditorState.readOnly.of(readOnly)),
      this.resultEditable.reconfigure(EditorView.editable.of(!readOnly)),
    ] });
    for (const merge of [this.leftMerge, this.rightMerge]) {
      merge?.dom.classList.toggle("conflict-result-readonly", readOnly);
      for (const control of merge?.dom.querySelectorAll<HTMLButtonElement>(".conflict-change-controls button") ?? []) {
        control.disabled = readOnly;
      }
    }
    this.syncConflictControls();
  }

  destroy(): void {
    this.flushChanges();
    this.languageActivation += 1;
    this.languageLoader.cancel();
    this.scrollDispose?.();
    this.scrollDispose = null;
    this.diffScrollbars = null;
    for (const dispose of this.splitDisposers.splice(0)) dispose();
    this.conflictRoot = null;
    this.reviewOverlay?.destroy();
    this.reviewOverlay = null;
    this.collapseCoordinator?.destroy();
    this.collapseCoordinator = null;
    this.conflictControlObserver?.disconnect();
    this.conflictControlObserver = null;
    this.leftMerge?.destroy();
    this.rightMerge?.destroy();
    this.leftMerge = null;
    this.rightMerge = null;
    this.bindings = [];
    this.synchronizing = false;
    this.applyingConflictDecision = false;
    this.resolutionModel = null;
    this.activeReviewBlock = -1;
  }

  private extensions(
    binding: ViewBinding,
    editable: boolean,
    editorCopy: EditorCopy,
    collapseSide: ConflictCollapseSide,
    resultSide?: "primary" | "mirror",
    gutterSide: DiffGutterSide = "before",
    comparison?: {
      reference: string;
      documentSide: "a" | "b";
      overview: boolean;
      referenceTracksResult: boolean;
    },
  ): Extension[] {
    const preferences = this.preferences!;
    if (comparison) {
      binding.changeIndicators = createEditorChangeIndicators(
        comparison.reference,
        editorChangeIndicatorCopy(editorCopy),
        {
          gutterSide,
          overview: comparison.overview,
          documentSide: comparison.documentSide,
        },
      );
      binding.referenceTracksResult = comparison.referenceTracksResult;
    }
    return [
      binding.tabSize.of(EditorState.tabSize.of(preferences.editorTabSize)),
      binding.indent.of(indentUnit.of(" ".repeat(preferences.editorIndentSize))),
      binding.language.of([]),
      binding.theme.of(asterlynEditorTheme(this.theme)),
      binding.phrases.of(EditorState.phrases.of(this.phrases)),
      binding.whitespace.of(preferences.showWhitespace
        ? [highlightWhitespace(), highlightTrailingWhitespace()]
        : []),
      resultSide === "primary"
        ? this.resultReadOnly.of(EditorState.readOnly.of(this.resultReadOnlyValue))
        : EditorState.readOnly.of(!resultSide),
      resultSide === "primary"
        ? this.resultEditable.of(EditorView.editable.of(!this.resultReadOnlyValue))
        : EditorView.editable.of(editable),
      codeMirrorFocusOwnership,
      diffLineNumberGutter(gutterSide),
      binding.changeIndicators?.extension ?? [],
      this.collapseCoordinator?.extension(collapseSide) ?? [],
      mergeDiffSemanticHighlighting,
      diffReviewBlockDecorations,
      history(), drawSelection(), highlightActiveLine(),
      highlightActiveLineGutter(), asterlynSearch(), highlightSelectionMatches(), asterlynSyntaxHighlighting,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, { key: "Mod-f", run: openSearchPanel }]),
      resultSide ? EditorView.updateListener.of((update) => this.captureResult(update, resultSide)) : [],
    ];
  }

  private captureResult(update: ViewUpdate, source: "primary" | "mirror"): void {
    if (!update.docChanged || this.synchronizing) return;
    const changes: TextChange[] = [];
    update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ from, to, insert: inserted.toString() });
    });
    this.exactResult = applyExactTextChanges(this.exactResult, changes);
    if (!this.applyingConflictDecision) {
      this.resolutionModel?.observeManualChanges(
        changes,
        update.startState.doc.length,
        update.state.doc.toString(),
      );
    }
    this.serializedResult = null;
    this.changePending = true;
    for (const binding of this.bindings) {
      if (binding.referenceTracksResult && binding.changeIndicators) {
        binding.changeIndicators.setBaseline(binding.view, update.state.doc.toString());
      }
    }
    const target = source === "primary" ? this.rightMerge?.b : this.leftMerge?.b;
    if (target && target.state.doc.toString() !== update.state.doc.toString()) {
      this.synchronizing = true;
      target.dispatch({ changes });
      this.synchronizing = false;
    }
    if (this.changeFrame === null) {
      this.changeFrame = window.requestAnimationFrame(() => {
        this.changeFrame = null;
        this.flushChanges();
        this.syncConflictControls();
        this.syncReviewDecorations();
      });
    }
  }

  private loadLanguage(path: string): void {
    const activation = ++this.languageActivation;
    void this.languageLoader.load(path).then((result) => {
      if (!result?.support || activation !== this.languageActivation || !this.leftMerge) return;
      for (const binding of this.bindings) {
        binding.view.dispatch({ effects: binding.language.reconfigure(result.support) });
      }
    });
  }

  private binding(paneId: "ours" | "result" | "theirs"): ViewBinding {
    return {
      view: null as unknown as EditorView,
      language: new Compartment(), indent: new Compartment(), tabSize: new Compartment(),
      theme: new Compartment(), phrases: new Compartment(), whitespace: new Compartment(),
      changeIndicators: null,
      referenceTracksResult: false,
      paneId,
    };
  }

  private conflictControls(
    side: ConflictResolutionSide,
    direction: "left" | "right",
    copy: GitOperationCopy,
  ): HTMLDivElement {
    const applyId = side === "ours" ? "apply-ours" : "apply-theirs";
    const ignoreId = side === "ours" ? "ignore-ours" : "ignore-theirs";
    const group = createDiffReviewActionGroup(side, side === "ours" ? copy.ours : copy.theirs, [
      {
        id: applyId,
        label: side === "ours" ? copy.acceptOursChange : copy.acceptTheirsChange,
        icon: direction === "right" ? "double-chevron-right" : "double-chevron-left",
        className: "conflict-apply-change",
      },
      {
        id: ignoreId,
        label: side === "ours" ? copy.ignoreOursChange : copy.ignoreTheirsChange,
        icon: "close",
        className: "conflict-ignore-change",
      },
    ]);
    group.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const apply = group.querySelector<HTMLButtonElement>(`[data-review-action="${applyId}"]`)!;
    const ignore = group.querySelector<HTMLButtonElement>(`[data-review-action="${ignoreId}"]`)!;
    apply.dataset.decision = "accepted";
    ignore.dataset.decision = "ignored";
    for (const button of [apply, ignore]) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.activateConflictDecision(group, button.dataset.decision as "accepted" | "ignored");
      });
    }
    return group;
  }

  private activateConflictDecision(
    group: HTMLDivElement,
    decision: Exclude<ConflictResolutionDecision, "pending">,
  ): void {
    if (this.resultReadOnlyValue) return;
    const side = group.dataset.side as ConflictResolutionSide | undefined;
    const source = side ? this.sourceRangeForControl(group, side) : null;
    const result = this.leftMerge?.b;
    if (!side || !source || !result || !this.resolutionModel) return;
    const changes = this.resolutionModel.applyDecision(side, decision, source, result.state.doc.toString());
    if (changes.length === 0) {
      this.syncConflictControls();
      this.syncReviewDecorations();
      return;
    }
    this.applyingConflictDecision = true;
    try {
      result.dispatch({ changes, userEvent: `input.conflict.${decision}` });
    } finally {
      this.applyingConflictDecision = false;
    }
    this.syncConflictControls();
    this.syncReviewDecorations();
  }

  private sourceRangeForControl(
    group: HTMLDivElement,
    side: ConflictResolutionSide,
  ): ConflictSourceRange | null {
    const merge = side === "ours" ? this.leftMerge : this.rightMerge;
    const index = Number(group.dataset.chunk);
    const chunk = Number.isInteger(index) ? merge?.chunks[index] : null;
    if (!chunk) return null;
    return side === "ours"
      ? { from: chunk.fromA, to: chunk.endA }
      : { from: chunk.fromA, to: chunk.endA };
  }

  private observeConflictControls(root: HTMLElement): void {
    this.conflictControlObserver?.disconnect();
    this.conflictControlObserver = new MutationObserver(() => this.syncConflictControls());
    this.conflictControlObserver.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-chunk"],
    });
    window.requestAnimationFrame(() => this.syncConflictControls());
  }

  private syncConflictControls(): void {
    if (!this.resolutionModel) return;
    for (const merge of [this.leftMerge, this.rightMerge]) {
      merge?.dom.querySelectorAll<HTMLDivElement>(".conflict-change-controls[data-chunk]")
        .forEach((group) => {
          const side = group.dataset.side as ConflictResolutionSide | undefined;
          const source = side ? this.sourceRangeForControl(group, side) : null;
          const state = side && source ? this.resolutionModel?.decision(side, source) : null;
          group.hidden = state === null;
          for (const button of group.querySelectorAll<HTMLButtonElement>("button[data-decision]")) {
            const selected = button.dataset.decision === state;
            button.classList.toggle("is-selected", selected);
            button.setAttribute("aria-pressed", String(selected));
            button.disabled = this.resultReadOnlyValue;
          }
        });
    }
  }

  private syncReviewDecorations(): void {
    const snapshot = this.reviewSnapshot();
    if (!snapshot) return;
    const activeId = this.activeReviewBlock >= 0 ? snapshot.blocks[this.activeReviewBlock]?.id : null;
    this.reviewOverlay?.setSnapshot({ ...snapshot, activeBlockId: activeId });
    for (const binding of this.bindings) {
      const decorations = snapshot.blocks.flatMap((block) => {
        const range = block.ranges[binding.paneId];
        return range ? [{
          from: range.from,
          to: range.to,
          status: paneReviewStatus(block, binding.paneId),
          active: block.id === activeId,
        }] : [];
      });
      binding.view.dispatch({ effects: setDiffReviewBlockDecorations.of(decorations) });
    }
  }

  private mountReviewOverlay(root: HTMLElement): void {
    if (!this.leftMerge || !this.rightMerge) return;
    this.reviewOverlay?.destroy();
    this.reviewOverlay = new DiffReviewOverlay(root, {
      ours: this.leftMerge.a,
      result: this.leftMerge.b,
      theirs: this.rightMerge.a,
    }, [
      { from: "ours", to: "result" },
      { from: "result", to: "theirs" },
    ]);
  }

  private mountScrollbars(root: HTMLElement): void {
    if (!this.leftMerge || !this.rightMerge) return;
    const container = root.querySelector<HTMLDivElement>(".conflict-scrollbars")!;
    const panes = [...container.querySelectorAll<HTMLDivElement>(".conflict-scrollbar-pane")];
    const contents = [...container.querySelectorAll<HTMLDivElement>(".conflict-scrollbar-content")];
    const corner = container.querySelector<HTMLDivElement>(".conflict-scrollbar-corner")!;
    const scrollers = [
      this.leftMerge.a.scrollDOM,
      this.leftMerge.b.scrollDOM,
      this.rightMerge.a.scrollDOM,
    ];
    const resizeObserver = new ResizeObserver(() => {
      this.applySplitLayout();
      this.updateScrollbars();
    });
    this.diffScrollbars = { container, panes, contents, corner, resizeObserver };
    this.updateScrollbars();
    const disposeVertical = linkVerticalScrollByDocument(
      this.leftMerge.dom,
      this.rightMerge.dom,
      this.leftMerge.b,
      this.rightMerge.b,
    );
    const disposeHorizontal = linkHorizontalScrollGroup([...panes, ...scrollers]);
    resizeObserver.observe(this.leftMerge.dom);
    resizeObserver.observe(this.rightMerge.dom);
    resizeObserver.observe(root);
    for (const scroller of scrollers) resizeObserver.observe(scroller);
    this.scrollDispose = () => {
      disposeVertical();
      disposeHorizontal();
      resizeObserver.disconnect();
    };
  }

  private mountSplitLayout(root: HTMLElement): void {
    for (const dispose of this.splitDisposers.splice(0)) dispose();
    let ours = this.presentation.conflictOursPercentage ?? 27;
    let result = this.presentation.conflictResultPercentage ?? 46;
    ({ ours, result } = normalizeConflictPercentages(ours, result));
    this.presentation = {
      ...this.presentation,
      conflictOursPercentage: ours,
      conflictResultPercentage: result,
    };
    const first = document.createElement("div");
    first.className = "workbench-splitter vertical conflict-splitter conflict-splitter-ours";
    first.setAttribute("aria-label", "Resize Ours and Result");
    const second = document.createElement("div");
    second.className = "workbench-splitter vertical conflict-splitter conflict-splitter-theirs";
    second.setAttribute("aria-label", "Resize Result and Theirs");
    root.append(first, second);
    const contentWidth = () => conflictPaneLayout(root.clientWidth, ours, result).contentWidth;
    const apply = () => {
      this.presentation = {
        ...this.presentation,
        conflictOursPercentage: ours,
        conflictResultPercentage: result,
      };
      this.applySplitLayout();
    };
    this.splitDisposers.push(
      attachSplitter(first, {
        orientation: "vertical",
        getValue: () => contentWidth() * ours / 100,
        getRange: () => {
          const minimum = CONFLICT_PANE_MIN_PERCENTAGE / 100;
          return {
            minimum: contentWidth() * minimum,
            maximum: contentWidth() * ((ours + result) / 100 - minimum),
          };
        },
        onChange: (value) => {
          ({ ours, result } = resizeConflictOursPercentage(
            ours,
            result,
            value / contentWidth() * 100,
          ));
          apply();
          this.presentation.onConflictSplitPercentageChange?.(ours, result, false);
        },
        onCommit: () => this.presentation.onConflictSplitPercentageChange?.(ours, result, true),
        onReset: () => { ({ ours, result } = resizeConflictOursPercentage(ours, result, 27)); apply(); },
      }),
      attachSplitter(second, {
        orientation: "vertical",
        getValue: () => contentWidth() * (ours + result) / 100,
        getRange: () => ({
          minimum: contentWidth() * (ours + CONFLICT_PANE_MIN_PERCENTAGE) / 100,
          maximum: contentWidth() * (100 - CONFLICT_PANE_MIN_PERCENTAGE) / 100,
        }),
        onChange: (value) => {
          result = value / contentWidth() * 100 - ours;
          ({ ours, result } = normalizeConflictPercentages(ours, result));
          apply();
          this.presentation.onConflictSplitPercentageChange?.(ours, result, false);
        },
        onCommit: () => this.presentation.onConflictSplitPercentageChange?.(ours, result, true),
        onReset: () => { result = 46; ({ ours, result } = normalizeConflictPercentages(ours, result)); apply(); },
      }),
    );
    apply();
  }

  private applySplitLayout(): void {
    const root = this.conflictRoot;
    if (!root || !this.leftMerge) return;
    const layout = conflictPaneLayout(
      root.clientWidth,
      this.presentation.conflictOursPercentage ?? 27,
      this.presentation.conflictResultPercentage ?? 46,
    );
    const { oursWidth, resultWidth, theirsWidth } = layout;
    root.style.setProperty("--conflict-ours-width", `${oursWidth}px`);
    root.style.setProperty("--conflict-result-width", `${resultWidth}px`);
    root.style.setProperty("--conflict-theirs-width", `${theirsWidth}px`);
    const leftEditors = this.leftMerge.dom.querySelectorAll<HTMLElement>(".cm-mergeViewEditor");
    if (leftEditors[0]) leftEditors[0].style.flex = `0 0 ${oursWidth}px`;
    if (leftEditors[1]) leftEditors[1].style.flex = `0 0 ${resultWidth}px`;
    const theirsEditor = this.rightMerge?.a.dom.closest<HTMLElement>(".cm-mergeViewEditor");
    if (theirsEditor) theirsEditor.style.flex = `0 0 ${theirsWidth}px`;
    this.reviewOverlay?.schedule();
    this.requestMeasure();
  }

  private updateScrollbars(): void {
    if (!this.diffScrollbars || !this.leftMerge || !this.rightMerge) return;
    const scrollers = [
      this.leftMerge.a.scrollDOM,
      this.leftMerge.b.scrollDOM,
      this.rightMerge.a.scrollDOM,
    ];
    if (scrollers.some((scroller) => !scroller.isConnected)) return;
    const sharedWidth = Math.max(...scrollers.map((scroller) => scroller.scrollWidth));
    for (const content of this.diffScrollbars.contents) content.style.width = `${sharedWidth}px`;
    const verticalScrollbarWidth = Math.max(
      0,
      this.rightMerge.dom.offsetWidth - this.rightMerge.dom.clientWidth,
    );
    this.diffScrollbars.corner.style.width = `${verticalScrollbarWidth}px`;
    this.diffScrollbars.corner.style.flex = `0 0 ${verticalScrollbarWidth}px`;
    const hasOverflow = scrollers.some((scroller) => scroller.scrollWidth > scroller.clientWidth);
    this.diffScrollbars.container.style.display = hasOverflow ? "grid" : "none";
  }
}

function paneReviewStatus(
  block: DiffReviewBlock,
  paneId: Extract<DiffReviewPaneId, "ours" | "result" | "theirs">,
): DiffReviewBlock["status"] {
  if (paneId === "result") return block.status;
  const side = paneId;
  const accepted = block.actions.find((action) => action.side === side && action.id === `apply-${side}`);
  const ignored = block.actions.find((action) => action.side === side && action.id === `ignore-${side}`);
  if (accepted?.selected) return "accepted";
  if (ignored?.selected) return "ignored";
  return "pending";
}
