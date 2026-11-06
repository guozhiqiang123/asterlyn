import { activeLanguageCatalogRegistrations } from "../application/language-services/catalog-registrations.ts";
import {
  LanguageCatalogIndex,
  type CatalogSelection,
  type CatalogSelectionContext,
} from "../application/language-services/catalog-selection.ts";
import {
  ManagedInstallationFacts,
  type InstallationFacts,
} from "../application/language-services/installation-facts.ts";
import { recommendManagedInstallation } from "../application/language-services/installation-recommendation.ts";
import { resolvePluginMessage } from "../application/plugins/index.ts";
import type { PluginManagementSnapshot } from "../application/plugins/plugin-types.ts";
import type { EditorDocument } from "../editor-document.ts";
import type { ProjectFilesState } from "../features/files-editor/project-files-controller.ts";
import type { ManagedLanguageStatusCopy } from "../localization/language-service-copy.ts";
import type { ManagedLanguageEnvironment } from "../protocol/managed-language-environment.ts";
import {
  managedLanguageStatusPresentation,
  renderManagedLanguageStatus,
  type ManagedLanguageStatusPresentation,
} from "../features/language-services/managed-language-status-view.ts";

export type ManagedLanguageStatusContext = Omit<CatalogSelectionContext, "activePluginIds" | "platform" | "preferredProvider">;

export interface ManagedLanguageStatusProjection {
  readonly selection: CatalogSelection;
  readonly presentation: ManagedLanguageStatusPresentation;
  readonly pluginId: string | null;
}

export interface ManagedLanguageEnvironmentBridge {
  read(): Promise<ManagedLanguageEnvironment>;
}

export interface ManagedLanguageStatusPorts {
  readonly context: () => ManagedLanguageStatusContext;
  readonly locale: () => string;
  readonly copy: () => ManagedLanguageStatusCopy;
  readonly openManagement: (pluginId: string | null) => void;
  readonly reportError: (error: unknown) => void;
}

export interface ManagedLanguageManagementHost {
  readonly pluginManagementSnapshot: PluginManagementSnapshot;
  subscribePluginManagement(listener: (snapshot: PluginManagementSnapshot) => void): () => void;
}

export function managedLanguageStatusContext(
  workspaceRoot: string | null,
  document: EditorDocument,
  files: ProjectFilesState,
): ManagedLanguageStatusContext {
  const catalogCurrent = workspaceRoot !== null && files.root === workspaceRoot;
  return {
    source: workspaceRoot && document.kind === "project-file" && document.repositoryRoot === workspaceRoot
      ? { workspacePath: document.workspacePath, kind: document.readOnly === true ? "read-only-source" : "editable-source" }
      : null,
    hasWorkspace: workspaceRoot !== null,
    rootMarkers: new Set(catalogCurrent ? files.files.map(file => file.workspacePath).filter(path => !path.includes("/")) : []),
    rootMarkersComplete: catalogCurrent && !files.loading && files.error === null && !files.truncated,
  };
}

export function projectManagedLanguageStatus(
  management: PluginManagementSnapshot,
  index: LanguageCatalogIndex,
  context: ManagedLanguageStatusContext,
  environment: ManagedLanguageEnvironment,
  facts: InstallationFacts,
  locale: string,
  copy: ManagedLanguageStatusCopy,
): ManagedLanguageStatusProjection {
  const activePluginIds = new Set(management.entries
    .filter(entry => entry.enabled && entry.active)
    .map(entry => entry.id));
  const selection = index.select({
    ...context,
    activePluginIds,
    platform: environment.platform,
    preferredProvider: null,
  });
  const recommendation = recommendManagedInstallation(selection, facts, environment.target, null);
  const labels = selectionLabels(selection, management, locale);
  return Object.freeze({
    selection,
    presentation: managedLanguageStatusPresentation(selection, recommendation, labels, copy),
    pluginId: labels.pluginId,
  });
}

