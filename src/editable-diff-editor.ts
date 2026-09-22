import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { MergeView, getOriginalDoc, goToNextChunk, goToPreviousChunk, originalDocChangeEffect, unifiedMergeView } from "@codemirror/merge";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { asterlynSearch } from "./editor-search";
import { ChangeSet, Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightTrailingWhitespace,
  highlightWhitespace,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from "@codemirror/view";
import { EditorLanguageLoader } from "./editor-language.ts";
import { asterlynEditorTheme, asterlynSyntaxHighlighting } from "./editor-theme.ts";
import { diffLineNumberGutter, type DiffGutterSide } from "./features/files-editor/editor-gutter.ts";
import { linkHorizontalScroll } from "./presentation/linked-scroll.ts";
import type { DiffPresentation } from "./diff-presentation.ts";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
  type TextChange,
} from "./features/files-editor/text-content.ts";
import type { EditorCopy } from "./localization/catalog.ts";
import type { EffectiveTheme } from "./presentation/presentation-environment.ts";
import type { AppPreferences } from "./preferences.ts";
import {
  createEditorChangeIndicators,
  editorChangeIndicatorCopy,
  type EditorChangeIndicators,
} from "./editor-change-indicators.ts";

interface ViewBinding {
  view: EditorView;
  language: Compartment;
  indent: Compartment;
  tabSize: Compartment;
  theme: Compartment;
  phrases: Compartment;
  whitespace: Compartment;
  changeIndicators: EditorChangeIndicators | null;
  comparisonSide: "a" | "b" | null;
}

interface DiffScrollbars {
  container: HTMLDivElement;
  paneA: HTMLDivElement;
  contentA: HTMLDivElement;
  paneB: HTMLDivElement;
  contentB: HTMLDivElement;
  corner: HTMLDivElement;
  resizeObserver: ResizeObserver;
}

/**
 * A worktree Diff adapter. The repository side is immutable and the current
 * side projects the existing editor-session buffer. It never writes a file;
 * save ownership remains with EditorSessionController.
 */
export class EditableDiffEditor {
  private parent: HTMLElement | null = null;
  private mergeView: MergeView | null = null;
  private unifiedView: EditorView | null = null;
  private bindings: ViewBinding[] = [];
  private languageLoader = new EditorLanguageLoader();
  private languageActivation = 0;
  private exactContent: ExactTextContent = decodeExactText("");
  private serializedContent: string | null = "";
  private baseContent = "";
  private path = "";
  private presentation: DiffPresentation = { layout: "split", showWhitespace: false };
  private expandedUnchanged = false;
  private preferences: AppPreferences | null = null;
  private theme: EffectiveTheme = "dark";
  private phrases: Readonly<Record<string, string>> = {};
  private onChange: (content: string) => void = () => undefined;
  private onRevert: (() => void) | null = null;
  private copy: EditorCopy;
  private scrollDispose: (() => void) | null = null;
  private diffScrollbars: DiffScrollbars | null = null;
  private changePending = false;
  private changeFrame: number | null = null;
  private synchronizing = false;

  constructor(copy: EditorCopy) {
    this.copy = copy;
  }

  currentPath(): string {
    return this.path;
  }

  captureScroll(): { topRatio: number; scrollTop: number; left: number } {
    if (this.mergeView) {
      const dom = this.mergeView.dom;
      const max = Math.max(0, dom.scrollHeight - dom.clientHeight);
      return {
        topRatio: max > 0 ? dom.scrollTop / max : 0,
        scrollTop: dom.scrollTop,
        left: this.mergeView.b.scrollDOM.scrollLeft,
      };
    }
    if (this.unifiedView) {
      const dom = this.unifiedView.scrollDOM;
      const max = Math.max(0, dom.scrollHeight - dom.clientHeight);
      return {
        topRatio: max > 0 ? dom.scrollTop / max : 0,
        scrollTop: dom.scrollTop,
        left: dom.scrollLeft,
      };
    }
    return { topRatio: 0, scrollTop: 0, left: 0 };
  }

