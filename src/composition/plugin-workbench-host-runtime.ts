import type { TasksCopy } from "../localization/catalog.ts";
import { resolvePluginMessage } from "../application/plugins/plugin-localization.ts";
import type { PluginCompositionRuntime } from "./plugin-runtime.ts";
import type { PluginStagedRunPlan } from "../application/plugins/index.ts";
import type { PluginRunSessionSnapshot } from "./plugin-run-session-runtime.ts";
import { PluginWorkbenchContributionRuntime } from "./plugin-workbench-contribution-runtime.ts";

export interface PluginWorkbenchHostRuntimeOptions {
  readonly root: HTMLElement;
  readonly plugins: PluginCompositionRuntime;
  readonly copy: () => TasksCopy;
  readonly locale: () => "en-US" | "zh-CN";
  readonly reportError: (error: unknown) => void;
  readonly runSession: () => PluginRunSessionSnapshot | null;
  readonly executeRun: (request: PluginWorkbenchRunRequest) => Promise<void>;
  readonly cancelRun: () => void;
}

export interface PluginWorkbenchRunRequest {
  readonly pluginId: string;
  readonly label: string;
  readonly plan: PluginStagedRunPlan;
  readonly revalidateTarget: () => Promise<boolean>;
}

/** Owns the optional host-rendered workbench shell after a plugin contributes one. */
export class PluginWorkbenchHostRuntime {
  private readonly root: HTMLElement;
  private readonly plugins: PluginCompositionRuntime;
  private readonly copy: () => TasksCopy;
  private readonly locale: () => "en-US" | "zh-CN";
  private readonly reportError: (error: unknown) => void;
  private readonly runSession: () => PluginRunSessionSnapshot | null;
  private readonly executeRun: (request: PluginWorkbenchRunRequest) => Promise<void>;
  private readonly cancelRun: () => void;
  private readonly contributions: PluginWorkbenchContributionRuntime;
  private abort: AbortController | null = null;
  private activeView = "tasks";
  private renderRevision = 0;
  private disposed = false;

  constructor(options: PluginWorkbenchHostRuntimeOptions) {
    this.root = options.root;
    this.plugins = options.plugins;
    this.copy = options.copy;
    this.locale = options.locale;
    this.reportError = options.reportError;
    this.runSession = options.runSession;
    this.executeRun = options.executeRun;
    this.cancelRun = options.cancelRun;
    let ready = false;
    this.contributions = new PluginWorkbenchContributionRuntime(
      this.plugins.contributionRegistry,
      () => { if (ready) this.render(); },
      this.reportError,
    );
    ready = true;
  }

  title(): string {
    const entry = this.activeWorkspaceTool();
    return entry?.workspaceTool
      ? resolvePluginMessage(entry.localization, this.locale(), entry.workspaceTool.titleKey)
      : this.copy().title;
  }