/** Binds admitted catalog metadata and native installation facts to the shared footer host. */
export class ManagedLanguageStatusRuntime {
  private management: PluginManagementSnapshot = Object.freeze({ schemaVersion: 1, entries: Object.freeze([]) });
  private index = new LanguageCatalogIndex([]);
  private readonly facts = new ManagedInstallationFacts();
  private environment: ManagedLanguageEnvironment | null = null;
  private disposed = false;
  private boundHost: HTMLElement | null = null;
  private activePluginId: string | null = null;
  private releaseManagement = (): void => undefined;
  private readonly root: HTMLElement;
  private readonly bridge: ManagedLanguageEnvironmentBridge;
  private readonly ports: ManagedLanguageStatusPorts;

  constructor(
    root: HTMLElement,
    bridge: ManagedLanguageEnvironmentBridge,
    ports: ManagedLanguageStatusPorts,
  ) {
    this.root = root;
    this.bridge = bridge;
    this.ports = ports;
    void this.reloadEnvironment();
  }

  connectManagement(host: ManagedLanguageManagementHost): this {
    this.releaseManagement();
    this.updateManagement(host.pluginManagementSnapshot);
    this.releaseManagement = host.subscribePluginManagement(snapshot => this.updateManagement(snapshot));
    return this;
  }

  updateManagement(snapshot: PluginManagementSnapshot): void {
    if (this.disposed) return;
    this.management = snapshot;
    this.index = new LanguageCatalogIndex(activeLanguageCatalogRegistrations(snapshot));
    this.refresh();
  }

  refresh(): void {
    if (this.disposed) return;
    const host = this.root.querySelector<HTMLElement>("#managed-language-status-host");
    if (!host) return;
    this.bind(host);
    if (!this.environment) {
      host.innerHTML = "";
      this.activePluginId = null;
      return;
    }
    const projection = projectManagedLanguageStatus(
      this.management,
      this.index,
      this.ports.context(),
      this.environment,
      this.facts.read(),
      this.ports.locale(),
      this.ports.copy(),
    );
    this.activePluginId = projection.pluginId;
    host.innerHTML = renderManagedLanguageStatus(projection.presentation, this.ports.copy());
  }

  dispose(): void {
    this.disposed = true;
    this.releaseManagement();
    this.releaseManagement = (): void => undefined;
    this.facts.reset();
    this.environment = null;
    this.boundHost = null;
  }

  private async reloadEnvironment(): Promise<void> {
    const request = this.facts.begin();
    this.refresh();
    try {
      const environment = await this.bridge.read();
      if (this.disposed) return;
      if (this.facts.accept(request, environment.installation)) this.environment = environment;
      else this.environment = null;
    } catch (error) {
      if (this.disposed) return;
      this.facts.fail(request);
      this.environment = null;
      this.ports.reportError(error);
    }
    this.refresh();
  }

  private bind(host: HTMLElement): void {
    if (this.boundHost === host) return;
    this.boundHost = host;
    host.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("[data-managed-language-action]")
        : null;
      if (!target || !host.contains(target)) return;
      this.ports.openManagement(this.activePluginId);
    });
  }
}

function selectionLabels(
  selection: CatalogSelection,
  management: PluginManagementSnapshot,
  locale: string,
): { readonly language: string; readonly server: string; readonly pluginId: string | null } {
  const languageIds = selection.kind === "language-conflict"
    ? selection.languageIds
    : "languageId" in selection ? [selection.languageId] : [];
  const selectedPluginId = selection.kind === "selected" ? selection.provider.pluginId : null;
  const languageOwners = languageIds.map(languageId => management.entries.find(entry =>
    entry.enabled && entry.active && entry.languageServerCatalog?.languages.some(language => language.id === languageId)));
  const language = languageIds.map((languageId, index) => {
    const entry = languageOwners[index];
    const descriptor = entry?.languageServerCatalog?.languages.find(candidate => candidate.id === languageId);
    return entry && descriptor
      ? resolvePluginMessage(entry.localization, locale, descriptor.labelKey)
      : languageId;
  }).join(" / ") || "Language";
  if (selection.kind !== "selected") {
    return { language, server: language, pluginId: selectedPluginId ?? languageOwners.find(Boolean)?.id ?? null };
  }
  const entry = management.entries.find(candidate => candidate.id === selection.provider.pluginId);
  const server = entry
    ? resolvePluginMessage(entry.localization, locale, selection.provider.server.labelKey)
    : selection.provider.server.id;
  return { language, server, pluginId: selection.provider.pluginId };
}
