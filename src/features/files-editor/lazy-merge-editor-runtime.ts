import type { ConflictEditor } from "../../conflict-editor.ts";
import type { ConflictEditorPreparation } from "../../conflict-editor-preparation.ts";
import type { DiffPresentation, DiffSideLabels } from "../../diff-presentation.ts";
import type { EditableDiffEditor, EditableDiffInteractions } from "../../editable-diff-editor.ts";
import type { EditorCopy, GitOperationCopy } from "../../localization/catalog.ts";
import type { GitConflictContent } from "../../models.ts";
import type { EffectiveTheme } from "../../presentation/presentation-environment.ts";
import type { DiffReviewSummary } from "../../shared/diff-review/diff-review-model.ts";
import type { AppPreferences } from "../../preferences.ts";
import { decodeExactText } from "./text-content.ts";
import type { ConflictGitBlameSources, DiffGitBlameSources, GitBlameRuntime } from "./editor-gutter.ts";
import { ConflictPreparationRuntime } from "./conflict-preparation-runtime.ts";
import { emptyState, loadingBlock } from "./editor-view.ts";

interface EditableDiffMount {
  parent: HTMLElement;
  baseContent: string;
  currentContent: string;
  path: string;
  preferences: AppPreferences;
  presentation: DiffPresentation;
  sideLabels: DiffSideLabels;
  blameSources: DiffGitBlameSources;
  expandedUnchanged: boolean;
  onChange: (content: string) => void;
  interactions?: EditableDiffInteractions;
  restoredScroll?: { topRatio: number; scrollTop: number; left: number } | null;
}

interface ConflictMount {
  parent: HTMLElement;
  conflict: GitConflictContent;
  result: string;
  preferences: AppPreferences;
  presentation: DiffPresentation;
  copy: GitOperationCopy;
  editorCopy: EditorCopy;
  blameSources: ConflictGitBlameSources;
  onChange: (content: string) => void;
  onReady: () => void;
}

/** Defers the CodeMirror merge runtime until an editable working Diff is opened. */
export class LazyEditableDiffEditor {
  private implementation: EditableDiffEditor | null = null;
  private loading: Promise<EditableDiffEditor> | null = null;
  private pendingMount: EditableDiffMount | null = null;
  private mountGeneration = 0;
  private copy: EditorCopy;
  private preferences: AppPreferences | null = null;
  private presentation: DiffPresentation = { layout: "split", showWhitespace: false };
  private theme: EffectiveTheme = "dark";
  private phrases: Readonly<Record<string, string>> = {};
  private readonly blameRuntime: GitBlameRuntime;
  constructor(
    copy: EditorCopy,
    blameRuntime: GitBlameRuntime,
  ) {
    this.copy = copy;
    this.blameRuntime = blameRuntime;
  }

  currentPath(): string | null {
    return this.implementation?.currentPath() ?? this.pendingMount?.path ?? null;
  }

  captureScroll(): { topRatio: number; scrollTop: number; left: number } | null {
    return this.implementation?.captureScroll() ?? null;
  }

  mount(
    parent: HTMLElement,
    baseContent: string,
    currentContent: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    sideLabels: DiffSideLabels,
    blameSources: DiffGitBlameSources,
    expandedUnchanged: boolean,
    onChange: (content: string) => void,
    interactions?: EditableDiffInteractions,
    restoredScroll?: { topRatio: number; scrollTop: number; left: number } | null,
  ): void {
    const mount = {
      parent,
      baseContent,
      currentContent,
      path,
      preferences,
      presentation,
      sideLabels,
      blameSources,
      expandedUnchanged,
      onChange,
      interactions,
      restoredScroll,
    };
    this.pendingMount = mount;
    this.presentation = { ...presentation };
    if (this.implementation) {
      this.install(this.implementation, mount);
      return;
    }
    const request = ++this.mountGeneration;
    parent.setAttribute("aria-busy", "true");
    void this.load().then((editor) => {
      if (request !== this.mountGeneration || !this.pendingMount) return;
      const pending = this.pendingMount;
      if (!pending.parent.isConnected) return;
      pending.parent.removeAttribute("aria-busy");
      this.install(editor, pending);
    });
  }

  content(): string {
    return this.implementation?.content() ?? this.pendingMount?.currentContent ?? "";
  }

  flushChanges(): void {
    this.implementation?.flushChanges();
  }

