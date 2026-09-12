import {
  loadActivityOrder,
  moveActivityTool,
  moveActivityToolByOffset,
  saveActivityOrder,
  type ActivityDropPosition,
  type ActivityTool,
} from "../workbench/activity-order.ts";
import {
  clampWorkbenchLayout,
  loadWorkbenchLayout,
  reduceWorkbenchLayout,
  saveWorkbenchLayout,
  type WorkbenchLayout,
  type WorkbenchLayoutAction,
} from "../workbench/layout-state.ts";
import type { WindowChromeMode } from "../workbench/window-chrome.ts";

export interface ShellState {
  page: "workbench" | "settings";
  layout: WorkbenchLayout;
  activityOrder: ActivityTool[];
  repositoryMenuOpen: boolean;
  editorTabMenuOpen: boolean;
  windowChromeMode: WindowChromeMode;
}

export interface ShellChange {
  reason: "page" | "layout" | "activity" | "menu" | "chrome";
  pageChanged?: boolean;
  layoutChanged?: boolean;
  activityChanged?: boolean;
  menuChanged?: "repository" | "editor-tabs" | "all";
  chromeChanged?: boolean;
}

type Listener = (change: ShellChange) => void;

export class ShellController {
  readonly state: ShellState;

  private readonly listeners = new Set<Listener>();
  private readonly storage: Storage;
  private disposed = false;

  constructor(storage: Storage) {
    this.storage = storage;
    this.state = {
      page: "workbench",
      layout: loadWorkbenchLayout(storage),
      activityOrder: loadActivityOrder(storage),
      repositoryMenuOpen: false,
      editorTabMenuOpen: false,
      windowChromeMode: "custom-right",
    };
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  showPage(page: ShellState["page"]): boolean {
    if (this.state.page === page) return false;
    this.state.page = page;
    this.emit({ reason: "page", pageChanged: true });
    return true;
  }

  setWindowChromeMode(mode: WindowChromeMode): void {
    if (this.state.windowChromeMode === mode) return;
    this.state.windowChromeMode = mode;
    this.emit({ reason: "chrome", chromeChanged: true });
  }

  toggleRepositoryMenu(): boolean {
    this.state.repositoryMenuOpen = !this.state.repositoryMenuOpen;
    if (this.state.repositoryMenuOpen) this.state.editorTabMenuOpen = false;
    this.emit({ reason: "menu", menuChanged: "repository" });
    return this.state.repositoryMenuOpen;
  }

  toggleEditorTabMenu(): boolean {
    this.state.editorTabMenuOpen = !this.state.editorTabMenuOpen;
    if (this.state.editorTabMenuOpen) this.state.repositoryMenuOpen = false;
    this.emit({ reason: "menu", menuChanged: "editor-tabs" });
    return this.state.editorTabMenuOpen;
  }

  closeRepositoryMenu(): boolean {
    if (!this.state.repositoryMenuOpen) return false;
    this.state.repositoryMenuOpen = false;
    this.emit({ reason: "menu", menuChanged: "repository" });
    return true;
  }

  closeEditorTabMenu(): boolean {
    if (!this.state.editorTabMenuOpen) return false;
    this.state.editorTabMenuOpen = false;
    this.emit({ reason: "menu", menuChanged: "editor-tabs" });
    return true;
  }

  closeMenus(): void {
    if (!this.state.repositoryMenuOpen && !this.state.editorTabMenuOpen) return;
    this.state.repositoryMenuOpen = false;
    this.state.editorTabMenuOpen = false;
    this.emit({ reason: "menu", menuChanged: "all" });
  }

  setLayout(layout: WorkbenchLayout, persist = false): void {
    this.state.layout = layout;
    if (persist) saveWorkbenchLayout(this.storage, layout);
    this.emit({ reason: "layout", layoutChanged: true });
  }

  reduceLayout(action: WorkbenchLayoutAction, persist = false): void {
    this.setLayout(reduceWorkbenchLayout(this.state.layout, action), persist);
  }

  clampLayout(viewportWidth: number, viewportHeight: number): void {
    this.setLayout(
      clampWorkbenchLayout(this.state.layout, { width: viewportWidth, height: viewportHeight }),
      false,
    );
  }

  persistLayout(): void {
    saveWorkbenchLayout(this.storage, this.state.layout);
  }

  moveActivityByOffset(tool: ActivityTool, offset: -1 | 1): boolean {
    return this.setActivityOrder(moveActivityToolByOffset(this.state.activityOrder, tool, offset));
  }

  moveActivity(
    source: ActivityTool,
    target: ActivityTool,
    position: ActivityDropPosition,
  ): boolean {
    return this.setActivityOrder(moveActivityTool(this.state.activityOrder, source, target, position));
  }

  setActivityOrder(order: ActivityTool[]): boolean {
    if (order.every((tool, index) => tool === this.state.activityOrder[index])) return false;
    this.state.activityOrder = order;
    saveActivityOrder(this.storage, order);
    this.emit({ reason: "activity", activityChanged: true });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  private emit(change: ShellChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}
