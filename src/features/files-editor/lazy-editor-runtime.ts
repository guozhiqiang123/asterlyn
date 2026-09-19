import type { DiffPresentation } from "../../diff-presentation.ts";
import type { DiffEditor } from "../../diff-editor.ts";
import type { TextEditor } from "../../text-editor.ts";
import type { AppPreferences } from "../../preferences.ts";
import type { EditorRuntimeTabRemap } from "../../editor-path-mutation.ts";
import type { EffectiveTheme } from "../../presentation/presentation-environment.ts";
import type { ContextMenuPort } from "../../shared/context-menu/context-menu-model.ts";
import type {
  DiffGitBlameSources,
  GitBlameCopy,
  GitBlameRuntime,
  GitBlameSource,
} from "./editor-gutter.ts";

type TextMount = {
  parent: HTMLElement;
  tabId: string;
  loadEpoch: number;
  content: string;
  path: string;
  preferences: AppPreferences;
  blameSource: GitBlameSource | null;
  blameUnavailableReason: string | null;
  onChange: (content: string) => void;
};

type DiffMount = {
  parent: HTMLElement;
  document: string;
  path: string;
  preferences: AppPreferences;
  presentation: DiffPresentation;
  blameSources: DiffGitBlameSources;
};

/** Loads the CodeMirror text runtime only when the first editable document is mounted. */
export class LazyTextEditor {
  private readonly blameRuntime: GitBlameRuntime;
  private blameCopy: GitBlameCopy;
  private implementation: TextEditor | null = null;
  private loading: Promise<TextEditor> | null = null;
  private pendingMount: TextMount | null = null;
  private mountGeneration = 0;
  private readOnly = false;
  private preferences: AppPreferences | null = null;
  private theme: EffectiveTheme = "dark";
  private phrases: Readonly<Record<string, string>> = {};
  private readonly contextMenu: ContextMenuPort;
  private readonly contextOwnerId: string;

  constructor(
    blameRuntime: GitBlameRuntime,
    blameCopy: GitBlameCopy,
    contextMenu: ContextMenuPort,
    contextOwnerId: string,
  ) {
    this.blameRuntime = blameRuntime;
    this.blameCopy = blameCopy;
    this.contextMenu = contextMenu;
    this.contextOwnerId = contextOwnerId;
  }

  mount(
    parent: HTMLElement,
    tabId: string,
    loadEpoch: number,
    content: string,
    path: string,
    preferences: AppPreferences,
    blameSource: GitBlameSource | null,
    blameUnavailableReason: string | null,
    onChange: (content: string) => void,
  ): void {
    const mount = {
      parent,
      tabId,
      loadEpoch,
      content,
      path,
      preferences,
      blameSource,
      blameUnavailableReason,
      onChange,
    };
    this.pendingMount = mount;
    if (this.implementation) {
      this.implementation.setReadOnly(this.readOnly);
      this.implementation.setPreferences(this.preferences ?? preferences);
      this.implementation.setTheme(this.theme);
      this.implementation.setPhrases(this.phrases);
      this.implementation.mount(
        parent,
        tabId,
        loadEpoch,
        content,
        path,
        this.preferences ?? preferences,
        blameSource,
        blameUnavailableReason,
        onChange,
      );
      return;
    }
    const request = ++this.mountGeneration;
    parent.setAttribute("aria-busy", "true");
    void this.load().then((editor) => {
      if (request !== this.mountGeneration || !this.pendingMount) return;
      const mount = this.pendingMount;
      if (!mount.parent.isConnected) return;
      mount.parent.removeAttribute("aria-busy");
      editor.setReadOnly(this.readOnly);
      editor.setPreferences(this.preferences ?? mount.preferences);
      editor.setTheme(this.theme);
      editor.setPhrases(this.phrases);
      editor.mount(
        mount.parent,
        mount.tabId,
        mount.loadEpoch,
        mount.content,
        mount.path,
        this.preferences ?? mount.preferences,
        mount.blameSource,
        mount.blameUnavailableReason,
        mount.onChange,
      );
    });
  }

  isMountedIn(parent: HTMLElement): boolean {
    return this.implementation?.isMountedIn(parent) === true ||
      this.pendingMount?.parent === parent;
  }

  content(tabId?: string | null): string {
    if (this.implementation) return this.implementation.content(tabId);
    if (!this.pendingMount || (tabId && tabId !== this.pendingMount.tabId)) return "";
    return this.pendingMount.content;
  }

  flushChanges(): void {
    this.implementation?.flushChanges();
  }

