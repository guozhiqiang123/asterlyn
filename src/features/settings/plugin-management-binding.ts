import type {
  PluginManagementSnapshot,
  PluginSettingValue,
} from "../../application/plugins/plugin-types.ts";
import type { PluginManagementCopy } from "./plugin-management-view.ts";
import {
  nextPluginManagementTab,
  renderPluginManagementSection,
  type PluginMarketplaceViewState,
} from "./plugin-management-view.ts";
import type { PluginInstallationSnapshot, PluginMarketplaceBridge, PluginPackageAdmissionReview, PluginSourceSnapshot } from "../../protocol/plugin-marketplace.ts";

export interface PluginManagementHost {
  readonly pluginManagementSnapshot: PluginManagementSnapshot;
  loadPluginManagement(): Promise<PluginManagementSnapshot>;
  subscribePluginManagement(listener: (snapshot: PluginManagementSnapshot) => void): () => void;
  setPluginEnabled(pluginId: string, enabled: boolean): boolean;
  setPluginSetting(pluginId: string, settingId: string, value: PluginSettingValue): boolean;
  setPluginWorkspaceTrust(pluginId: string, trusted: boolean): Promise<boolean>;
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
  private tab: PluginMarketplaceViewState["tab"] = "installed";
  private marketplaceSnapshot: PluginSourceSnapshot | null = null;
  private marketplaceLoading = false;
  private marketplaceLoaded = false;
  private marketplaceError: string | null = null;
  private busyRepository: string | null = null;
  private sourceForm: PluginMarketplaceViewState["form"] = null;
  private confirmDeleteRepository: string | null = null;
  private admissionReview: PluginPackageAdmissionReview | null = null;
  private installations: PluginInstallationSnapshot | null = null;
  private restarting = false;
  private restartRequired = false;
  private busyPlugin: string | null = null;
  private confirmUninstallPlugin: string | null = null;
  private confirmEnablePlugin: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: PluginManagementHost,
    private readonly marketplace: PluginMarketplaceBridge,
    private readonly options: PluginManagementBindingOptions,
  ) {
    this.release = host.subscribePluginManagement(() => {
      if (this.options.visible()) this.options.render();
    });
  }

  enter(target?: PluginSettingsFocusTarget): void {
    this.pendingFocus = target?.pluginId ? target : null;
    if (target?.pluginId) this.tab = "installed";
    this.ensureCatalog();
  }

  render(copy: PluginManagementCopy): string {
    return renderPluginManagementSection(this.host.pluginManagementSnapshot, copy, this.loading, {
      tab: this.tab,
      snapshot: this.marketplaceSnapshot,
      loading: this.marketplaceLoading,
      error: this.marketplaceError,
      busyRepository: this.busyRepository,
      form: this.sourceForm,
      confirmDeleteRepository: this.confirmDeleteRepository,
      admissionReview: this.admissionReview,
      installations: this.installations,
      restarting: this.restarting,
      restartRequired: this.restartRequired,
      busyPlugin: this.busyPlugin,
      confirmUninstallPlugin: this.confirmUninstallPlugin,
      confirmEnablePlugin: this.confirmEnablePlugin,
    });
  }

  bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-plugin-management-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.pluginManagementTab;
        if (tab !== "installed" && tab !== "marketplace") return;
        this.tab = tab;
        this.marketplaceError = null;
        this.options.render(`[data-plugin-management-tab="${tab}"]`);
      });
      button.addEventListener("keydown", (event) => {
        const current = button.dataset.pluginManagementTab;
        if (current !== "installed" && current !== "marketplace") return;
        const next = nextPluginManagementTab(current, event.key);
        if (!next) return;
        event.preventDefault();
        this.tab = next;
        this.marketplaceError = null;
        this.options.render(`[data-plugin-management-tab="${next}"]`);
      });
    });
    this.root
      .querySelectorAll<HTMLInputElement>('input[data-plugin-setting="enabled"]')
      .forEach((input) => input.addEventListener("change", () => {
        const pluginId = input.dataset.pluginId;
        if (pluginId && this.host.setPluginEnabled(pluginId, input.checked)) {
          this.options.render(`#${CSS.escape(input.id)}`);
        }
      }));
    this.root
      .querySelectorAll<HTMLInputElement>("input[data-plugin-workspace-trust]")
      .forEach((input) => input.addEventListener("change", () => {
        const pluginId = input.dataset.pluginId;
        if (!pluginId) return;
        input.disabled = true;
        void this.host.setPluginWorkspaceTrust(pluginId, input.checked).then(() => {
          this.options.render(`#${CSS.escape(input.id)}`);
        }).catch((error) => {
          this.options.reportError(error);
          this.options.render(`#${CSS.escape(input.id)}`);
        });
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
    this.bindMarketplace();
    this.focusPendingTarget();
  }

  dispose(): void { this.release(); }

  private ensureCatalog(): void {
    if (!this.loaded && !this.loading) {
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
    if (!this.marketplaceLoaded && !this.marketplaceLoading) {
      this.marketplaceLoading = true;
      void Promise.all([this.marketplace.listPluginSources(), this.marketplace.listPluginInstallations()]).then(([snapshot, installations]) => {
        this.marketplaceSnapshot = snapshot; this.installations = installations;
        this.marketplaceLoaded = true;
        this.marketplaceError = snapshot.recovered
          ? "The current source catalog was damaged; Asterlyn restored the previous saved generation."
          : null;
      }).catch((error) => {
        this.marketplaceError = errorMessage(error);
        this.options.reportError(error);
      }).finally(() => {
        this.marketplaceLoading = false;
        if (this.options.visible()) this.options.render();
      });
    }
  }

  private bindMarketplace(): void {
    this.root.querySelectorAll<HTMLInputElement>("[data-installed-plugin-enabled]").forEach((input) => {
      input.addEventListener("change", () => {
        const pluginId = input.dataset.installedPluginEnabled;
        if (!pluginId) return;
        if (input.checked) {
          this.confirmEnablePlugin = pluginId;
          this.confirmUninstallPlugin = null;
          this.options.render("[data-installed-plugin-enable-confirm]");
          return;
        }
        this.confirmEnablePlugin = null;
        void this.mutateInstallation(
          pluginId,
          () => this.marketplace.setInstalledPluginEnabled(pluginId, false),
        );
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-installed-plugin-enable-cancel]")?.addEventListener("click", () => {
      const pluginId = this.confirmEnablePlugin;
      this.confirmEnablePlugin = null;
      this.options.render(pluginId ? `[data-installed-plugin-enabled="${CSS.escape(pluginId)}"]` : undefined);
    });
    this.root.querySelector<HTMLButtonElement>("[data-installed-plugin-enable-confirm]")?.addEventListener("click", (event) => {
      const pluginId = (event.currentTarget as HTMLButtonElement).dataset.installedPluginEnableConfirm;
      if (pluginId) void this.mutateInstallation(
        pluginId,
        () => this.marketplace.setInstalledPluginEnabled(pluginId, true),
        () => { this.confirmEnablePlugin = null; },
      );
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-installed-plugin-rollback]").forEach((button) => {
      button.addEventListener("click", () => {
        const pluginId = button.dataset.installedPluginRollback;
        const version = button.dataset.pluginVersion;
        const digest = button.dataset.packageDigest;
        if (pluginId && version && digest) void this.mutateInstallation(
          pluginId,
          () => this.marketplace.selectInstalledPluginRollback(pluginId, version, digest),
        );
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-installed-plugin-repair]").forEach((button) => {
      button.addEventListener("click", () => {
        const pluginId = button.dataset.installedPluginRepair;
        const version = button.dataset.pluginVersion;
        const digest = button.dataset.packageDigest;
        if (!pluginId || !version || !digest) return;
        const requiresRestart = this.installations?.plugins.find(
          (candidate) => candidate.pluginId === pluginId,
        )?.enabled ?? true;
        void this.mutateInstallation(
          pluginId,
          () => this.marketplace.repairInstalledPluginVersion(pluginId, version, digest),
          () => undefined,
          requiresRestart,
        );
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-installed-plugin-uninstall]").forEach((button) => {
      button.addEventListener("click", () => {
        this.confirmUninstallPlugin = button.dataset.installedPluginUninstall ?? null;
        this.confirmEnablePlugin = null;
        this.options.render("[data-installed-plugin-uninstall-cancel]");
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-installed-plugin-uninstall-cancel]")?.addEventListener("click", () => {
      const pluginId = this.confirmUninstallPlugin;
      this.confirmUninstallPlugin = null;
      this.options.render(pluginId ? `[data-installed-plugin-uninstall="${CSS.escape(pluginId)}"]` : undefined);
    });
    this.root.querySelector<HTMLButtonElement>("[data-installed-plugin-uninstall-confirm]")?.addEventListener("click", (event) => {
      const pluginId = (event.currentTarget as HTMLButtonElement).dataset.installedPluginUninstallConfirm;
      if (pluginId) void this.mutateInstallation(
        pluginId,
        () => this.marketplace.uninstallInstalledPlugin(pluginId),
        () => { this.confirmUninstallPlugin = null; },
      );
    });
    this.root.querySelector<HTMLButtonElement>("[data-plugin-source-add]")?.addEventListener("click", () => {
      this.sourceForm = { repository: "", name: "", description: "", editing: false };
      this.confirmDeleteRepository = null;
      this.marketplaceError = null;
      this.options.render('[data-plugin-source-form] input[name="repository"]');
    });
    this.root.querySelector<HTMLButtonElement>("[data-plugin-source-form-cancel]")?.addEventListener("click", () => {
      this.sourceForm = null;
      this.marketplaceError = null;
      this.options.render("[data-plugin-source-add]");
    });
    this.root.querySelector<HTMLFormElement>("[data-plugin-source-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const repository = this.sourceForm?.editing
        ? this.sourceForm.repository
        : form.querySelector<HTMLInputElement>('input[name="repository"]')?.value ?? "";
      const name = form.querySelector<HTMLInputElement>('input[name="name"]')?.value ?? "";
      const description = form.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.value ?? "";
      void this.mutateSource(repository, () => this.marketplace.upsertPluginSource(repository, name, description), () => {
        this.sourceForm = null;
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-plugin-source-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const repository = button.dataset.pluginSourceEdit;
        const source = this.marketplaceSnapshot?.sources.find((candidate) => candidate.repository === repository);
        if (!source || source.builtIn) return;
        this.sourceForm = {
          repository: source.repository,
          name: source.name,
          description: source.description,
          editing: true,
        };
        this.confirmDeleteRepository = null;
        this.marketplaceError = null;
        this.options.render('[data-plugin-source-form] input[name="name"]');
      });
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-plugin-source-enabled]").forEach((input) => {
      input.addEventListener("change", () => {
        const repository = input.dataset.pluginSourceEnabled;
        if (repository) void this.mutateSource(
          repository,
          () => this.marketplace.setPluginSourceEnabled(repository, input.checked),
        );
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-plugin-source-refresh]").forEach((button) => {
      button.addEventListener("click", () => {
        const repository = button.dataset.pluginSourceRefresh;
        if (repository) void this.mutateSource(repository, () => this.marketplace.refreshPluginSource(repository));
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-plugin-source-install]").forEach((button) => button.addEventListener("click", () => {
      const repository = button.dataset.pluginSourceInstall;
      if (!repository || this.busyRepository) return;
      this.busyRepository = repository;
      this.marketplaceError = null;
      this.options.render();
      void this.marketplace.preparePluginInstall(repository).then((review) => { this.admissionReview = review; })
        .catch((error) => { this.marketplaceError = errorMessage(error); this.options.reportError(error); })
        .finally(() => { this.busyRepository = null; if (this.options.visible()) this.options.render("[data-plugin-admission-confirm]"); });
    }));
    this.root.querySelector<HTMLButtonElement>("[data-plugin-admission-cancel]")?.addEventListener("click", () => {
      const token = this.admissionReview?.reviewToken; this.admissionReview = null;
      if (token) void this.marketplace.cancelPluginInstall(token).catch((error) => this.options.reportError(error));
      this.options.render();
    });
    this.root.querySelector<HTMLButtonElement>("[data-plugin-admission-confirm]")?.addEventListener("click", () => {
      const review = this.admissionReview; if (!review || this.busyRepository) return;
      this.busyRepository = review.repository; this.options.render();
      void this.marketplace.confirmPluginInstall(review.reviewToken).then(async (snapshot) => {
        this.installations = snapshot;
        this.admissionReview = null;
        this.tab = "installed";
        await this.host.loadPluginManagement();
      })
        .catch((error) => { this.marketplaceError = errorMessage(error); this.options.reportError(error); })
        .finally(() => { this.busyRepository = null; if (this.options.visible()) this.options.render(); });
    });
    this.root.querySelector<HTMLButtonElement>("[data-plugin-restart]")?.addEventListener("click", () => {
      if (this.restarting) return;
      this.restarting = true;
      this.marketplaceError = null;
      this.options.render("[data-plugin-restart]");
      void this.marketplace.restartForPluginChanges().catch((error) => {
        this.restarting = false;
        this.marketplaceError = errorMessage(error);
        this.options.reportError(error);
        if (this.options.visible()) this.options.render("[data-plugin-restart]");
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>("[data-plugin-source-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        this.confirmDeleteRepository = button.dataset.pluginSourceDelete ?? null;
        this.sourceForm = null;
        this.options.render("[data-plugin-source-delete-cancel]");
      });
    });
    this.root.querySelector<HTMLButtonElement>("[data-plugin-source-delete-cancel]")?.addEventListener("click", () => {
      const repository = this.confirmDeleteRepository;
      this.confirmDeleteRepository = null;
      this.options.render(repository ? `[data-plugin-source-delete="${CSS.escape(repository)}"]` : undefined);
    });
    this.root.querySelector<HTMLButtonElement>("[data-plugin-source-delete-confirm]")?.addEventListener("click", (event) => {
      const repository = (event.currentTarget as HTMLButtonElement).dataset.pluginSourceDeleteConfirm;
      if (repository) void this.mutateSource(
        repository,
        () => this.marketplace.removePluginSource(repository),
        () => { this.confirmDeleteRepository = null; },
      );
    });
  }

  private async mutateSource(
    repository: string,
    operation: () => Promise<PluginSourceSnapshot>,
    completed: () => void = () => undefined,
  ): Promise<void> {
    if (this.busyRepository !== null) return;
    this.busyRepository = repository || "new-source";
    this.marketplaceError = null;
    if (this.options.visible()) this.options.render();
    try {
      this.marketplaceSnapshot = await operation();
      this.marketplaceLoaded = true;
      completed();
    } catch (error) {
      this.marketplaceError = errorMessage(error);
      this.options.reportError(error);
    } finally {
      this.busyRepository = null;
      if (this.options.visible()) this.options.render();
    }
  }

  private async mutateInstallation(
    pluginId: string,
    operation: () => Promise<PluginInstallationSnapshot>,
    completed: () => void = () => undefined,
    requiresRestart = true,
  ): Promise<void> {
    if (this.busyPlugin !== null) return;
    this.busyPlugin = pluginId;
    this.marketplaceError = null;
    if (this.options.visible()) this.options.render();
    try {
      this.installations = await operation();
      await this.host.loadPluginManagement();
      this.restartRequired ||= requiresRestart;
      completed();
    } catch (error) {
      this.marketplaceError = errorMessage(error);
      this.options.reportError(error);
    } finally {
      this.busyPlugin = null;
      if (this.options.visible()) this.options.render();
    }
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
      const escapedFocus = target.focus ? CSS.escape(target.focus) : null;
      const control = escapedFocus
        ? card.querySelector<HTMLElement>(
            `[data-plugin-setting="${escapedFocus}"], [data-plugin-workspace-trust="${escapedFocus}"]`,
          )
        : null;
      card.classList.add("settings-route-target");
      (control ?? card).focus();
      card.scrollIntoView({ block: "nearest" });
      this.pendingFocus = null;
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