  render(): void {
    if (this.disposed) return;
    const tabs = this.root.querySelector<HTMLElement>("#plugin-workbench-tabs");
    const view = this.root.querySelector<HTMLElement>("#plugin-workbench-view");
    const tasks = this.root.querySelector<HTMLElement>("#tasks-view-host");
    const runAction = this.root.querySelector<HTMLButtonElement>("#plugin-run-action");
    const refreshAction = this.root.querySelector<HTMLButtonElement>("#tasks-header-refresh");
    if (!tabs || !view || !tasks || !runAction || !refreshAction) return;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const entry = this.activeWorkspaceTool();
    const tool = entry?.workspaceTool;
    if (!entry || !tool) {
      tabs.innerHTML = "";
      tabs.classList.add("hidden");
      view.classList.add("hidden");
      tasks.classList.remove("hidden");
      runAction.classList.add("hidden");
      return;
    }
    if (!tool.views.some((candidate) => candidate.id === this.activeView)) {
      this.activeView = tool.defaultView;
    }
    tabs.classList.remove("hidden");
    tabs.setAttribute("aria-label", this.title());
    tabs.innerHTML = tool.views.map((candidate) => {
      const label = resolvePluginMessage(entry.localization, this.locale(), candidate.labelKey);
      const selected = candidate.id === this.activeView;
      return `<button type="button" class="plugin-workbench-tab${selected ? " active" : ""}" data-plugin-workbench-view="${escapeAttribute(candidate.id)}" role="tab" aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}">${escapeHtml(label)}</button>`;
    }).join("");
    const showTasks = this.activeView === "tasks";
    const showDevices = this.activeView === "devices";
    const showRun = this.activeView === "run";
    tasks.classList.toggle("hidden", !showTasks);
    view.classList.toggle("hidden", showTasks);
    refreshAction.classList.toggle("hidden", showRun);
    runAction.classList.toggle("hidden", !showRun);
    const snapshot = this.contributions.snapshot();
    if (showTasks) {
      refreshAction.setAttribute("aria-label", this.copy().refresh);
      refreshAction.title = this.copy().refresh;
    }
    if (showDevices) {
      const provider = snapshot.targetProviders.find((candidate) => candidate.pluginId === entry.id);
      const refreshLabel = resolvePluginMessage(entry.localization, this.locale(), "device.action.refresh");
      refreshAction.disabled = provider?.snapshot.status === "loading";
      refreshAction.setAttribute("aria-label", refreshLabel);
      refreshAction.title = refreshLabel;
      refreshAction.addEventListener("click", () => {
        if (provider) void this.contributions.refreshTargets(provider.qualifiedId).catch(this.reportError);
      }, { signal: abort.signal });
    }
    if (showRun) {
      const provider = snapshot.runConfigurationProviders.find((candidate) => candidate.pluginId === entry.id);
      const providerSnapshot = provider?.snapshot;
      const selected = providerSnapshot?.configurations.find(
        (candidate) => candidate.id === providerSnapshot.selectedConfigurationId,
      ) ?? providerSnapshot?.configurations[0];
      const targets = selected?.targetProviderId
        ? snapshot.targetProviders.find((candidate) => candidate.pluginId === entry.id && candidate.providerId === selected.targetProviderId)
        : undefined;
      const selectedTarget = targets?.snapshot.targets.find((candidate) => candidate.id === targets.snapshot.selectedTargetId);
      const running = this.runSession()?.status === "running";
      const runLabel = resolvePluginMessage(entry.localization, this.locale(), "panel.run");
      runAction.disabled = !running && (selected?.status !== "ready" || !provider?.snapshot || !targets || selectedTarget?.status !== "online" || !selectedTarget.selectable);
      runAction.setAttribute("aria-label", runLabel);
      runAction.title = runLabel;
      runAction.addEventListener("click", () => {
        if (running) {
          this.cancelRun();
          return;
        }
        if (!provider || !selected || !targets || !selectedTarget) return;
        void this.contributions.createRunPlan(provider.qualifiedId, selected.id, selectedTarget.id).then((plan) => {
          if (!plan || !("kind" in plan) || plan.kind !== "staged") {
            throw new Error(`Run configuration did not return a staged plan: ${selected.id}`);
          }
          return this.executeRun({
            pluginId: entry.id,
            label: selected.label,
            plan,
            revalidateTarget: () => this.contributions.revalidateTarget(entry.id, selected.targetProviderId as string, selectedTarget.id),
          });
        }).catch(this.reportError);
      }, { signal: abort.signal });
    }
    view.innerHTML = "";
    const revision = ++this.renderRevision;
    if (!showTasks) {
      const viewId = this.activeView;
      void import("./plugin-workbench-view.ts").then(({ renderPluginWorkbenchView }) => {
        if (this.disposed || this.renderRevision !== revision || this.activeView !== viewId || !view.isConnected) return;
        view.innerHTML = renderPluginWorkbenchView(viewId, entry.id, snapshot, entry, this.locale(), this.runSession());
      }).catch(this.reportError);
    }
    tabs.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-plugin-workbench-view]")
        : null;
      const next = target?.dataset.pluginWorkbenchView;
      if (!next || next === this.activeView) return;
      this.activeView = next;
      this.render();
    }, { signal: abort.signal });
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = [...tabs.querySelectorAll<HTMLButtonElement>("[data-plugin-workbench-view]")];
      const current = event.target instanceof HTMLButtonElement ? buttons.indexOf(event.target) : -1;
      if (current < 0 || buttons.length === 0) return;
      event.preventDefault();
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.click();
      queueMicrotask(() => tabs.querySelector<HTMLButtonElement>("[aria-selected='true']")?.focus());
    }, { signal: abort.signal });
    view.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const refresh = target?.closest<HTMLElement>("[data-target-provider-refresh]")?.dataset.targetProviderRefresh;
      if (refresh) void this.contributions.refreshTargets(refresh).catch(this.reportError);
      const targetId = target?.closest<HTMLElement>("[data-execution-target]")?.dataset.executionTarget;
      const providerId = target?.closest<HTMLElement>("[data-execution-target-provider]")?.dataset.executionTargetProvider;
      if (targetId && providerId) void this.contributions.selectTarget(providerId, targetId).catch(this.reportError);
    }, { signal: abort.signal });
    view.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      const runProvider = target.dataset.runConfigurationProvider;
      if (runProvider) void this.contributions.selectRunConfiguration(runProvider, target.value).catch(this.reportError);
      const targetProvider = target.dataset.runTargetProvider;
      if (targetProvider) void this.contributions.selectTarget(targetProvider, target.value || null).catch(this.reportError);
    }, { signal: abort.signal });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderRevision += 1;
    this.abort?.abort();
    this.abort = null;
    this.contributions.dispose();
  }

  private activeWorkspaceTool() {
    return this.plugins.managementSnapshot.entries.find(
      (entry) => entry.active && entry.workspaceTool !== undefined,
    ) ?? null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string { return escapeHtml(value).replace(/`/gu, "&#96;"); }