  focus(): void {
    if (this.implementation) this.implementation.focus();
    else void this.load().then((editor) => editor.focus());
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

  selectRange(fromUtf16: number, toUtf16: number): boolean {
    if (this.implementation) return this.implementation.selectRange(fromUtf16, toUtf16);
    if (!this.pendingMount) return false;
    const generation = this.mountGeneration;
    void this.load().then((editor) => {
      if (generation === this.mountGeneration) editor.selectRange(fromUtf16, toUtf16);
    });
    return true;
  }

  requestMeasure(): void {
    this.implementation?.requestMeasure();
  }

  linkVerticalScroll(peer: HTMLElement): () => void {
    let disposed = false;
    let dispose: () => void = () => undefined;
    const generation = this.mountGeneration;
    void this.load().then((editor) => {
      if (disposed || generation !== this.mountGeneration || !peer.isConnected) return;
      dispose = editor.linkVerticalScroll(peer);
    });
    return () => {
      disposed = true;
      dispose();
    };
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.implementation?.setReadOnly(readOnly);
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

  setBlameCopy(copy: GitBlameCopy): void {
    this.blameCopy = copy;
    this.implementation?.setBlameCopy(copy);
  }

  detach(): void {
    this.mountGeneration += 1;
    this.pendingMount?.parent.removeAttribute("aria-busy");
    this.pendingMount = null;
    this.implementation?.detach();
  }

  retain(tabIds: readonly string[]): void {
    this.implementation?.retain(tabIds);
  }

  remap(remaps: readonly EditorRuntimeTabRemap[]): boolean {
    const pending = this.pendingMount;
    if (pending) {
      const remap = remaps.find((candidate) => candidate.sourceId === pending.tabId);
      if (remap) {
        this.pendingMount = {
          ...pending,
          tabId: remap.destinationId,
          path: remap.destinationPath,
        };
      }
    }
    return this.implementation?.remap(remaps) ?? true;
  }

  dispose(tabId: string): void {
    if (this.pendingMount?.tabId === tabId) this.detach();
    this.implementation?.dispose(tabId);
  }

  destroy(): void {
    this.detach();
    this.implementation?.destroy();
    this.implementation = null;
    this.loading = null;
  }

  private load(): Promise<TextEditor> {
    if (this.implementation) return Promise.resolve(this.implementation);
    if (!this.loading) {
      this.loading = import("../../text-editor.ts").then(({ TextEditor }) => {
        const editor = new TextEditor(
          this.blameRuntime,
          this.blameCopy,
          this.contextMenu,
          this.contextOwnerId,
        );
        this.implementation = editor;
        return editor;
      });
    }
    return this.loading;
  }
}

/** Loads the CodeMirror Diff runtime only when a text Diff is first inspected. */
export class LazyDiffEditor {
  private readonly blameRuntime: GitBlameRuntime;
  private blameCopy: GitBlameCopy;
  private implementation: DiffEditor | null = null;
  private loading: Promise<DiffEditor> | null = null;
  private pendingMount: DiffMount | null = null;
  private mountGeneration = 0;
  private preferences: AppPreferences | null = null;
  private theme: EffectiveTheme = "dark";
  private phrases: Readonly<Record<string, string>> = {};
  private presentation: DiffPresentation = { layout: "split", showWhitespace: false };
  private readonly contextMenu: ContextMenuPort;
  private readonly contextOwnerId: string;

  constructor(
    blameRuntime: GitBlameRuntime,
    blameCopy: GitBlameCopy,
    contextMenu: ContextMenuPort,
    contextOwnerId: string,
  ) {
    this.blameRuntime = blameRuntime;
    this.blameCopy = blameCopy;
    this.contextMenu = contextMenu;
    this.contextOwnerId = contextOwnerId;
  }

  mount(
    parent: HTMLElement,
    document: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation,
    blameSources: DiffGitBlameSources,
  ): void {
    const mount = { parent, document, path, preferences, presentation, blameSources };
    this.pendingMount = mount;
    this.presentation = { ...presentation };
    if (this.implementation) {
      this.implementation.setTheme(this.theme);
      this.implementation.setPhrases(this.phrases);
      this.implementation.mount(
        parent,
        document,
        path,
        this.preferences ?? preferences,
        this.presentation,
        blameSources,
      );
      return;
    }
    const request = ++this.mountGeneration;
    parent.setAttribute("aria-busy", "true");
    void this.load().then((editor) => {
      if (request !== this.mountGeneration || !this.pendingMount) return;
      const mount = this.pendingMount;
      if (!mount.parent.isConnected) return;
      mount.parent.removeAttribute("aria-busy");
      editor.setTheme(this.theme);
      editor.setPhrases(this.phrases);
      editor.mount(
        mount.parent,
        mount.document,
        mount.path,
        this.preferences ?? mount.preferences,
        this.presentation,
        mount.blameSources,
      );
    });
  }

  setPresentation(presentation: DiffPresentation): void {
    this.presentation = { ...presentation };
    this.implementation?.setPresentation(presentation);
  }

  requestMeasure(): void {
    this.implementation?.requestMeasure();
  }

  navigateChange(direction: -1 | 1): boolean {
    return this.implementation?.navigateChange(direction) ?? false;
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

  setBlameCopy(copy: GitBlameCopy): void {
    this.blameCopy = copy;
    this.implementation?.setBlameCopy(copy);
  }

  destroy(): void {
    this.mountGeneration += 1;
    this.pendingMount?.parent.removeAttribute("aria-busy");
    this.pendingMount = null;
    this.implementation?.destroy();
  }

  private load(): Promise<DiffEditor> {
    if (this.implementation) return Promise.resolve(this.implementation);
    if (!this.loading) {
      this.loading = import("../../diff-editor.ts").then(({ DiffEditor }) => {
        const editor = new DiffEditor(
          this.blameRuntime,
          this.blameCopy,
          this.contextMenu,
          this.contextOwnerId,
        );
        this.implementation = editor;
        return editor;
      });
    }
    return this.loading;
  }
}
