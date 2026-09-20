import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from "@codemirror/merge";
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
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
  private copy: EditorCopy;
  private changePending = false;
  private changeFrame: number | null = null;

  constructor(copy: EditorCopy) {
    this.copy = copy;
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
  ): void {
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
    this.render();
    this.loadLanguage();
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
  }

  private render(): void {
    const parent = this.parent;
    const preferences = this.preferences;
    if (!parent || !preferences) return;
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
      a: { doc: this.baseContent, extensions: this.extensions(left, false) },
      b: { doc: this.exactContent.text, extensions: this.extensions(right, true) },
      orientation: "a-b",
      revertControls: "a-to-b",
      renderRevertControl: () => this.revertButton(),
      collapseUnchanged: this.expandedUnchanged ? undefined : { margin: 3, minSize: 8 },
      diffConfig: { scanLimit: 1_000, timeout: 250 },
    });
    left.view = this.mergeView.a;
    right.view = this.mergeView.b;
    this.bindings.push(left, right);
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
    };
  }

  private extensions(binding: ViewBinding, editable: boolean): Extension[] {
    const preferences = this.preferences!;
    if (editable) {
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
      lineNumbers(),
      editable ? binding.changeIndicators!.extension : [],
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      asterlynSyntaxHighlighting,
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, { key: "Mod-f", run: openSearchPanel }]),
      editable ? EditorView.updateListener.of((update) => this.captureUpdate(update)) : [],
    ];
  }

  private captureUpdate(update: ViewUpdate): void {
    if (!update.docChanged) return;
    const changes: TextChange[] = [];
    update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ from, to, insert: inserted.toString() });
    });
    this.exactContent = applyExactTextChanges(this.exactContent, changes);
    this.serializedContent = null;
    this.changePending = true;
    if (this.changeFrame !== null) return;
    this.changeFrame = window.requestAnimationFrame(() => {
      this.changeFrame = null;
      this.flushChanges();
    });
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
