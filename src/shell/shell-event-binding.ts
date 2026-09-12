import type { NavigationMode } from "../workbench/navigation.ts";
import { scrollTabStrip } from "../workbench/tab-strip.ts";

export interface ShellEventActions {
  readonly workspaceOpen: () => boolean;
  readonly remoteDialogOpen: () => boolean;
  readonly remoteOperationActive: () => boolean;
  readonly pushDiffOpen: () => boolean;
  readonly gitOperationDialogOpen: () => boolean;
  readonly repositoryMenuOpen: () => boolean;
  readonly editorTabMenuOpen: () => boolean;
  readonly settingsOpen: () => boolean;
  readonly replacementClosable: () => boolean;
  readonly commandSurfaceOpen: () => boolean;
  readonly historyFilterOpen: () => boolean;
  readonly historyToolOpen: () => boolean;
  readonly activeReadyTextTab: () => string | null;
  readonly dirtyTextTabs: () => number;
  readonly toggleRepositoryMenu: () => void;
  readonly selectRemote: (remote: string) => void;
  readonly remoteAction: (kind: "fetch" | "pull" | "push", anchor: HTMLButtonElement) => void;
  readonly cancelRemoteOperation: () => void;
  readonly refresh: () => void;
  readonly openSettings: () => void;
  readonly closeSettings: () => void;
  readonly openCommandSurface: (mode: NavigationMode) => void;
  readonly clearError: () => void;
  readonly closeRepositoryDialog: () => void;
  readonly closeRepositoryTargetDialog: () => void;
  readonly openRepositoryTarget: (path: string, target: "current" | "new") => void;
  readonly requestRepositoryTarget: (path: string) => void;
  readonly closeHistoryDialog: () => void;
  readonly dismissCommandSurface: () => void;
  readonly closeWorkspaceReplacement: () => void;
  readonly closeRemoteDialog: (restoreFocus?: boolean) => void;
  readonly toggleEditorTabMenu: () => void;
  readonly hideGitTool: () => void;
  readonly hideLeftTool: () => void;
  readonly applyLayout: () => void;
  readonly closePushDiff: () => void;
  readonly openGitOperation: () => void;
  readonly closeGitOperation: () => void;
  readonly closeRepositoryMenu: (restoreFocus: boolean) => void;
  readonly closeEditorTabMenu: () => void;
  readonly closeHistoryFilter: () => void;
  readonly saveTextTab: (tabId: string) => void;
  readonly focusHistoryFilter: () => void;
  readonly openEditorFind: () => void;
  readonly captureEditor: () => void;
  readonly disposeFeatures: () => void;
}

