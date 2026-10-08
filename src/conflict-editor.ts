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
  type ConflictResolutionDecision,
  type ConflictResolutionSide,
  type ConflictSourceRange,
} from "./conflict-resolution-model.ts";
import { adjacentConflictTarget } from "./conflict-navigation.ts";
import { conflictResolutionHistoryExtension, conflictResolutionHistoryState, conflictResolutionTransaction } from "./conflict-resolution-history.ts";
import { ConflictCollapseCoordinator, type ConflictCollapseSide } from "./conflict-collapse.ts";
import { ConflictSplitLayout } from "./conflict-split-layout.ts";
import { projectUnifiedConflictCards, setUnifiedConflictReview, unifiedConflictReviewExtension } from "./conflict-unified-review.ts";
import type { EditorCopy, GitOperationCopy } from "./localization/catalog.ts";
import type { GitConflictContent } from "./models.ts";
import { linkHorizontalScrollGroup, linkVerticalScrollByDocument } from "./presentation/linked-scroll.ts";
import { mergeDiffSemanticHighlighting } from "./merge-diff-highlighting.ts";
import type { EffectiveTheme } from "./presentation/presentation-environment.ts";
import type { AppPreferences } from "./preferences.ts";
import type { DiffPresentation } from "./diff-presentation.ts";
import { conflictActionGroupVisible, projectConflictDiff } from "./shared/diff-review/diff-review-projection.ts";
import type { DiffReviewSnapshot, DiffReviewSummary } from "./shared/diff-review/diff-review-model.ts";
import { createDiffReviewPaneHeaders } from "./shared/diff-review/diff-review-pane-header.ts";
import { createDiffReviewActionGroup } from "./shared/diff-review/diff-review-action-gutter.ts";
import {
  diffReviewBlockDecorations,
  setDiffReviewBlockDecorations,
} from "./shared/diff-review/diff-review-block-decoration.ts";
import type { DiffReviewBlock, DiffReviewPaneId } from "./shared/diff-review/diff-review-model.ts";
import { DiffReviewOverlay } from "./shared/diff-review/diff-review-overlay.ts";

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

