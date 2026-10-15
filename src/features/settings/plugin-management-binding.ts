import type {
  PluginManagementSnapshot,
  PluginSettingValue,
} from "../../application/plugins/plugin-types.ts";
import type { PluginManagementCopy } from "./plugin-management-view.ts";
import { renderPluginManagementSection } from "./plugin-management-view.ts";

export interface PluginManagementHost {
  readonly pluginManagementSnapshot: PluginManagementSnapshot;
  loadPluginManagement(): Promise<PluginManagementSnapshot>;
  subscribePluginManagement(listener: (snapshot: PluginManagementSnapshot) => void): () => void;
  setPluginEnabled(pluginId: string, enabled: boolean): boolean;
  setPluginSetting(pluginId: string, settingId: string, value: PluginSettingValue): boolean;
}

export interface PluginManagementBindingOptions {
  readonly visible: () => boolean;
  readonly render: (focusSelector?: string) => void;
  readonly reportError: (error: unknown) => void;
}

export interface PluginSettingsFocusTarget {
  readonly pluginId?: string;
  readonly focus?: string;
}

/** Owns plugin Settings loading, controls, and typed focus without leaking it into App. */
export class PluginManagementBinding {
  private loading = false;
  private loaded = false;
  private pendingFocus: PluginSettingsFocusTarget | null = null;
  private readonly release: () => void;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: PluginManagementHost,
    private readonly options: PluginManagementBindingOptions,
  ) {
    this.release = host.subscribePluginManagement(() => {
      if (this.options.visible()) this.options.render();
    });
  }

  enter(target?: PluginSettingsFocusTarget): void {
    this.pendingFocus = target?.pluginId ? target : null;
    this.ensureCatalog();
  }

  render(copy: PluginManagementCopy): string {
    return renderPluginManagementSection(this.host.pluginManagementSnapshot, copy, this.loading);
  }

  bind(): void {
    this.root
      .querySelectorAll<HTMLInputElement>('input[data-plugin-setting="enabled"]')
      .forEach((input) => input.addEventListener("change", () => {
        const pluginId = input.dataset.pluginId;
        if (pluginId && this.host.setPluginEnabled(pluginId, input.checked)) {
          this.options.render(`#${CSS.escape(input.id)}`);
        }
      }));
    this.root
      .querySelectorAll<HTMLSelectElement>("select[data-plugin-setting]")
      .forEach((select) => select.addEventListener("change", () => {
        const pluginId = select.dataset.pluginId;
        const settingId = select.dataset.pluginSetting;
        if (pluginId && settingId && this.host.setPluginSetting(pluginId, settingId, select.value)) {
          this.options.render(`#${CSS.escape(select.id)}`);
        }
      }));
    this.root
      .querySelectorAll<HTMLInputElement>('input[data-plugin-setting]:not([data-plugin-setting="enabled"])')
      .forEach((input) => input.addEventListener("change", () => {
        const pluginId = input.dataset.pluginId;
        const settingId = input.dataset.pluginSetting;
        if (pluginId && settingId && this.host.setPluginSetting(pluginId, settingId, input.checked)) {
          this.options.render(`#${CSS.escape(input.id)}`);
        }
      }));
    this.focusPendingTarget();
  }

  dispose(): void { this.release(); }

  private ensureCatalog(): void {
    if (this.loaded || this.loading) return;
    this.loading = true;
    void this.host.loadPluginManagement().then(() => {
      this.loading = false;
      this.loaded = true;
      if (this.options.visible()) this.options.render();
    }).catch((error) => {
      this.loading = false;
      this.options.reportError(error);
      if (this.options.visible()) this.options.render();
    });
  }

  private focusPendingTarget(): void {
    const target = this.pendingFocus;
    if (!target?.pluginId) return;
    queueMicrotask(() => {
      const card = this.root.querySelector<HTMLElement>(
        `.plugin-management-card[data-plugin-id="${CSS.escape(target.pluginId ?? "")}"]`,
      );
      if (!card) {
        if (this.loaded) this.pendingFocus = null;
        return;
      }
      const control = target.focus
        ? card.querySelector<HTMLElement>(`[data-plugin-setting="${CSS.escape(target.focus)}"]`)
        : null;
      card.classList.add("settings-route-target");
      (control ?? card).focus();
      card.scrollIntoView({ block: "nearest" });
      this.pendingFocus = null;
    });
  }
}
