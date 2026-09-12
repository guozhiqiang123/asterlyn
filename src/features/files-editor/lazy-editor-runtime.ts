import type { DiffPresentation } from "../../diff-presentation.ts";
import type { DiffEditor } from "../../diff-editor.ts";
import type { TextEditor } from "../../text-editor.ts";
import type { AppPreferences } from "../../workbench/preferences.ts";

type TextMount = {
  parent: HTMLElement;
  tabId: string;
  loadEpoch: number;
  content: string;
  path: string;
  preferences: AppPreferences;
  onChange: (content: string) => void;
};

type DiffMount = {
  parent: HTMLElement;
  document: string;
  path: string;
  preferences: AppPreferences;
  presentation: DiffPresentation;
};

/** Loads the CodeMirror text runtime only when the first editable document is mounted. */
export class LazyTextEditor {
  private implementation: TextEditor | null = null;
  private loading: Promise<TextEditor> | null = null;
  private pendingMount: TextMount | null = null;
  private mountGeneration = 0;
  private readOnly = false;
  private preferences: AppPreferences | null = null;

  mount(
    parent: HTMLElement,
    tabId: string,
    loadEpoch: number,
    content: string,
    path: string,
    preferences: AppPreferences,
    onChange: (content: string) => void,
  ): void {
    const mount = {
      parent,
      tabId,
      loadEpoch,
      content,
      path,
      preferences,
      onChange,
    };
    this.pendingMount = mount;
    if (this.implementation) {
      this.implementation.setReadOnly(this.readOnly);
      this.implementation.setPreferences(this.preferences ?? preferences);
      this.implementation.mount(
        parent,
        tabId,
        loadEpoch,
        content,
        path,
        this.preferences ?? preferences,
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
      editor.mount(
        mount.parent,
        mount.tabId,
        mount.loadEpoch,
        mount.content,
        mount.path,
        this.preferences ?? mount.preferences,
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

  detach(): void {
    this.mountGeneration += 1;
    this.pendingMount?.parent.removeAttribute("aria-busy");
    this.pendingMount = null;
    this.implementation?.detach();
  }

  retain(tabIds: readonly string[]): void {
    this.implementation?.retain(tabIds);
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
        const editor = new TextEditor();
        this.implementation = editor;
        return editor;
      });
    }
    return this.loading;
  }
}

/** Loads the CodeMirror Diff runtime only when a text Diff is first inspected. */
export class LazyDiffEditor {
  private implementation: DiffEditor | null = null;
  private loading: Promise<DiffEditor> | null = null;
  private pendingMount: DiffMount | null = null;
  private mountGeneration = 0;
  private preferences: AppPreferences | null = null;
  private presentation: DiffPresentation = { layout: "split", showWhitespace: false };

  mount(
    parent: HTMLElement,
    document: string,
    path: string,
    preferences: AppPreferences,
    presentation: DiffPresentation = this.presentation,
  ): void {
    const mount = { parent, document, path, preferences, presentation };
    this.pendingMount = mount;
    this.presentation = { ...presentation };
    if (this.implementation) {
      this.implementation.mount(
        parent,
        document,
        path,
        this.preferences ?? preferences,
        this.presentation,
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
      editor.mount(
        mount.parent,
        mount.document,
        mount.path,
        this.preferences ?? mount.preferences,
        this.presentation,
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
        const editor = new DiffEditor();
        this.implementation = editor;
        return editor;
      });
    }
    return this.loading;
  }
}
