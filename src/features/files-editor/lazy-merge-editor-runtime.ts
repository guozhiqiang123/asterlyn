import type { ConflictEditor } from "../../conflict-editor.ts";
import type { DiffPresentation } from "../../diff-presentation.ts";
import type { EditableDiffEditor } from "../../editable-diff-editor.ts";
import type { EditorCopy, GitOperationCopy } from "../../localization/catalog.ts";
import type { GitConflictContent } from "../../models.ts";
import type { EffectiveTheme } from "../../presentation/presentation-environment.ts";
import type { AppPreferences } from "../../preferences.ts";

interface EditableDiffMount {
  parent: HTMLElement;
  baseContent: string;
  currentContent: string;
  path: string;
  preferences: AppPreferences;
  presentation: DiffPresentation;
  expandedUnchanged: boolean;
  onChange: (content: string) => void;
  onRevert?: () => void;
  restoredScroll?: { topRatio: number; scrollTop: number; left: number } | null;
}

interface ConflictMount {
  parent: HTMLElement;
  conflict: GitConflictContent;
  result: string;
  preferences: AppPreferences;
  copy: GitOperationCopy;
  editorCopy: EditorCopy;
  onChange: (content: string) => void;
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

  constructor(copy: EditorCopy) {
    this.copy = copy;
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
    expandedUnchanged: boolean,
    onChange: (content: string) => void,
    onRevert?: () => void,
    restoredScroll?: { topRatio: number; scrollTop: number; left: number } | null,
  ): void {
    const mount = {
      parent,
      baseContent,
      currentContent,
      path,
      preferences,
      presentation,
      expandedUnchanged,
      onChange,
      onRevert,
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
      mount.expandedUnchanged,
      mount.onChange,
      mount.onRevert,
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
      const editor = new EditableDiffEditor(this.copy);
      this.implementation = editor;
      return editor;
    });
    return this.loading;
  }
}

/** Defers the three-pane merge runtime until an unresolved path is opened. */
export class LazyConflictEditor {
  private implementation: ConflictEditor | null = null;
  private loading: Promise<ConflictEditor> | null = null;
  private pendingMount: ConflictMount | null = null;
  private mountGeneration = 0;
  private preferences: AppPreferences | null = null;
  private theme: EffectiveTheme = "dark";
  private phrases: Readonly<Record<string, string>> = {};
  private resultReadOnly = false;

  mount(
    parent: HTMLElement,
    conflict: GitConflictContent,
    result: string,
    preferences: AppPreferences,
    copy: GitOperationCopy,
    editorCopy: EditorCopy,
    onChange: (content: string) => void,
  ): void {
    const mount = { parent, conflict, result, preferences, copy, editorCopy, onChange };
    this.pendingMount = mount;
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
    return this.implementation?.content() ?? this.pendingMount?.result ?? "";
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

  requestMeasure(): void {
    this.implementation?.requestMeasure();
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

  setResultReadOnly(readOnly: boolean): void {
    this.resultReadOnly = readOnly;
    this.implementation?.setResultReadOnly(readOnly);
  }

  destroy(): void {
    this.mountGeneration += 1;
    this.pendingMount?.parent.removeAttribute("aria-busy");
    this.pendingMount = null;
    this.implementation?.destroy();
  }

  private install(editor: ConflictEditor, mount: ConflictMount): void {
    editor.setTheme(this.theme);
    editor.setPhrases(this.phrases);
    editor.mount(
      mount.parent,
      mount.conflict,
      mount.result,
      this.preferences ?? mount.preferences,
      mount.copy,
      mount.editorCopy,
      mount.onChange,
    );
    editor.setResultReadOnly(this.resultReadOnly);
  }

  private load(): Promise<ConflictEditor> {
    if (this.implementation) return Promise.resolve(this.implementation);
    this.loading ??= import("../../conflict-editor.ts").then(({ ConflictEditor }) => {
      const editor = new ConflictEditor();
      this.implementation = editor;
      return editor;
    });
    return this.loading;
  }
}
