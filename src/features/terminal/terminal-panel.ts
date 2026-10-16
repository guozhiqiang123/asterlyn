import type { TerminalCommandAction } from "../../application/commands/terminal-command-ids.ts";
import {
  isActiveTaskTerminalStatus,
  type TaskTerminalOutputFrame,
  type TaskTerminalSessionDescriptor,
  type TaskTerminalSessionPort,
  type TaskTerminalSessionStatus,
} from "../../application/tasks/task-terminal-session.ts";
import { icon } from "../../icons.ts";
import type { TerminalCopy } from "../../localization/catalog.ts";
import type { TaskExecutionCopy } from "../../localization/task-execution-copy.ts";
import type { TerminalBridge } from "../../protocol/terminal.ts";
import { TerminalEventRouter } from "./terminal-event-router.ts";
import {
  normalizeTaskTerminalOutput,
  renderTaskTerminalHeader,
  renderTerminalHeader,
  shouldAutoStartShell,
  taskTerminalActionAvailable,
  taskTerminalCommandLine,
  taskTerminalInteractionMode,
  taskTerminalSummary,
  terminalActionAvailable,
  terminalInteractionMode,
  terminalTaskCopy,
} from "./terminal-presentation.ts";
import { TerminalShellTab } from "./terminal-shell-tab.ts";
import { TerminalTaskTab } from "./terminal-task-tab.ts";
import { TerminalTabs, type TerminalTabRecord } from "./terminal-tabs.ts";

interface TerminalPanelFeedback {
  readonly status: (message: string, kind: "normal" | "busy" | "warning" | "success") => void;
  readonly error: (error: unknown) => void;
  readonly keyboard?: (event: KeyboardEvent) => boolean;
  readonly presentationChanged?: () => void;
}

type TerminalTabResource = TerminalShellTab | TerminalTaskTab;

/** Coordinates bounded terminal tabs while each tab owns its own controller/view lifecycle. */
export class TerminalPanel {
  private readonly root: HTMLElement;
  private readonly bridge: TerminalBridge;
  private readonly feedback: TerminalPanelFeedback;
  private readonly router: TerminalEventRouter;
  private readonly tabs = new TerminalTabs();
  private readonly resources = new Map<string, TerminalTabResource>();
  private copy: TerminalCopy;
  private taskCopy: TaskExecutionCopy;
  private visible = false;
  private workspaceRoot: string | null = null;
  private shellSequence = 0;

  constructor(
    root: HTMLElement,
    bridge: TerminalBridge,
    copy: TerminalCopy,
    feedback: TerminalPanelFeedback,
    locale: "en-US" | "zh-CN" = "en-US",
  ) {
    this.root = root;
    this.bridge = bridge;
    this.feedback = feedback;
    this.copy = copy;
    this.taskCopy = terminalTaskCopy(locale);
    this.router = new TerminalEventRouter(bridge);
  }

  installWorkspace(root: string): void {
    if (this.workspaceRoot === root) return;
    this.workspaceRoot = root;
    this.shellSequence = 0;
    this.disposeAllTabs();
    this.clearPanels();
    this.renderHeader();
  }

  activate(root: string): void {
    this.visible = true;
    this.installWorkspace(root);
    const host = this.host();
    if (!host) return;
    this.ensureScaffold(host);
    this.bindHeader();
    this.bindTabs(host);
    if (this.tabs.tabs.length === 0) this.createShellTab();
    this.renderTabs();
    this.syncPanels(true);
  }

  hide(): void {
    this.visible = false;
    this.renderHeader();
  }

  setCopy(copy: TerminalCopy, locale: "en-US" | "zh-CN" = "en-US"): void {
    this.copy = copy;
    this.taskCopy = terminalTaskCopy(locale);
    let shellIndex = 0;
    for (const tab of this.tabs.tabs) {
      const resource = this.resources.get(tab.id);
      if (resource instanceof TerminalShellTab) {
        resource.setCopy(copy);
        this.tabs.update(tab.id, { title: copy.shellTab(++shellIndex) });
      }
    }
    this.renderTabs();
    this.renderHeader();
  }

  refreshAppearance(): void {
    for (const resource of this.resources.values()) resource.refreshAppearance();
  }