  mount(
    parent: HTMLElement,
    baseContent: string,
    currentContent: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    expandedUnchanged: boolean,
    onChange: (content: string) => void,
    onRevert?: () => void,
    restoredScroll?: { topRatio: number; scrollTop: number; left: number } | null,
  ): void {
    const isSamePath = this.path === path;
    const canUpdateInPlace =
      this.parent === parent &&
      isSamePath &&
      this.presentation.layout === presentation.layout &&
      this.expandedUnchanged === expandedUnchanged &&
      (this.mergeView !== null || this.unifiedView !== null);

    if (canUpdateInPlace) {
      const scroll = restoredScroll ?? this.captureScroll();
      this.flushChanges();
      this.onChange = onChange;
      this.onRevert = onRevert ?? null;
      this.preferences = { ...preferences };
      this.setPreferences(preferences);

      const baseChanged = this.baseContent !== baseContent;
      const contentChanged = this.serializedContent !== currentContent;
      this.baseContent = baseContent;
      this.exactContent = decodeExactText(currentContent);
      this.serializedContent = currentContent;

      this.synchronizing = true;
      try {
        if (this.mergeView) {
          if (baseChanged && this.mergeView.a.state.doc.toString() !== baseContent) {
            const change = computeTextChange(this.mergeView.a.state.doc.toString(), baseContent);
            if (change) this.mergeView.a.dispatch({ changes: change });
          }
          if (contentChanged && this.mergeView.b.state.doc.toString() !== this.exactContent.text) {
            const change = computeTextChange(this.mergeView.b.state.doc.toString(), this.exactContent.text);
            if (change) this.mergeView.b.dispatch({ changes: change });
          }
          if (baseChanged) {
            for (const binding of this.bindings) {
              if (binding.comparisonSide === "a" && binding.changeIndicators) {
                binding.changeIndicators.setBaseline(binding.view, baseContent);
              }
            }
          }
          this.updateScrollbars();
        } else if (this.unifiedView) {
          if (contentChanged && this.unifiedView.state.doc.toString() !== this.exactContent.text) {
            const change = computeTextChange(this.unifiedView.state.doc.toString(), this.exactContent.text);
            if (change) this.unifiedView.dispatch({ changes: change });
          }
          if (baseChanged) {
            const origDoc = getOriginalDoc(this.unifiedView.state);
            const change = computeTextChange(origDoc.toString(), baseContent);
            if (change) {
              const changes = ChangeSet.of(change, origDoc.length);
              this.unifiedView.dispatch({
                effects: originalDocChangeEffect(this.unifiedView.state, changes),
              });
            }
          }
        }
      } finally {
        this.synchronizing = false;
      }
      this.restoreScroll(scroll, true);
      return;
    }

    const scroll = restoredScroll ?? (isSamePath ? this.captureScroll() : null);
    const previousLayout = this.presentation.layout;
    this.destroy();
    this.parent = parent;
    this.baseContent = baseContent;
    this.exactContent = decodeExactText(currentContent);
    this.serializedContent = currentContent;
    this.path = path;
    this.preferences = { ...preferences };
    this.presentation = { ...presentation };
    this.expandedUnchanged = expandedUnchanged;
    this.onChange = onChange;
    this.onRevert = onRevert ?? null;
    this.render();
    if (scroll) {
      this.restoreScroll(scroll, previousLayout === this.presentation.layout);
    }
    this.loadLanguage();
  }

