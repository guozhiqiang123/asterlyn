import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { MergeView, diff } from "@codemirror/merge";
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
  type ViewUpdate,
} from "@codemirror/view";
import { EditorLanguageLoader } from "./editor-language.ts";
import { asterlynEditorTheme, asterlynSyntaxHighlighting } from "./editor-theme.ts";
import {
  createEditorChangeIndicators,
  editorChangeIndicatorCopy,
  type EditorChangeIndicators,
} from "./editor-change-indicators.ts";
import { diffLineNumberGutter, type DiffGutterSide } from "./features/files-editor/editor-gutter.ts";
import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
  type ExactTextContent,
  type TextChange,
} from "./features/files-editor/text-content.ts";
import type { EditorCopy, GitOperationCopy } from "./localization/catalog.ts";
import type { GitConflictContent } from "./models.ts";
import { linkScrollElements } from "./presentation/linked-scroll.ts";
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

/** Three-column conflict editor built from two synchronized merge projections. */
export class ConflictEditor {
  private leftMerge: MergeView | null = null;
  private rightMerge: MergeView | null = null;
  private scrollDispose: (() => void) | null = null;
  private bindings: ViewBinding[] = [];
  private languageLoader = new EditorLanguageLoader();
  private languageActivation = 0;
  private exactResult: ExactTextContent = decodeExactText("");
  private serializedResult: string | null = "";
  private onChange: (content: string) => void = () => undefined;
  private changePending = false;
  private changeFrame: number | null = null;
  private synchronizing = false;
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

    const ours = conflict.ours ?? "";
    const theirs = conflict.theirs ?? "";
    const base = conflict.base ?? "";
    const root = document.createElement("section");
    root.className = "conflict-three-pane";
    root.setAttribute("aria-label", copy.conflictInputs);
    root.dataset.oursChanges = String(diff(base, ours, { scanLimit: 1_000, timeout: 250 }).length);
    root.dataset.theirsChanges = String(diff(base, theirs, { scanLimit: 1_000, timeout: 250 }).length);
    root.innerHTML = `<header class="conflict-pane-labels">
      <strong>${escapeHtml(copy.ours)}<small>${root.dataset.oursChanges}</small></strong><span></span>
      <strong>${escapeHtml(copy.resolvedResult)}</strong><span></span>
      <strong>${escapeHtml(copy.theirs)}<small>${root.dataset.theirsChanges}</small></strong>
    </header><div class="conflict-merge-content"><div class="conflict-left-merge"></div><div class="conflict-right-merge"></div></div>`;
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
        extensions: this.extensions(oursBinding, false, editorCopy, undefined, "after", {
          reference: this.exactResult.text,
          documentSide: "a",
          overview: false,
          referenceTracksResult: true,
        }),
      },
      b: {
        doc: this.exactResult.text,
        extensions: this.extensions(primaryBinding, true, editorCopy, "primary", "before", {
          reference: ours,
          documentSide: "b",
          overview: true,
          referenceTracksResult: false,
        }),
      },
      gutter: false,
      revertControls: "a-to-b",
      renderRevertControl: () => this.directionButton("right", copy),
      collapseUnchanged: { margin: 3, minSize: 8 },
      diffConfig: { scanLimit: 1_000, timeout: 250 },
    });
    this.rightMerge = new MergeView({
      parent: rightHost,
      a: {
        doc: this.exactResult.text,
        extensions: this.extensions(mirrorBinding, false, editorCopy, "mirror", "after", {
          reference: theirs,
          documentSide: "a",
          overview: false,
          referenceTracksResult: false,
        }),
      },
      b: {
        doc: theirs,
        extensions: this.extensions(theirsBinding, false, editorCopy, undefined, "before", {
          reference: this.exactResult.text,
          documentSide: "b",
          overview: true,
          referenceTracksResult: true,
        }),
      },
      gutter: false,
      revertControls: "b-to-a",
      renderRevertControl: () => this.directionButton("left", copy),
      collapseUnchanged: { margin: 3, minSize: 8 },
      diffConfig: { scanLimit: 1_000, timeout: 250 },
    });
    oursBinding.view = this.leftMerge.a;
    primaryBinding.view = this.leftMerge.b;
    mirrorBinding.view = this.rightMerge.a;
    theirsBinding.view = this.rightMerge.b;
    this.bindings.push(oursBinding, primaryBinding, mirrorBinding, theirsBinding);
    this.scrollDispose = linkScrollElements(this.leftMerge.dom, this.rightMerge.dom);
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
      for (const control of merge?.dom.querySelectorAll<HTMLButtonElement>(".conflict-apply-change") ?? []) {
        control.disabled = readOnly;
      }
    }
  }

  destroy(): void {
    this.flushChanges();
    this.languageActivation += 1;
    this.languageLoader.cancel();
    this.scrollDispose?.();
    this.scrollDispose = null;
    this.leftMerge?.destroy();
    this.rightMerge?.destroy();
    this.leftMerge = null;
    this.rightMerge = null;
    this.bindings = [];
    this.synchronizing = false;
  }

  private extensions(
    binding: ViewBinding,
    editable: boolean,
    editorCopy: EditorCopy,
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
      diffLineNumberGutter(gutterSide),
      binding.changeIndicators?.extension ?? [],
      history(), drawSelection(), highlightActiveLine(),
      highlightActiveLineGutter(), highlightSelectionMatches(), asterlynSyntaxHighlighting,
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
    this.serializedResult = null;
    this.changePending = true;
    for (const binding of this.bindings) {
      if (binding.referenceTracksResult && binding.changeIndicators) {
        binding.changeIndicators.setBaseline(binding.view, update.state.doc.toString());
      }
    }
    const target = source === "primary" ? this.rightMerge?.a : this.leftMerge?.b;
    if (target && target.state.doc.toString() !== update.state.doc.toString()) {
      this.synchronizing = true;
      target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert: update.state.doc.toString() } });
      this.synchronizing = false;
    }
    if (this.changeFrame === null) {
      this.changeFrame = window.requestAnimationFrame(() => {
        this.changeFrame = null;
        this.flushChanges();
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

  private directionButton(direction: "left" | "right", copy: GitOperationCopy): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conflict-apply-change";
    button.textContent = direction === "right" ? "→" : "←";
    const label = direction === "right" ? copy.acceptOursChange : copy.acceptTheirsChange;
    button.title = label;
    button.setAttribute("aria-label", label);
    return button;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