  beginTask(session: TaskTerminalSessionDescriptor): void {
    this.installWorkspace(session.workspaceRoot);
    const result = this.tabs.createTask(session.sessionId, session.label);
    if (!result.ok) {
      this.feedback.error(new Error(this.copy.tabLimit));
      return;
    }
    if (result.evictedId) this.removeResource(result.evictedId);
    if (!this.resources.has(result.tab.id)) {
      this.resources.set(result.tab.id, new TerminalTaskTab(session, {
        error: (error) => this.feedback.error(error),
        keyboard: this.feedback.keyboard,
      }));
    }
    this.ensureVisibleScaffold();
    this.renderTabs();
    this.syncPanels(true);
    this.feedback.status(this.taskCopy.starting, "busy");
  }

  appendTask(sessionId: string, frame: TaskTerminalOutputFrame): void {
    this.findTask(sessionId)?.resource.append(frame);
  }

  updateTask(
    sessionId: string,
    status: TaskTerminalSessionStatus,
    error: string | null,
    outputTruncated: boolean,
  ): void {
    const match = this.findTask(sessionId);
    if (!match) return;
    match.resource.update(status, error, outputTruncated, this.taskCopy.outputTruncated);
    this.tabs.update(match.tab.id, { taskTerminal: match.resource.terminal });
    this.renderTabs();
    this.renderHeader();
    const presentation = {
      descriptor: match.resource.descriptor,
      status,
      error,
      outputTruncated,
      outputEndedWithCarriageReturn: false,
    };
    const kind = status === "succeeded"
      ? "success"
      : isActiveTaskTerminalStatus(status)
        ? "busy"
        : status === "cancelled"
          ? "normal"
          : "warning";
    this.feedback.status(taskTerminalSummary(presentation, this.taskCopy), kind);
  }

  revealTask(sessionId: string): boolean {
    const match = this.findTask(sessionId);
    if (!match) return false;
    this.selectTab(match.tab.id, true);
    return true;
  }

  commandAvailable(action: TerminalCommandAction): boolean {
    if (!this.visible) return false;
    return this.activeResource()?.commandAvailable(action) ?? false;
  }

  async executeCommand(action: TerminalCommandAction): Promise<void> {
    const resource = this.activeResource();
    if (!resource || !resource.commandAvailable(action)) return;
    await resource.executeCommand(action);
    if (action === "clear" && resource instanceof TerminalTaskTab) {
      this.feedback.status(this.copy.cleared, "success");
    }
    this.renderHeader();
  }

  dispose(): void {
    this.visible = false;
    this.disposeAllTabs();
    this.router.dispose();
    this.clearPanels();
  }

  private createShellTab(): void {
    const root = this.workspaceRoot;
    if (!root) return;
    const result = this.tabs.createShell(this.copy.shellTab(++this.shellSequence));
    if (!result.ok) {
      this.shellSequence -= 1;
      this.feedback.error(new Error(result.reason === "shell-limit" ? this.copy.shellLimit : this.copy.tabLimit));
      return;
    }
    this.resources.set(result.tab.id, new TerminalShellTab(
      this.routedBridge(),
      root,
      this.copy,
      {
        status: (message, kind) => this.feedback.status(message, kind),
        error: (error) => this.feedback.error(error),
        keyboard: this.feedback.keyboard,
        changed: () => {
          if (this.tabs.selectedId === result.tab.id) this.renderHeader();
        },
      },
    ));
    this.renderTabs();
    this.syncPanels(true);
  }

  private async closeTab(id: string): Promise<void> {
    const resource = this.resources.get(id);
    if (!resource) return;
    if (resource instanceof TerminalTaskTab) {
      if (!await resource.requestTabClose()) return;
    } else {
      await resource.closeTab();
    }
    this.resources.delete(id);
    this.panelElement(id)?.remove();
    this.tabs.close(id);
    this.renderTabs();
    this.syncPanels(true);
  }

  private selectTab(id: string, focus: boolean): void {
    if (!this.tabs.select(id)) return;
    this.renderTabs();
    this.syncPanels(focus);
  }