/** Conflict editor with one persistent Result and split or unified three-way presentation. */
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
  private splitLayout: ConflictSplitLayout | null = null;
  private conflictRoot: HTMLElement | null = null;
  private reviewOverlay: DiffReviewOverlay | null = null;
  private ours = "";
  private theirs = "";
  private copy: GitOperationCopy | null = null;
  private readonly unifiedDecision = (
    side: ConflictResolutionSide,
    decision: Exclude<ConflictResolutionDecision, "pending">,
    source: ConflictSourceRange,
  ) => this.applyConflictDecision(side, decision, source);

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
    this.ours = ours;
    this.theirs = theirs;
    this.copy = copy;
    this.resolutionModel = ConflictResolutionModel.create(base, ours, theirs, this.exactResult.text);
    this.activeReviewBlock = -1;
    this.collapseCoordinator = new ConflictCollapseCoordinator(base, ours, this.exactResult.text, theirs);
    const root = document.createElement("section");
    root.className = `conflict-three-pane conflict-layout-${presentation.layout}`;
    root.setAttribute("aria-label", copy.conflictInputs);
    root.style.setProperty("--conflict-source-tab-size", String(preferences.editorTabSize));
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
    this.splitLayout = new ConflictSplitLayout(root, this.leftMerge, this.rightMerge, presentation, () => {
      this.reviewOverlay?.schedule();
      for (const binding of this.bindings) binding.view.requestMeasure();
      this.updateScrollbars();
    });
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

  unchangedExpanded(): boolean {
    return this.collapseCoordinator?.isExpanded() ?? true;
  }

  setUnchangedExpanded(expanded: boolean): void {
    this.collapseCoordinator?.setExpanded(expanded);
    this.requestMeasure();
  }

  navigateChange(direction: 1 | -1): boolean {
    const blocks = this.resolutionModel?.snapshots() ?? [];
    const result = this.leftMerge?.b;
    if (blocks.length === 0 || !result) return false;
    const target = adjacentConflictTarget(blocks, this.activeReviewBlock, direction);
    if (!target) return false;
    this.activeReviewBlock = target.index;
    const position = Math.min(result.state.doc.length, target.position);
    result.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
    result.focus();
    this.syncReviewDecorations();
    return true;
  }

  requestMeasure(): void {
    for (const binding of this.bindings) binding.view.requestMeasure();
    this.updateScrollbars();
  }

  setPreferences(preferences: AppPreferences): void {
    this.preferences = { ...preferences };
    this.conflictRoot?.style.setProperty("--conflict-source-tab-size", String(preferences.editorTabSize));
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

  setPresentation(presentation: DiffPresentation): void {
    this.presentation = { ...presentation };
    this.splitLayout?.setPresentation(presentation);
    this.conflictRoot?.classList.toggle("conflict-layout-unified", presentation.layout === "unified");
    this.conflictRoot?.classList.toggle("conflict-layout-split", presentation.layout === "split");
    this.syncUnifiedReview();
    this.requestMeasure();
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
    this.syncUnifiedReview();
  }

  destroy(): void {
    this.flushChanges();
    this.languageActivation += 1;
    this.languageLoader.cancel();
    this.scrollDispose?.();
    this.scrollDispose = null;
    this.diffScrollbars = null;
    this.splitLayout?.destroy();
    this.splitLayout = null;
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
    this.resolutionModel = null; this.activeReviewBlock = -1;
    this.copy = null; this.ours = ""; this.theirs = "";
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
      resultSide === "primary" ? unifiedConflictReviewExtension : [],
      resultSide === "primary" ? conflictResolutionHistoryExtension : [],
      history(), drawSelection(), highlightActiveLine(),
      highlightActiveLineGutter(), asterlynSearch(), highlightSelectionMatches(), asterlynSyntaxHighlighting,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, { key: "Mod-f", run: openSearchPanel }]),
      resultSide ? EditorView.updateListener.of((update) => this.captureResult(update, resultSide)) : [],
    ];
  }

  private captureResult(update: ViewUpdate, source: "primary" | "mirror"): void {
    if (this.synchronizing) return;
    const restored = conflictResolutionHistoryState(update.transactions);
    const decisionInput = update.transactions.some((transaction) => transaction.isUserEvent("input.conflict"));
    if (!update.docChanged) {
      if (restored && this.resolutionModel?.restoreHistoryState(restored)) {
        this.syncConflictControls(); this.syncReviewDecorations();
        this.onChange(this.content());
      }
      return;
    }
    const changes: TextChange[] = [];
    update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ from, to, insert: inserted.toString() });
    });
    this.exactResult = applyExactTextChanges(this.exactResult, changes);
    const historyRestored = restored && (decisionInput
      ? this.resolutionModel?.restoreHistoryState(restored)
      : this.resolutionModel?.observeHistoryChanges(changes, update.startState.doc.length, restored));
    if (!decisionInput && !historyRestored) {
      this.resolutionModel?.observeManualChanges(
        changes,
        update.startState.doc.length,
        update.state.doc.toString(),
      );
    }
    this.serializedResult = null; this.changePending = true;
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
    const side = group.dataset.side as ConflictResolutionSide | undefined;
    const source = side ? this.sourceRangeForControl(group, side) : null;
    if (!side || !source) return;
    this.applyConflictDecision(side, decision, source);
  }

  private applyConflictDecision(
    side: ConflictResolutionSide,
    decision: Exclude<ConflictResolutionDecision, "pending">,
    source: ConflictSourceRange,
  ): void {
    const result = this.leftMerge?.b;
    if (this.resultReadOnlyValue || !result || !this.resolutionModel) return;
    const before = this.resolutionModel.historyState();
    const changes = this.resolutionModel.applyDecision(side, decision, source, result.state.doc.toString());
    result.dispatch(conflictResolutionTransaction(
      before, this.resolutionModel.historyState(), changes, `input.conflict.${decision}`,
    ));
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
          group.hidden = !conflictActionGroupVisible(state);
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
    this.syncUnifiedReview(snapshot, activeId);
  }

  private syncUnifiedReview(snapshot = this.reviewSnapshot(), activeBlockId: string | null = null): void {
    const result = this.leftMerge?.b;
    const model = this.resolutionModel;
    if (!result || !model) return;
    const review = snapshot && this.copy && this.presentation.layout === "unified"
      ? {
          cards: projectUnifiedConflictCards(model.snapshots(), { ...snapshot, activeBlockId }, this.ours, this.theirs),
          copy: this.copy,
          readOnly: this.resultReadOnlyValue,
          decide: this.unifiedDecision,
        }
      : null;
    result.dispatch({ effects: setUnifiedConflictReview.of(review) });
  }

  private mountReviewOverlay(root: HTMLElement): void {
    if (!this.leftMerge || !this.rightMerge) return;
    this.reviewOverlay?.destroy();
    const viewport = root.querySelector<HTMLElement>(".conflict-merge-content") ?? root;
    this.reviewOverlay = new DiffReviewOverlay(root, {
      ours: this.leftMerge.a,
      result: this.leftMerge.b,
      theirs: this.rightMerge.a,
    }, [
      { from: "ours", to: "result" },
      { from: "result", to: "theirs" },
    ], viewport);
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
      this.splitLayout?.apply();
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