export class ShellEventBinding {
  private abortController: AbortController | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: ShellEventActions,
  ) {}

  bind(): void {
    this.dispose();
    const controller = new AbortController();
    this.abortController = controller;
    const signal = controller.signal;
    const listen = (
      target: EventTarget,
      type: string,
      listener: EventListener,
      options: AddEventListenerOptions = {},
    ) => target.addEventListener(type, listener, { ...options, signal });

    listen(this.query("#repository-switcher"), "click", (event) => {
      event.stopPropagation();
      this.actions.toggleRepositoryMenu();
    });
    listen(this.query("#topbar-remote-select"), "change", (event) => {
      this.actions.selectRemote((event.currentTarget as HTMLSelectElement).value);
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-remote-action]").forEach((button) => {
      listen(button, "click", () => {
        const kind = button.dataset.remoteAction as "fetch" | "pull" | "push";
        this.actions.remoteAction(kind, button);
      });
    });
    listen(this.query("#cancel-remote-operation"), "click", () => this.actions.cancelRemoteOperation());
    listen(this.query("#refresh-button"), "click", () => this.actions.refresh());
    listen(this.query("#settings-button"), "click", () => this.actions.openSettings());
    listen(this.query("#settings-back"), "click", () => this.actions.closeSettings());
    listen(this.query("#command-center-button"), "click", () => this.actions.openCommandSurface("files"));
    listen(this.query("#toast-close"), "click", () => this.actions.clearError());

    for (const selector of ["#dialog-close", "#dialog-cancel"]) {
      listen(this.query(selector), "click", () => this.actions.closeRepositoryDialog());
    }
    listen(this.query("#repository-dialog"), "click", (event) => {
      if (event.target === event.currentTarget) this.actions.closeRepositoryDialog();
    });
    for (const selector of ["#repository-target-close", "#repository-target-cancel"]) {
      listen(this.query(selector), "click", () => this.actions.closeRepositoryTargetDialog());
    }
    listen(this.query("#repository-target-current"), "click", () => {
      const path = this.repositoryTargetPath();
      if (path) this.actions.openRepositoryTarget(path, "current");
    });
    listen(this.query("#repository-target-new"), "click", () => {
      const path = this.repositoryTargetPath();
      if (path) this.actions.openRepositoryTarget(path, "new");
    });
    listen(this.query("#repository-target-dialog"), "click", (event) => {
      if (event.target === event.currentTarget) this.actions.closeRepositoryTargetDialog();
    });
    listen(this.query("#history-dialog"), "click", (event) => {
      if (event.target === event.currentTarget) this.actions.closeHistoryDialog();
    });
    listen(this.query("#command-surface"), "click", (event) => {
      if (event.target === event.currentTarget) this.actions.dismissCommandSurface();
    });
    listen(this.query("#workspace-replacement-dialog"), "click", (event) => {
      if (event.target === event.currentTarget && this.actions.replacementClosable()) {
        this.actions.closeWorkspaceReplacement();
      }
    });
    const remoteDialog = this.query("#remote-action-dialog");
    listen(remoteDialog, "click", (event) => {
      if (event.target === event.currentTarget && !this.actions.remoteOperationActive()) {
        this.actions.closeRemoteDialog();
      }
    });
    listen(remoteDialog, "keydown", (event) => this.trapRemoteDialogFocus(event as KeyboardEvent));
    const gitOperationDialog = this.query("#git-operation-dialog");
    listen(gitOperationDialog, "keydown", (event) => {
      this.trapDialogFocus(event as KeyboardEvent, "#git-operation-dialog", this.actions.gitOperationDialogOpen());
    });
    listen(this.query("#repository-form"), "submit", (event) => {
      event.preventDefault();
      const path = this.query<HTMLInputElement>("#repository-input").value.trim();
      if (path) this.actions.requestRepositoryTarget(path);
    });

    const editorTabbar = this.query("#editor-tabbar");
    listen(editorTabbar, "wheel", (event) => {
      const wheel = event as WheelEvent;
      if (scrollTabStrip(editorTabbar, wheel.deltaX, wheel.deltaY)) wheel.preventDefault();
    }, { passive: false });
    listen(this.query("#editor-tab-menu-toggle"), "click", (event) => {
      event.stopPropagation();
      this.actions.toggleEditorTabMenu();
    });
    listen(this.query("#hide-git-tool"), "click", () => this.actions.hideGitTool());
    listen(this.query("#git-operation-open"), "click", () => this.actions.openGitOperation());
    listen(this.query("#hide-left-tool"), "click", () => this.actions.hideLeftTool());

    this.resizeObserver = new ResizeObserver(() => this.actions.applyLayout());
    this.resizeObserver.observe(this.query("#workbench"));
    listen(window, "keydown", (event) => this.handleWindowKeydown(event as KeyboardEvent));
    listen(window, "pointerdown", (event) => this.handleWindowPointerdown(event as PointerEvent));
    listen(window, "beforeunload", (event) => {
      this.actions.captureEditor();
      if (this.actions.dirtyTextTabs() === 0) return;
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = "";
    });
    listen(window, "pagehide", () => {
      this.dispose();
      this.actions.disposeFeatures();
    }, { once: true });
  }

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  private handleWindowKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && event.key.toLowerCase() === "p") return this.prevent(event, () => this.actions.openCommandSurface("commands"));
    if (mod && event.shiftKey && event.key.toLowerCase() === "f" && this.actions.workspaceOpen()) return this.prevent(event, () => this.actions.openCommandSurface("workspace"));
    if (mod && !event.shiftKey && event.key.toLowerCase() === "p" && this.actions.workspaceOpen()) return this.prevent(event, () => this.actions.openCommandSurface("files"));
    if (mod && !event.shiftKey && event.key.toLowerCase() === "e" && this.actions.workspaceOpen()) return this.prevent(event, () => this.actions.openCommandSurface("recent"));
    if (event.key === "Escape" && this.handleEscape()) {
      event.preventDefault();
      return;
    }
    if (mod && event.key.toLowerCase() === "r") return this.prevent(event, () => this.actions.refresh());
    if (mod && event.key.toLowerCase() === "s") {
      const tabId = this.actions.activeReadyTextTab();
      if (tabId) return this.prevent(event, () => this.actions.saveTextTab(tabId));
    }
    if (
      mod && event.key.toLowerCase() === "f" && !this.actions.commandSurfaceOpen() &&
      !event.defaultPrevented && !(event.target instanceof Element && event.target.closest(".cm-editor"))
    ) {
      event.preventDefault();
      if (event.target instanceof Element && event.target.closest("#bottom-tool") && this.actions.historyToolOpen()) {
        this.actions.focusHistoryFilter();
      } else if (this.actions.activeReadyTextTab()) {
        this.actions.openEditorFind();
      }
    }
  }

  private handleEscape(): boolean {
    if (this.actions.pushDiffOpen()) this.actions.closePushDiff();
    else if (this.actions.gitOperationDialogOpen()) this.actions.closeGitOperation();
    else if (this.actions.remoteDialogOpen() && !this.actions.remoteOperationActive()) this.actions.closeRemoteDialog();
    else if (this.actions.repositoryMenuOpen()) this.actions.closeRepositoryMenu(true);
    else if (this.actions.editorTabMenuOpen()) this.actions.closeEditorTabMenu();
    else if (!this.query("#repository-target-dialog").classList.contains("hidden")) this.actions.closeRepositoryTargetDialog();
    else if (this.actions.settingsOpen()) this.actions.closeSettings();
    else if (this.actions.replacementClosable()) this.actions.closeWorkspaceReplacement();
    else if (this.actions.commandSurfaceOpen()) this.actions.dismissCommandSurface();
    else {
      this.actions.closeRepositoryDialog();
      this.actions.closeHistoryDialog();
      if (this.actions.historyFilterOpen()) this.actions.closeHistoryFilter();
      else return false;
    }
    return true;
  }

  private handleWindowPointerdown(event: PointerEvent): void {
    if (!(event.target instanceof Element)) return;
    if (this.actions.repositoryMenuOpen() && !event.target.closest("#repository-switcher-anchor")) {
      this.actions.closeRepositoryMenu(false);
    }
    if (this.actions.editorTabMenuOpen() && !event.target.closest("#editor-tab-menu-anchor")) {
      this.actions.closeEditorTabMenu();
    }
    if (this.actions.historyFilterOpen() && !event.target.closest(".history-toolbar")) {
      this.actions.closeHistoryFilter();
    }
  }

  private trapRemoteDialogFocus(event: KeyboardEvent): void {
    this.trapDialogFocus(event, "#remote-action-dialog", this.actions.remoteDialogOpen());
  }

  private trapDialogFocus(event: KeyboardEvent, selector: string, open: boolean): void {
    if (event.key !== "Tab" || !open) return;
    const focusable = Array.from(this.query(selector).querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter((element) => !element.closest(".hidden, [inert]"));
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) this.prevent(event, () => last.focus());
    else if (!event.shiftKey && document.activeElement === last) this.prevent(event, () => first.focus());
  }

  private repositoryTargetPath(): string {
    return this.query("#repository-target-path").textContent?.trim() ?? "";
  }

  private prevent(event: Event, action: () => void): void {
    event.preventDefault();
    action();
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing shell element: ${selector}`);
    return element;
  }
}