  private restoreScroll(
    scroll: { topRatio: number; scrollTop: number; left: number },
    preserveExact: boolean,
  ): void {
    let attempts = 0;
    const apply = () => {
      if (!this.parent) return;
      if (this.mergeView) {
        const dom = this.mergeView.dom;
        const max = Math.max(0, dom.scrollHeight - dom.clientHeight);
        if (max > 0 || attempts >= 5) {
          dom.scrollTop = preserveExact ? Math.min(max, scroll.scrollTop) : max * scroll.topRatio;
        } else {
          dom.scrollTop = scroll.scrollTop;
        }
        this.mergeView.b.scrollDOM.scrollLeft = preserveExact ? scroll.left : 0;
        if (preserveExact && dom.scrollTop < scroll.scrollTop && max > dom.scrollTop && attempts < 5) {
          attempts += 1;
          window.requestAnimationFrame(apply);
        }
      } else if (this.unifiedView) {
        const dom = this.unifiedView.scrollDOM;
        const max = Math.max(0, dom.scrollHeight - dom.clientHeight);
        if (max > 0 || attempts >= 5) {
          dom.scrollTop = preserveExact ? Math.min(max, scroll.scrollTop) : max * scroll.topRatio;
        } else {
          dom.scrollTop = scroll.scrollTop;
        }
        dom.scrollLeft = preserveExact ? scroll.left : 0;
        if (preserveExact && dom.scrollTop < scroll.scrollTop && max > dom.scrollTop && attempts < 5) {
          attempts += 1;
          window.requestAnimationFrame(apply);
        }
      }
    };
    apply();
    window.requestAnimationFrame(apply);
  }

  content(): string {
    if (this.serializedContent === null) {
      this.serializedContent = encodeExactText(this.exactContent);
    }
    return this.serializedContent;
  }

  flushChanges(): void {
    if (this.changeFrame !== null) {
      window.cancelAnimationFrame(this.changeFrame);
      this.changeFrame = null;
    }
    if (!this.changePending) return;
    this.changePending = false;
    this.onChange(this.content());
  }

  openFindReplace(): boolean {
    return openSearchPanel(this.currentView());
  }

  navigateChange(direction: 1 | -1): boolean {
    const view = this.currentView();
    return direction === 1 ? goToNextChunk(view) : goToPreviousChunk(view);
  }

  requestMeasure(): void {
    for (const binding of this.bindings) binding.view.requestMeasure();
    this.updateScrollbars();
  }

  setCopy(copy: EditorCopy): void {
    this.copy = copy;
    this.mergeView?.reconfigure({ renderRevertControl: () => this.revertButton() });
    for (const binding of this.bindings) {
      if (binding.changeIndicators) {
        binding.changeIndicators.setCopy(binding.view, editorChangeIndicatorCopy(copy));
      }
    }
  }