  openFindReplace(): boolean {
    if (this.implementation) return this.implementation.openFindReplace();
    if (!this.pendingMount) return false;
    const generation = this.mountGeneration;
    void this.load().then((editor) => {
      if (generation === this.mountGeneration) editor.openFindReplace();
    });
    return true;
  }

  navigateChange(direction: -1 | 1): boolean {
    return this.implementation?.navigateChange(direction) ?? false;
  }

  requestMeasure(): void {
    this.implementation?.requestMeasure();
  }

  setCopy(copy: EditorCopy): void {
    this.copy = copy;
    this.implementation?.setCopy(copy);
  }

  setPresentation(presentation: DiffPresentation): void {
    this.presentation = { ...presentation };
    if (this.pendingMount) this.pendingMount = { ...this.pendingMount, presentation };
    this.implementation?.setPresentation(presentation);
  }

  setPreferences(preferences: AppPreferences): void {
    this.preferences = { ...preferences };
    this.implementation?.setPreferences(preferences);
  }

  setTheme(theme: EffectiveTheme): void {
    this.theme = theme;
    this.implementation?.setTheme(theme);
  }

  setPhrases(phrases: Readonly<Record<string, string>>): void {
    this.phrases = phrases;
    this.implementation?.setPhrases(phrases);
  }

  destroy(): void {
    this.mountGeneration += 1;
    this.pendingMount?.parent.removeAttribute("aria-busy");
    this.pendingMount = null;
    this.implementation?.destroy();
  }

  private install(editor: EditableDiffEditor, mount: EditableDiffMount): void {
    editor.setCopy(this.copy);
    editor.setTheme(this.theme);
    editor.setPhrases(this.phrases);
    editor.mount(
      mount.parent,
      mount.baseContent,
      mount.currentContent,
      mount.path,
      this.preferences ?? mount.preferences,
      this.presentation,
      mount.sideLabels,
      mount.blameSources,
      mount.expandedUnchanged,
      mount.onChange,
      mount.interactions,
      mount.restoredScroll,
    );
  }

  /** Loads this runtime's module ahead of the first mount; mounting itself is unchanged. */
  preload(): void {
    void this.load();
  }

  private load(): Promise<EditableDiffEditor> {
    if (this.implementation) return Promise.resolve(this.implementation);
    this.loading ??= import("../../editable-diff-editor.ts").then(({ EditableDiffEditor }) => {
      const editor = new EditableDiffEditor(
        this.copy,
        this.blameRuntime,
      );
      this.implementation = editor;
      return editor;
    });
    return this.loading;
  }
}

/** Defers the split/unified conflict runtime until an unresolved path is opened. */
export class LazyConflictEditor {
  private implementation: ConflictEditor | null = null;
  private loading: Promise<ConflictEditor> | null = null;
  private mounting: Promise<void> | null = null;
  private pendingMount: ConflictMount | null = null;
  private mountGeneration = 0;
  private preferences: AppPreferences | null = null;
  private presentation: DiffPresentation = { layout: "split", showWhitespace: false };
  private theme: EffectiveTheme = "dark";
  private phrases: Readonly<Record<string, string>> = {};
  private resultReadOnly = false;
  private ready = false;
  private editorCopy: EditorCopy;
  private readonly blameRuntime: GitBlameRuntime;
  private readonly preparation = new ConflictPreparationRuntime();
  constructor(
    editorCopy: EditorCopy,
    blameRuntime: GitBlameRuntime,
  ) {
    this.editorCopy = editorCopy;
    this.blameRuntime = blameRuntime;
  }

  setCopy(copy: EditorCopy): void {
    this.editorCopy = copy;
  }

  mount(
    parent: HTMLElement,
    conflict: GitConflictContent,
    result: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    copy: GitOperationCopy,
    editorCopy: EditorCopy,
    blameSources: ConflictGitBlameSources,
    onChange: (content: string) => void,
    onReady: () => void,
  ): void {
    const mount = { parent, conflict, result, preferences, presentation, copy, editorCopy, blameSources, onChange, onReady };
    this.pendingMount = mount;
    this.ready = false;
    this.presentation = { ...presentation };
    const request = ++this.mountGeneration;
    parent.setAttribute("aria-busy", "true");
    parent.innerHTML = loadingBlock(copy.readingConflict);
    const base = decodeExactText(conflict.base ?? "").text;
    const ours = decodeExactText(conflict.ours ?? "").text;
    const theirs = decodeExactText(conflict.theirs ?? "").text;
    const preparedResult = decodeExactText(result).text;
    const mounting = Promise.all([
      this.load(),
      this.preparation.prepare({ base, ours, result: preparedResult, theirs }),
    ]).then(([editor, prepared]) => {
      if (request !== this.mountGeneration || !this.pendingMount) return;
      const pending = this.pendingMount;
      if (!pending.parent.isConnected) return;
      pending.parent.removeAttribute("aria-busy");
      this.install(editor, pending, prepared);
    }).catch((error: unknown) => {
      if (request !== this.mountGeneration || !this.pendingMount) return;
      const pending = this.pendingMount;
      if (!pending.parent.isConnected) return;
      pending.parent.removeAttribute("aria-busy");
      pending.parent.innerHTML = emptyState(
        pending.copy.conflictUnavailable,
        conflictMountError(error),
        "changes",
      );
    });
    this.mounting = mounting;
    void mounting.finally(() => {
      if (this.mounting === mounting) this.mounting = null;
    });
  }

