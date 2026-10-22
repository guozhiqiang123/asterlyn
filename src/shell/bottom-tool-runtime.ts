import type { NavigationCopy, ReplacementCopy, ShellCopy, TasksCopy } from "../localization/catalog.ts";
import type { BottomTool } from "./layout-state.ts";
import { bottomToolPresentation } from "./bottom-tool-presentation.ts";
import type { PluginSettingsTargetResolution } from "../application/plugins/plugin-types.ts";

export interface BottomToolRuntimeOptions {
  readonly tool: () => BottomTool;
  readonly shellCopy: () => ShellCopy;
  readonly navigationCopy: () => NavigationCopy;
  readonly replacementCopy: () => ReplacementCopy;
  readonly tasksCopy: () => TasksCopy;
  readonly tasksTitle?: () => string;
  readonly workspaceRoot: () => string | null;
  readonly gitAvailable: () => boolean;
  readonly activateTerminal: (workspaceRoot: string) => void;
  readonly hideTerminal: () => void;
  readonly renderGit: () => void;
  readonly renderStash: () => void;
  readonly renderFind: () => void;
  readonly renderReplace: () => void;
  readonly renderTasks: () => void;
  readonly pluginSettingsTargets?: () => PluginSettingsTargetResolution;
  readonly openPluginSettings?: (target: PluginSettingsTargetResolution) => void;
}

export class BottomToolRuntime {
  private readonly root: HTMLElement;
  private readonly options: BottomToolRuntimeOptions;

  constructor(
    root: HTMLElement,
    options: BottomToolRuntimeOptions,
  ) {
    this.root = root;
    this.options = options;
  }

  private settingsButtonBound = false;

  render(): void {
    const tool = this.options.tool();
    if (!tool) return;
    const navigation = this.options.navigationCopy();
    const presentation = bottomToolPresentation(tool, this.options.shellCopy(), navigation, this.options.replacementCopy(), this.options.tasksCopy());
    const title = this.query("#bottom-tool-title");
    const hide = this.query<HTMLButtonElement>("#hide-bottom-tool");
    title.textContent = presentation.showTasks ? (this.options.tasksTitle?.() ?? presentation.title) : presentation.title;
    hide.setAttribute("aria-label", presentation.hideLabel);
    hide.title = presentation.hideLabel;
    const tasksRefresh = this.query<HTMLButtonElement>("#tasks-header-refresh");
    tasksRefresh.classList.toggle("hidden", !presentation.showTasks);
    tasksRefresh.setAttribute("aria-label", this.options.tasksCopy().refresh);
    tasksRefresh.title = this.options.tasksCopy().refresh;
    const pluginSettings = this.query<HTMLButtonElement>("#plugin-settings-open");
    const target = presentation.showTasks ? (this.options.pluginSettingsTargets?.() ?? null) : null;
    const hasOwner = target !== null && (!Array.isArray(target) || target.length > 0);
    pluginSettings.classList.toggle("hidden", !presentation.showTasks || !hasOwner || !this.options.openPluginSettings);
    const settingsLabel = this.options.shellCopy().pluginSettings;
    pluginSettings.setAttribute("aria-label", settingsLabel);
    pluginSettings.title = settingsLabel;
    if (!this.settingsButtonBound) {
      this.settingsButtonBound = true;
      pluginSettings.addEventListener("click", () => {
        const current = this.options.pluginSettingsTargets?.() ?? null;
        if (current !== null && (!Array.isArray(current) || current.length > 0)) this.options.openPluginSettings?.(current);
      });
    }
    this.query("#terminal-header-actions").classList.toggle("hidden", !presentation.showTerminal);
    this.query("#git-tool-grid").classList.toggle("hidden", !presentation.showGit);
    this.query("#stash-tool-grid").classList.toggle("hidden", !presentation.showStash);
    this.query("#terminal-tool-host").classList.toggle("hidden", !presentation.showTerminal);
    const find = this.query("#find-tool-host");
    find.classList.toggle("hidden", !presentation.showFind);
    find.setAttribute("aria-label", navigation.findResultsAria);
    this.query("#replacement-tool-host").classList.toggle("hidden", !presentation.showReplace);
    this.query("#tasks-tool-host").classList.toggle("hidden", !presentation.showTasks);
    this.query("#bottom-tool").setAttribute("aria-label", presentation.ariaLabel);
    if (presentation.showTerminal) {
      const workspaceRoot = this.options.workspaceRoot();
      if (workspaceRoot) this.options.activateTerminal(workspaceRoot);
      return;
    }
    this.options.hideTerminal();
    if (presentation.showTasks) {
      this.options.renderTasks();
    } else if (presentation.showFind) {
      this.options.renderFind();
    } else if (presentation.showReplace) {
      this.options.renderReplace();
    } else if (this.options.gitAvailable()) {
      if (presentation.showStash) this.options.renderStash();
      else this.options.renderGit();
    }
  }

  relocalize(): void {
    const scroll = new Map<string, [number, number]>();
    for (const selector of SCROLL_HOSTS) {
      const host = this.root.querySelector<HTMLElement>(selector);
      if (host) scroll.set(selector, [host.scrollTop, host.scrollLeft]);
    }
    this.render();
    for (const [selector, [top, left]] of scroll) {
      const host = this.root.querySelector<HTMLElement>(selector);
      if (host) {
        host.scrollTop = top;
        host.scrollLeft = left;
      }
    }
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing bottom tool element: ${selector}`);
    return element;
  }
}

const SCROLL_HOSTS = [
  "#branch-navigation-body",
  "#history-results",
  "#git-detail-body",
  ".find-results-list",
  ".replacement-tool-file-list",
  "#tasks-tool-host",
] as const;