  setPresentation(presentation: DiffPresentation): void {
    const layoutChanged = presentation.layout !== this.presentation.layout;
    this.presentation = { ...presentation };
    if (!this.parent || !this.preferences) return;
    if (layoutChanged) {
      this.flushChanges();
      this.render();
      this.loadLanguage();
      return;
    }
    this.setPreferences(this.preferences);
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

  destroy(): void {
    this.flushChanges();
    this.releaseScrollLink();
    this.languageActivation += 1;
    this.languageLoader.cancel();
    if (this.changeFrame !== null) window.cancelAnimationFrame(this.changeFrame);
    this.changeFrame = null;
    this.changePending = false;
    this.mergeView?.destroy();
    this.unifiedView?.destroy();
    this.mergeView = null;
    this.unifiedView = null;
    this.bindings = [];
    this.parent = null;
    this.onRevert = null;
  }

  private releaseScrollLink(): void {
    this.scrollDispose?.();
    this.scrollDispose = null;
    this.diffScrollbars?.container.remove();
    this.diffScrollbars = null;
  }

  private render(): void {
    const parent = this.parent;
    const preferences = this.preferences;
    if (!parent || !preferences) return;
    this.releaseScrollLink();
    this.mergeView?.destroy();
    this.unifiedView?.destroy();
    this.mergeView = null;
    this.unifiedView = null;
    this.bindings = [];
    parent.replaceChildren();
    if (this.presentation.layout === "unified") {
      const binding = this.binding();
      const state = EditorState.create({
        doc: this.exactContent.text,
        extensions: [
          ...this.extensions(binding, true),
          unifiedMergeView({
            original: this.baseContent,
            collapseUnchanged: this.expandedUnchanged ? undefined : { margin: 3, minSize: 8 },
            diffConfig: { scanLimit: 1_000, timeout: 250 },
            mergeControls: (type, action) => type === "reject"
              ? this.revertButton(action)
              : document.createElement("span"),
          }),
        ],
      });
      this.unifiedView = new EditorView({ parent, state });
      binding.view = this.unifiedView;
      this.bindings.push(binding);
      return;
    }

    const left = this.binding();
    const right = this.binding();
    this.mergeView = new MergeView({
      parent,
      a: {
        doc: this.baseContent,
        extensions: this.extensions(left, false, "after", {
          reference: this.exactContent.text,
          documentSide: "a",
          overview: false,
        }),
      },
      b: {
        doc: this.exactContent.text,
        extensions: this.extensions(right, true, "before", {
          reference: this.baseContent,
          documentSide: "b",
          overview: true,
        }),
      },
      orientation: "a-b",
      gutter: false,
      revertControls: "a-to-b",
      renderRevertControl: () => this.revertButton(),
      collapseUnchanged: this.expandedUnchanged ? undefined : { margin: 3, minSize: 8 },
      diffConfig: { scanLimit: 1_000, timeout: 250 },
    });
    left.view = this.mergeView.a;
    right.view = this.mergeView.b;
    this.bindings.push(left, right);
    // Both panes keep their own horizontal scroller under one shared vertical scroller, so their
    // horizontal offsets are linked explicitly.
    const disposeAB = linkHorizontalScroll(
      this.mergeView.a.scrollDOM,
      this.mergeView.b.scrollDOM,
    );

    const container = document.createElement("div");
    container.className = "editable-diff-scrollbars";
    container.setAttribute("aria-hidden", "true");

    const paneA = document.createElement("div");
    paneA.className = "editable-diff-scrollbar-pane editable-diff-scrollbar-a";
    const contentA = document.createElement("div");
    contentA.className = "editable-diff-scrollbar-content";
    paneA.appendChild(contentA);

    const spacer = document.createElement("div");
    spacer.className = "editable-diff-scrollbar-spacer";

    const paneB = document.createElement("div");
    paneB.className = "editable-diff-scrollbar-pane editable-diff-scrollbar-b";
    const contentB = document.createElement("div");
    contentB.className = "editable-diff-scrollbar-content";
    paneB.appendChild(contentB);

    const corner = document.createElement("div");
    corner.className = "editable-diff-scrollbar-corner";

    container.appendChild(paneA);
    container.appendChild(spacer);
    container.appendChild(paneB);
    container.appendChild(corner);
    parent.appendChild(container);

    const disposeSbA = linkHorizontalScroll(
      paneA,
      this.mergeView.a.scrollDOM,
    );
    const disposeSbB = linkHorizontalScroll(
      paneB,
      this.mergeView.b.scrollDOM,
    );

    const resizeObserver = new ResizeObserver(() => {
      this.updateScrollbars();
    });
    resizeObserver.observe(this.mergeView.dom);
    resizeObserver.observe(this.mergeView.a.scrollDOM);
    resizeObserver.observe(this.mergeView.b.scrollDOM);

    this.scrollDispose = () => {
      disposeAB();
      disposeSbA();
      disposeSbB();
      resizeObserver.disconnect();
    };
    this.diffScrollbars = {
      container,
      paneA,
      contentA,
      paneB,
      contentB,
      corner,
      resizeObserver,
    };
    this.updateScrollbars();
  }

  private binding(): ViewBinding {
    return {
      view: null as unknown as EditorView,
      language: new Compartment(),
      indent: new Compartment(),
      tabSize: new Compartment(),
      theme: new Compartment(),
      phrases: new Compartment(),
      whitespace: new Compartment(),
      changeIndicators: null,
      comparisonSide: null,
    };
  }

  private extensions(
    binding: ViewBinding,
    editable: boolean,
    gutterSide?: DiffGutterSide,
    comparison?: {
      reference: string;
      documentSide: "a" | "b";
      overview: boolean;
    },
  ): Extension[] {
    const preferences = this.preferences!;
    if (comparison) {
      binding.changeIndicators = createEditorChangeIndicators(
        comparison.reference,
        editorChangeIndicatorCopy(this.copy),
        {
          gutterSide,
          overview: comparison.overview,
          documentSide: comparison.documentSide,
        },
      );
      binding.comparisonSide = comparison.documentSide;
    } else if (editable) {
      binding.changeIndicators = createEditorChangeIndicators(
        this.baseContent,
        editorChangeIndicatorCopy(this.copy),
        { gutter: false },
      );
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
      EditorState.readOnly.of(!editable),
      EditorView.editable.of(editable),
      gutterSide ? diffLineNumberGutter(gutterSide) : lineNumbers(),
      binding.changeIndicators?.extension ?? [],
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      asterlynSearch(),
      highlightSelectionMatches(),
      asterlynSyntaxHighlighting,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, { key: "Mod-f", run: openSearchPanel }]),
      editable ? EditorView.updateListener.of((update) => this.onDocUpdate(update)) : [],
    ];
  }

  private onDocUpdate(update: ViewUpdate): void {
    if (!update.docChanged || this.synchronizing) return;
    const isRevert = update.transactions.some((tr) => tr.isUserEvent("revert"));
    const changes: TextChange[] = [];
    update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ from, to, insert: inserted.toString() });
    });
    this.exactContent = applyExactTextChanges(this.exactContent, changes);
    this.serializedContent = null;
    for (const binding of this.bindings) {
      if (binding.comparisonSide === "a" && binding.changeIndicators) {
        binding.changeIndicators.setBaseline(binding.view, update.state.doc.toString());
      }
    }
    this.changePending = true;
    this.updateScrollbars();
    if (isRevert) {
      this.flushChanges();
      this.onRevert?.();
      return;
    }
    if (this.changeFrame !== null) return;
    this.changeFrame = window.requestAnimationFrame(() => {
      this.changeFrame = null;
      this.flushChanges();
    });
  }

  private updateScrollbars(): void {
    if (!this.diffScrollbars || !this.mergeView) return;
    const a = this.mergeView.a.scrollDOM;
    const b = this.mergeView.b.scrollDOM;
    if (!a.isConnected || !b.isConnected) return;
    const widthA = a.scrollWidth;
    const widthB = b.scrollWidth;
    this.diffScrollbars.contentA.style.width = `${widthA}px`;
    this.diffScrollbars.contentB.style.width = `${widthB}px`;

    const verticalScrollbarWidth = Math.max(
      0,
      this.mergeView.dom.offsetWidth - this.mergeView.dom.clientWidth,
    );
    this.diffScrollbars.corner.style.width = `${verticalScrollbarWidth}px`;
    this.diffScrollbars.corner.style.flex = `0 0 ${verticalScrollbarWidth}px`;

    const hasOverflowA = widthA > a.clientWidth;
    const hasOverflowB = widthB > b.clientWidth;
    this.diffScrollbars.container.style.display = (hasOverflowA || hasOverflowB) ? "flex" : "none";
  }

  private currentView(): EditorView {
    const view = this.unifiedView ?? this.mergeView?.b;
    if (!view) throw new Error("Editable Diff is not mounted");
    return view;
  }

  private revertButton(action?: (event: MouseEvent) => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "editable-diff-revert";
    button.textContent = "↩";
    button.title = this.copy.revertDiffChange;
    button.setAttribute("aria-label", this.copy.revertDiffChange);
    if (action) button.addEventListener("mousedown", action);
    return button;
  }

  private loadLanguage(): void {
    const activation = ++this.languageActivation;
    this.languageLoader.cancel();
    void this.languageLoader.load(this.path).then((result) => {
      if (!result?.support || activation !== this.languageActivation || !this.parent) return;
      for (const binding of this.bindings) {
        binding.view.dispatch({ effects: binding.language.reconfigure(result.support) });
      }
    });
  }
}

function computeTextChange(oldText: string, newText: string): { from: number; to: number; insert: string } | null {
  if (oldText === newText) return null;
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText.charCodeAt(start) === newText.charCodeAt(start)) {
    start++;
  }
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText.charCodeAt(oldEnd - 1) === newText.charCodeAt(newEnd - 1)) {
    oldEnd--;
    newEnd--;
  }
  return {
    from: start,
    to: oldEnd,
    insert: newText.slice(start, newEnd),
  };
}
