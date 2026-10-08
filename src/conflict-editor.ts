import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { MergeView, diff } from "@codemirror/merge";
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
import { LINE_AWARE_DIFF_CONFIG } from "./features/files-editor/line-aware-diff.ts";
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
import { ConflictCollapseCoordinator, type ConflictCollapseSide } from "./conflict-collapse.ts";
import type { EditorCopy, GitOperationCopy } from "./localization/catalog.ts";
import type { GitConflictContent } from "./models.ts";
import { icon } from "./icons.ts";
import { linkHorizontalScrollGroup, linkVerticalScrollByDocument } from "./presentation/linked-scroll.ts";
import { mergeDiffSemanticHighlighting } from "./merge-diff-highlighting.ts";
import type { EffectiveTheme } from "./presentation/presentation-environment.ts";
import type { AppPreferences } from "./preferences.ts";

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

  mount(
    parent: HTMLElement,
    conflict: GitConflictContent,
    result: string,
    preferences: AppPreferences,
    copy: GitOperationCopy,
    editorCopy: EditorCopy,
    onChange: (content: string) => void,
  ): void {
    this.destroy();
    this.preferences = { ...preferences };
    this.exactResult = decodeExactText(result);
    this.serializedResult = result;
    this.onChange = onChange;

    const ours = decodeExactText(conflict.ours ?? "").text;
    const theirs = decodeExactText(conflict.theirs ?? "").text;
    const base = decodeExactText(conflict.base ?? "").text;
    this.resolutionModel = ConflictResolutionModel.create(base, ours, theirs, this.exactResult.text);
    this.collapseCoordinator = new ConflictCollapseCoordinator(base, ours, this.exactResult.text, theirs);
    const root = document.createElement("section");
    root.className = "conflict-three-pane";
    root.setAttribute("aria-label", copy.conflictInputs);
    root.dataset.oursChanges = String(diff(base, ours, { scanLimit: 1_000, timeout: 250 }).length);
    root.dataset.theirsChanges = String(diff(base, theirs, { scanLimit: 1_000, timeout: 250 }).length);
    root.innerHTML = `<header class="conflict-pane-labels">
      <strong>${escapeHtml(copy.ours)}<small>${root.dataset.oursChanges}</small></strong><span></span>
      <strong>${escapeHtml(copy.resolvedResult)}</strong><span></span>
      <strong>${escapeHtml(copy.theirs)}<small>${root.dataset.theirsChanges}</small></strong>
    </header><div class="conflict-merge-content"><div class="conflict-left-merge"></div><div class="conflict-right-merge"></div></div>
    <div class="conflict-scrollbars" aria-hidden="true">
      <div class="conflict-scrollbar-pane"><div class="conflict-scrollbar-content"></div></div><div class="conflict-scrollbar-spacer"></div>
      <div class="conflict-scrollbar-pane"><div class="conflict-scrollbar-content"></div></div><div class="conflict-scrollbar-spacer"></div>
      <div class="conflict-scrollbar-pane"><div class="conflict-scrollbar-content"></div></div><div class="conflict-scrollbar-corner"></div>
    </div>`;
    parent.replaceChildren(root);

    const leftHost = root.querySelector<HTMLElement>(".conflict-left-merge")!;
    const rightHost = root.querySelector<HTMLElement>(".conflict-right-merge")!;
    const oursBinding = this.binding();
    const primaryBinding = this.binding();
    const mirrorBinding = this.binding();
    const theirsBinding = this.binding();
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
    for (const binding of this.bindings) this.collapseCoordinator.register(binding.view);
    this.observeConflictControls(root);
    this.mountScrollbars(root);
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

  private binding(): ViewBinding {
    return {
      view: null as unknown as EditorView,
      language: new Compartment(), indent: new Compartment(), tabSize: new Compartment(),
      theme: new Compartment(), phrases: new Compartment(), whitespace: new Compartment(),
      changeIndicators: null,
      referenceTracksResult: false,
    };
  }

  private conflictControls(
    side: ConflictResolutionSide,
    direction: "left" | "right",
    copy: GitOperationCopy,
  ): HTMLDivElement {
    const group = document.createElement("div");
    group.className = "conflict-change-controls";
    group.dataset.side = side;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", side === "ours" ? copy.ours : copy.theirs);
    group.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const apply = this.conflictActionButton(
      "accepted",
      side === "ours" ? copy.acceptOursChange : copy.acceptTheirsChange,
      direction === "right" ? "double-chevron-right" : "double-chevron-left",
    );
    const ignore = this.conflictActionButton(
      "ignored",
      side === "ours" ? copy.ignoreOursChange : copy.ignoreTheirsChange,
      "close",
    );
    for (const button of [apply, ignore]) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.activateConflictDecision(group, button.dataset.decision as "accepted" | "ignored");
      });
    }
    group.append(apply, ignore);
    return group;
  }

  private conflictActionButton(
    decision: Exclude<ConflictResolutionDecision, "pending">,
    label: string,
    iconName: "double-chevron-right" | "double-chevron-left" | "close",
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `diff-change-control conflict-${decision === "accepted" ? "apply" : "ignore"}-change`;
    button.dataset.decision = decision;
    button.innerHTML = icon(iconName, 15);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", "false");
    return button;
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
      return;
    }
    this.applyingConflictDecision = true;
    try {
      result.dispatch({ changes, userEvent: `input.conflict.${decision}` });
    } finally {
      this.applyingConflictDecision = false;
    }
    this.syncConflictControls();
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
    const resizeObserver = new ResizeObserver(() => this.updateScrollbars());
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
    this.diffScrollbars.corner.style.flex = `0 0 ${verticalScrollbarWidth}px`;
    const hasOverflow = scrollers.some((scroller) => scroller.scrollWidth > scroller.clientWidth);
    this.diffScrollbars.container.style.display = hasOverflow ? "grid" : "none";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