  private syncPanels(focus: boolean): void {
    const panels = this.panels();
    if (!panels) {
      this.renderHeader();
      return;
    }
    for (const tab of this.tabs.tabs) {
      const resource = this.resources.get(tab.id);
      if (!resource) continue;
      let panel = this.panelElement(tab.id);
      if (!panel) {
        panel = document.createElement("section");
        panel.id = panelId(tab.id);
        panel.className = "terminal-tab-panel";
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tabId(tab.id));
        panels.append(panel);
      }
      const selected = tab.id === this.tabs.selectedId;
      panel.classList.toggle("hidden", !selected);
      panel.hidden = !selected;
      if (selected) resource.mount(panel, focus);
    }
    this.renderHeader();
  }

  private renderTabs(): void {
    const list = this.host()?.querySelector<HTMLElement>(".terminal-tab-list");
    const newButton = this.host()?.querySelector<HTMLButtonElement>("[data-terminal-new]");
    if (!list || !newButton) return;
    list.setAttribute("aria-label", this.copy.tabs);
    newButton.setAttribute("aria-label", this.copy.newTab);
    newButton.setAttribute("title", this.copy.newTab);
    list.innerHTML = this.tabs.tabs.map((tab) => {
      const selected = tab.id === this.tabs.selectedId;
      const taskState = tab.kind === "task" && !tab.taskTerminal ? " running" : "";
      return `<div class="terminal-tab-item${selected ? " selected" : ""}${taskState}" data-terminal-tab-item="${escapeAttribute(tab.id)}">
        <button class="terminal-tab-button" id="${escapeAttribute(tabId(tab.id))}" type="button" role="tab" data-terminal-tab="${escapeAttribute(tab.id)}" aria-selected="${selected}" aria-controls="${escapeAttribute(panelId(tab.id))}" tabindex="${selected ? "0" : "-1"}" title="${escapeAttribute(tab.title)}">${icon(tab.kind === "shell" ? "terminal" : "list", 13)}<span>${escapeHtml(tab.title)}</span></button>
        <button class="terminal-tab-close" type="button" data-terminal-tab-close="${escapeAttribute(tab.id)}" aria-label="${escapeAttribute(this.copy.closeTab(tab.title))}" title="${escapeAttribute(this.copy.closeTab(tab.title))}">${icon("close", 11)}</button>
      </div>`;
    }).join("");
    this.feedback.presentationChanged?.();
  }

  private renderHeader(): void {
    const actions = this.root.querySelector<HTMLElement>("#terminal-header-actions");
    if (!actions) return;
    actions.classList.toggle("hidden", !this.visible);
    const resource = this.activeResource();
    actions.innerHTML = resource instanceof TerminalTaskTab
      ? resource.header(this.copy, this.taskCopy)
      : resource instanceof TerminalShellTab
        ? resource.header()
        : "";
    this.feedback.presentationChanged?.();
  }

  private bindHeader(): void {
    const actions = this.root.querySelector<HTMLElement>("#terminal-header-actions");
    if (!actions || actions.dataset.bound === "true") return;
    actions.dataset.bound = "true";
    actions.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-terminal-action]");
      if (!button || !actions.contains(button)) return;
      const action = button.dataset.terminalAction;
      if (action === "restart" || action === "clear" || action === "close") void this.executeCommand(action);
    });
  }

  private bindTabs(host: HTMLElement): void {
    if (host.dataset.terminalTabsBound === "true") return;
    host.dataset.terminalTabsBound = "true";
    host.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      const close = target?.closest<HTMLButtonElement>("[data-terminal-tab-close]");
      if (close && host.contains(close)) {
        void this.closeTab(close.dataset.terminalTabClose ?? "");
        return;
      }
      const tab = target?.closest<HTMLButtonElement>("[data-terminal-tab]");
      if (tab && host.contains(tab)) this.selectTab(tab.dataset.terminalTab ?? "", true);
      const create = target?.closest<HTMLButtonElement>("[data-terminal-new]");
      if (create && host.contains(create)) this.createShellTab();
    });
    host.addEventListener("keydown", (event) => this.handleTabKey(event));
  }

  private handleTabKey(event: KeyboardEvent): void {
    const target = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-terminal-tab]");
    if (!target) return;
    const index = this.tabs.tabs.findIndex((tab) => tab.id === target.dataset.terminalTab);
    if (index < 0) return;
    if (event.key === "Delete") {
      event.preventDefault();
      void this.closeTab(this.tabs.tabs[index]?.id ?? "");
      return;
    }
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % this.tabs.tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + this.tabs.tabs.length) % this.tabs.tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.tabs.tabs.length - 1;
    else return;
    event.preventDefault();
    const id = this.tabs.tabs[next]?.id;
    if (id) this.selectTab(id, true);
  }

  private ensureVisibleScaffold(): void {
    const host = this.host();
    if (!host) return;
    this.ensureScaffold(host);
    this.bindTabs(host);
  }

  private ensureScaffold(host: HTMLElement): void {
    if (host.querySelector(".terminal-tabs-toolbar") && host.querySelector(".terminal-tab-panels")) return;
    host.innerHTML = `<div class="terminal-tabs-toolbar"><div class="terminal-tab-list" role="tablist" aria-label="${escapeAttribute(this.copy.tabs)}"></div><button class="compact-icon-button terminal-new-tab" type="button" data-terminal-new aria-label="${escapeAttribute(this.copy.newTab)}" title="${escapeAttribute(this.copy.newTab)}">${icon("plus", 14)}</button></div><div class="terminal-tab-panels"></div>`;
  }

  private routedBridge(): TerminalBridge {
    return {
      native: this.bridge.native,
      startTerminal: (workspaceRoot, cols, rows) => this.bridge.startTerminal(workspaceRoot, cols, rows),
      writeTerminal: (sessionId, dataBase64) => this.bridge.writeTerminal(sessionId, dataBase64),
      resizeTerminal: (sessionId, cols, rows) => this.bridge.resizeTerminal(sessionId, cols, rows),
      closeTerminal: (sessionId) => this.bridge.closeTerminal(sessionId),
      subscribeTerminal: (listener) => this.router.subscribeTerminal(listener),
    };
  }

  private findTask(sessionId: string): { tab: TerminalTabRecord; resource: TerminalTaskTab } | null {
    const tab = this.tabs.tabs.find((candidate) => candidate.taskSessionId === sessionId);
    if (!tab) return null;
    const resource = this.resources.get(tab.id);
    return resource instanceof TerminalTaskTab ? { tab, resource } : null;
  }

  private activeResource(): TerminalTabResource | null {
    const id = this.tabs.selectedId;
    return id ? this.resources.get(id) ?? null : null;
  }

  private removeResource(id: string): void {
    this.resources.get(id)?.dispose();
    this.resources.delete(id);
    this.panelElement(id)?.remove();
  }

  private disposeAllTabs(): void {
    for (const resource of this.resources.values()) resource.dispose();
    this.resources.clear();
    this.tabs.clear();
  }

  private clearPanels(): void {
    this.panels()?.replaceChildren();
    this.renderTabs();
  }

  private host(): HTMLElement | null {
    return this.root.querySelector<HTMLElement>("#terminal-tool-host");
  }

  private panels(): HTMLElement | null {
    return this.host()?.querySelector<HTMLElement>(".terminal-tab-panels") ?? null;
  }

  private panelElement(id: string): HTMLElement | null {
    return this.host()?.querySelector<HTMLElement>(`#${panelId(id)}`) ?? null;
  }
}

export function taskTerminalPort(panel: TerminalPanel): TaskTerminalSessionPort {
  return {
    begin: (session) => panel.beginTask(session),
    append: (sessionId, frame) => panel.appendTask(sessionId, frame),
    update: (sessionId, status, error, outputTruncated) => panel.updateTask(sessionId, status, error, outputTruncated),
    reveal: (sessionId) => panel.revealTask(sessionId),
  };
}

export {
  normalizeTaskTerminalOutput,
  renderTaskTerminalHeader,
  renderTerminalHeader,
  shouldAutoStartShell,
  taskTerminalActionAvailable,
  taskTerminalCommandLine,
  taskTerminalInteractionMode,
  terminalActionAvailable,
  terminalInteractionMode,
};

function tabId(id: string): string { return `${id}-button`; }
function panelId(id: string): string { return `${id}-panel`; }

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