  content(): string {
    return this.ready ? this.implementation?.content() ?? "" : this.pendingMount?.result ?? "";
  }

  flushChanges(): void {
    if (this.ready) this.implementation?.flushChanges();
  }

  openFindReplace(): boolean {
    if (this.ready && this.implementation) return this.implementation.openFindReplace();
    if (!this.pendingMount) return false;
    const generation = this.mountGeneration;
    void this.mounting?.then(() => {
      if (generation === this.mountGeneration && this.ready) this.implementation?.openFindReplace();
    });
    return true;
  }

  navigateChange(direction: 1 | -1): boolean {
    if (this.ready && this.implementation) return this.implementation.navigateChange(direction);
    if (!this.pendingMount) return false;
    const generation = this.mountGeneration;
    void this.mounting?.then(() => {
      if (generation === this.mountGeneration && this.ready) this.implementation?.navigateChange(direction);
    });
    return true;
  }

  reviewSummary(): DiffReviewSummary | null {
    return this.ready ? this.implementation?.reviewSummary() ?? null : null;
  }

  unchangedExpanded(): boolean {
    return this.ready ? this.implementation?.unchangedExpanded() ?? false : false;
  }

  setUnchangedExpanded(expanded: boolean): void {
    if (this.ready) this.implementation?.setUnchangedExpanded(expanded);
  }

  requestMeasure(): void {
    if (this.ready) this.implementation?.requestMeasure();
  }

  setPreferences(preferences: AppPreferences): void {
    this.preferences = { ...preferences };
    this.implementation?.setPreferences(preferences);
  }

  setPresentation(presentation: DiffPresentation): void {
    this.presentation = { ...presentation };
    if (this.pendingMount) this.pendingMount = { ...this.pendingMount, presentation };
    this.implementation?.setPresentation(presentation);
  }

  setTheme(theme: EffectiveTheme): void {
    this.theme = theme;
    this.implementation?.setTheme(theme);
  }

  setPhrases(phrases: Readonly<Record<string, string>>): void {
    this.phrases = phrases;
    this.implementation?.setPhrases(phrases);
  }

  setResultReadOnly(readOnly: boolean): void {
    this.resultReadOnly = readOnly;
    this.implementation?.setResultReadOnly(readOnly);
  }

  destroy(): void {
    this.mountGeneration += 1;
    this.ready = false;
    this.mounting = null;
    this.pendingMount?.parent.removeAttribute("aria-busy");
    this.pendingMount = null;
    this.implementation?.destroy();
  }

  dispose(): void {
    this.destroy();
    this.preparation.dispose();
  }

  private install(
    editor: ConflictEditor,
    mount: ConflictMount,
    prepared: ConflictEditorPreparation,
  ): void {
    editor.setTheme(this.theme);
    editor.setPhrases(this.phrases);
    editor.mount(
      mount.parent,
      mount.conflict,
      mount.result,
      this.preferences ?? mount.preferences,
      this.presentation,
      mount.copy,
      mount.editorCopy,
      mount.blameSources,
      mount.onChange,
      prepared,
    );
    this.ready = true;
    editor.setResultReadOnly(this.resultReadOnly);
    queueMicrotask(() => { if (this.pendingMount === mount) mount.onReady(); });
  }

  private load(): Promise<ConflictEditor> {
    if (this.implementation) return Promise.resolve(this.implementation);
    this.loading ??= import("../../conflict-editor.ts").then(({ ConflictEditor }) => {
      const editor = new ConflictEditor(
        this.blameRuntime,
        this.editorCopy,
      );
      this.implementation = editor;
      return editor;
    });
    return this.loading;
  }
}

function conflictMountError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
