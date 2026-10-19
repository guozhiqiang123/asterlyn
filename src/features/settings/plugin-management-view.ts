import type {
  PluginManagementEntry,
  PluginManagementSnapshot,
  PluginSettingDescriptor,
  PluginSettingValue,
} from "../../application/plugins/plugin-types.ts";
import { renderSelectControl } from "../../shared/select-control.ts";
import type { PluginInstallationSnapshot, PluginPackageAdmissionReview, PluginSourceSnapshot } from "../../protocol/plugin-marketplace.ts";

export interface PluginManagementCopy {
  readonly locale: string;
  readonly title: string;
  readonly description: string;
  readonly builtIn: string;
  readonly enablePlugin: string;
  readonly enabled: string;
  readonly disabled: string;
  readonly matched: string;
  readonly notMatched: string;
  readonly active: string;
  readonly inactive: string;
  readonly version: string;
  readonly diagnostics: string;
  readonly settings: string;
  readonly noSettings: string;
  readonly noPlugins: string;
  readonly loadingPlugins: string;
  readonly invalidSetting: string;
  readonly installedTab: string;
  readonly marketplaceTab: string;
  readonly marketplaceDescription: string;
  readonly addSource: string;
  readonly editSource: string;
  readonly deleteSource: string;
  readonly confirmDeleteSource: string;
  readonly cancel: string;
  readonly save: string;
  readonly repository: string;
  readonly sourceName: string;
  readonly sourceDescription: string;
  readonly sourceRepositoryPlaceholder: string;
  readonly sourceNamePlaceholder: string;
  readonly sourceDescriptionPlaceholder: string;
  readonly officialSource: string;
  readonly customSource: string;
  readonly enableSource: string;
  readonly refreshSource: string;
  readonly refreshingSource: string;
  readonly loadingMarketplace: string;
  readonly noSources: string;
  readonly notChecked: string;
  readonly releaseAvailable: string;
  readonly noRelease: string;
  readonly staleRelease: string;
  readonly packageLabel: string;
  readonly checkedLabel: string;
  readonly marketplaceSecurityNote: string;
  readonly inspectPackage: string;
  readonly inspectingPackage: string;
  readonly confirmAdmission: string;
  readonly admissionTitle: string;
  readonly permissions: string;
  readonly capabilities: string;
  readonly license: string;
  readonly pendingRuntimeNote: string;
  readonly admittedPackage: string;
  readonly pendingRuntime: string;
  readonly pendingRestart: string;
  readonly restartToApply: string;
  readonly restarting: string;
  readonly enableInstalledPlugin: string;
  readonly knownGood: string;
  readonly quarantined: string;
  readonly rollback: string;
  readonly uninstallPlugin: string;
  readonly confirmUninstallPlugin: string;
  readonly uninstallKeepsData: string;
}

export interface PluginMarketplaceViewState {
  readonly tab: "installed" | "marketplace";
  readonly snapshot: PluginSourceSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly busyRepository: string | null;
  readonly form: { readonly repository: string; readonly name: string; readonly description: string; readonly editing: boolean } | null;
  readonly confirmDeleteRepository: string | null;
  readonly admissionReview: PluginPackageAdmissionReview | null;
  readonly installations: PluginInstallationSnapshot | null;
  readonly restarting: boolean;
  readonly restartRequired: boolean;
  readonly busyPlugin: string | null;
  readonly confirmUninstallPlugin: string | null;
}

/** Renders host-owned plugin metadata; plugins contribute keys and values, never HTML. */
export function renderPluginManagementSection(
  snapshot: PluginManagementSnapshot,
  copy: PluginManagementCopy,
  loading = false,
  marketplace: PluginMarketplaceViewState = {
    tab: "installed", snapshot: null, loading: false, error: null,
    busyRepository: null, form: null, confirmDeleteRepository: null, admissionReview: null, installations: null,
    restarting: false,
    restartRequired: false, busyPlugin: null, confirmUninstallPlugin: null,
  },
): string {
  const cards = snapshot.entries.map((entry) => renderPluginEntry(entry, copy)).join("");
  const admitted = renderAdmittedPackages(marketplace, copy);
  const restart = renderPluginRestart(marketplace, copy);
  const installedError = marketplace.error
    ? `<div class="plugin-marketplace-error" role="alert">${escapeHtml(marketplace.error)}</div>`
    : "";
  const content = marketplace.tab === "installed"
    ? `<div class="plugin-management-list">${installedError}${restart}${admitted}${cards || (!admitted ? `<p class="plugin-management-empty" role="status">${escapeHtml(loading ? copy.loadingPlugins : copy.noPlugins)}</p>` : "")}</div>`
    : renderMarketplace(marketplace, copy);
  return `<section class="settings-group plugin-management" data-plugin-management>
    <header><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.description)}</p></header>
    <div class="plugin-management-tabs" role="tablist" aria-label="${escapeAttribute(copy.title)}"><button type="button" role="tab" data-plugin-management-tab="installed" aria-selected="${marketplace.tab === "installed"}">${escapeHtml(copy.installedTab)}</button><button type="button" role="tab" data-plugin-management-tab="marketplace" aria-selected="${marketplace.tab === "marketplace"}">${escapeHtml(copy.marketplaceTab)}</button></div>
    ${content}
  </section>`;
}

function renderAdmittedPackages(state: PluginMarketplaceViewState, copy: PluginManagementCopy): string {
  return state.installations?.plugins.map((plugin) => {
    const pending = plugin.pendingVersion;
    const selected = pending ?? plugin.activeVersion;
    const version = selected ? plugin.versions.find((candidate) => candidate.version === selected) : null;
    const busy = state.busyPlugin === plugin.pluginId;
    const status = version?.runtimeStatus === "pendingRuntime"
      ? copy.pendingRuntime
      : version?.runtimeStatus === "pendingRestart"
        ? copy.pendingRestart
        : versionStatus(version?.runtimeStatus, copy);
    const versions = plugin.versions.map((candidate) => {
      const rollback = candidate.runtimeStatus === "knownGood" && candidate.version !== plugin.activeVersion
        ? `<button class="secondary-button" type="button" data-installed-plugin-rollback="${escapeAttribute(plugin.pluginId)}" data-plugin-version="${escapeAttribute(candidate.version)}" data-package-digest="${escapeAttribute(candidate.packageDigest)}" ${busy ? "disabled" : ""}>${escapeHtml(copy.rollback)}</button>`
        : "";
      return `<li><span><code>${escapeHtml(candidate.version)}</code><small>${escapeHtml(versionStatus(candidate.runtimeStatus, copy))}</small></span>${rollback}</li>`;
    }).join("");
    const uninstallReview = state.confirmUninstallPlugin === plugin.pluginId
      ? `<div class="plugin-installed-uninstall-review" role="alert"><div><strong>${escapeHtml(copy.confirmUninstallPlugin)}</strong><span>${escapeHtml(copy.uninstallKeepsData)}</span></div><button class="secondary-button" type="button" data-installed-plugin-uninstall-cancel>${escapeHtml(copy.cancel)}</button><button class="danger-button" type="button" data-installed-plugin-uninstall-confirm="${escapeAttribute(plugin.pluginId)}" ${busy ? "disabled" : ""}>${escapeHtml(copy.uninstallPlugin)}</button></div>`
      : "";
    return `<article class="plugin-management-card plugin-installed-card" data-installed-plugin-id="${escapeAttribute(plugin.pluginId)}"><div class="plugin-management-card-header"><div><h3>${escapeHtml(plugin.pluginId)}</h3><p><code>${escapeHtml(plugin.repository)}</code></p></div><div class="plugin-management-enabled"><span>${escapeHtml(copy.enableInstalledPlugin)}</span>${renderToggle(`<input data-installed-plugin-enabled="${escapeAttribute(plugin.pluginId)}" type="checkbox" role="switch" ${plugin.enabled ? "checked" : ""} ${busy ? "disabled" : ""} aria-label="${escapeAttribute(copy.enableInstalledPlugin)}" />`)}</div></div><div class="plugin-management-meta"><span>${escapeHtml(copy.admittedPackage)}</span><span>${escapeHtml(copy.version)}: <code>${escapeHtml(selected ?? "—")}</code></span><span>${escapeHtml(status)}</span></div><ul class="plugin-installed-versions">${versions}</ul><div class="plugin-installed-actions"><button class="danger-button" type="button" data-installed-plugin-uninstall="${escapeAttribute(plugin.pluginId)}" ${busy ? "disabled" : ""}>${escapeHtml(copy.uninstallPlugin)}</button></div>${uninstallReview}</article>`;
  }).join("") ?? "";
}

function versionStatus(status: string | undefined, copy: PluginManagementCopy): string {
  switch (status) {
    case "pendingRuntime": return copy.pendingRuntime;
    case "pendingRestart": return copy.pendingRestart;
    case "active": return copy.active;
    case "knownGood": return copy.knownGood;
    case "quarantined": return copy.quarantined;
    default: return copy.inactive;
  }
}

function renderPluginRestart(state: PluginMarketplaceViewState, copy: PluginManagementCopy): string {
  const pending = state.restartRequired || (state.installations?.plugins.some((plugin) => {
    if (!plugin.enabled) return false;
    const version = plugin.versions.find((candidate) => candidate.version === plugin.pendingVersion);
    return version?.runtimeStatus === "pendingRestart" || version?.runtimeStatus === "knownGood";
  }) ?? false);
  if (!pending) return "";
  return `<div class="plugin-restart-banner" role="status"><span>${escapeHtml(copy.pendingRestart)}</span><button class="primary-button" type="button" data-plugin-restart ${state.restarting ? "disabled" : ""}>${escapeHtml(state.restarting ? copy.restarting : copy.restartToApply)}</button></div>`;
}

function renderMarketplace(state: PluginMarketplaceViewState, copy: PluginManagementCopy): string {
  const form = state.form ? renderSourceForm(state.form, copy, state.busyRepository !== null) : "";
  const error = state.error
    ? `<div class="plugin-marketplace-error" role="alert">${escapeHtml(state.error)}</div>`
    : "";
  const sources = state.snapshot?.sources.map((source) => renderSourceCard(source, state, copy)).join("") ?? "";
  const empty = !sources
    ? `<p class="plugin-management-empty" role="status">${escapeHtml(state.loading ? copy.loadingMarketplace : copy.noSources)}</p>`
    : "";
  const review = state.admissionReview ? renderAdmissionReview(state.admissionReview, copy, state.busyRepository !== null) : "";
  return `<div class="plugin-marketplace" data-plugin-marketplace><div class="plugin-marketplace-toolbar"><div><strong>${escapeHtml(copy.marketplaceTab)}</strong><span>${escapeHtml(copy.marketplaceDescription)}</span></div><button class="primary-button" type="button" data-plugin-source-add ${state.busyRepository ? "disabled" : ""}>${escapeHtml(copy.addSource)}</button></div>${error}${review}${form}<div class="plugin-marketplace-list">${sources}${empty}</div><p class="plugin-marketplace-security-note">${escapeHtml(copy.marketplaceSecurityNote)}</p></div>`;
}

function renderAdmissionReview(review: PluginPackageAdmissionReview, copy: PluginManagementCopy, busy: boolean): string {
  const list = (values: readonly string[]) => values.length ? values.map((value) => `<code>${escapeHtml(value)}</code>`).join(" ") : "—";
  return `<section class="plugin-source-form plugin-admission-review" role="dialog" aria-labelledby="plugin-admission-title"><h3 id="plugin-admission-title">${escapeHtml(copy.admissionTitle)}</h3><div class="plugin-management-meta"><span><b>${escapeHtml(review.pluginId)}</b></span><span>v${escapeHtml(review.version)}</span><span>${escapeHtml(formatBytes(review.assetSizeBytes))}</span></div><dl><div><dt>${escapeHtml(copy.license)}</dt><dd>${escapeHtml(review.licenseExpression)}</dd></div><div><dt>${escapeHtml(copy.capabilities)}</dt><dd>${list(review.capabilities)}</dd></div><div><dt>${escapeHtml(copy.permissions)}</dt><dd>${list(review.permissions)}</dd></div></dl><p>${escapeHtml(copy.pendingRuntimeNote)}</p><div class="plugin-source-form-actions"><button class="secondary-button" type="button" data-plugin-admission-cancel ${busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="primary-button" type="button" data-plugin-admission-confirm="${escapeAttribute(review.reviewToken)}" ${busy ? "disabled" : ""}>${escapeHtml(copy.confirmAdmission)}</button></div></section>`;
}

function renderSourceForm(
  form: NonNullable<PluginMarketplaceViewState["form"]>,
  copy: PluginManagementCopy,
  busy: boolean,
): string {
  return `<form class="plugin-source-form" data-plugin-source-form><h3>${escapeHtml(form.editing ? copy.editSource : copy.addSource)}</h3><label><span>${escapeHtml(copy.repository)}</span><input name="repository" value="${escapeAttribute(form.repository)}" placeholder="${escapeAttribute(copy.sourceRepositoryPlaceholder)}" autocomplete="off" spellcheck="false" ${form.editing || busy ? "disabled" : ""}></label><label><span>${escapeHtml(copy.sourceName)}</span><input name="name" value="${escapeAttribute(form.name)}" placeholder="${escapeAttribute(copy.sourceNamePlaceholder)}" autocomplete="off" ${busy ? "disabled" : ""}></label><label><span>${escapeHtml(copy.sourceDescription)}</span><textarea name="description" placeholder="${escapeAttribute(copy.sourceDescriptionPlaceholder)}" ${busy ? "disabled" : ""}>${escapeHtml(form.description)}</textarea></label><div class="plugin-source-form-actions"><button class="secondary-button" type="button" data-plugin-source-form-cancel ${busy ? "disabled" : ""}>${escapeHtml(copy.cancel)}</button><button class="primary-button" type="submit" ${busy ? "disabled" : ""}>${escapeHtml(copy.save)}</button></div></form>`;
}

function renderSourceCard(
  source: NonNullable<PluginSourceSnapshot["sources"]>[number],
  state: PluginMarketplaceViewState,
  copy: PluginManagementCopy,
): string {
  const busy = state.busyRepository === source.repository;
  const catalog = source.catalog;
  const catalogStatus = !catalog
    ? copy.notChecked
    : catalog.version
      ? `${copy.releaseAvailable}: v${catalog.version}${catalog.stale ? ` · ${copy.staleRelease}` : ""}`
      : catalog.status === "noRelease" ? copy.noRelease : catalog.error ?? copy.notChecked;
  const packageDetail = catalog?.assetName && catalog.assetSizeBytes
    ? `<span><b>${escapeHtml(copy.packageLabel)}</b>${escapeHtml(catalog.assetName)} · ${escapeHtml(formatBytes(catalog.assetSizeBytes))}</span>`
    : "";
  const checked = catalog
    ? `<span><b>${escapeHtml(copy.checkedLabel)}</b>${escapeHtml(new Date(catalog.checkedAtEpochMs).toLocaleString(copy.locale))}</span>`
    : "";
  const catalogError = catalog?.error
    ? `<p class="plugin-source-error" role="status">${escapeHtml(catalog.error)}</p>`
    : "";
  const deleteReview = state.confirmDeleteRepository === source.repository
    ? `<div class="plugin-source-delete-review" role="alert"><span>${escapeHtml(copy.confirmDeleteSource)}</span><button class="secondary-button" type="button" data-plugin-source-delete-cancel>${escapeHtml(copy.cancel)}</button><button class="danger-button" type="button" data-plugin-source-delete-confirm="${escapeAttribute(source.repository)}">${escapeHtml(copy.deleteSource)}</button></div>`
    : "";
  const customActions = source.builtIn ? "" : `<button class="secondary-button" type="button" data-plugin-source-edit="${escapeAttribute(source.repository)}" ${busy ? "disabled" : ""}>${escapeHtml(copy.editSource)}</button><button class="secondary-button" type="button" data-plugin-source-delete="${escapeAttribute(source.repository)}" ${busy ? "disabled" : ""}>${escapeHtml(copy.deleteSource)}</button>`;
  const canInspect = catalog?.status === "available" && !catalog.stale;
  const install = canInspect ? `<button class="primary-button" type="button" data-plugin-source-install="${escapeAttribute(source.repository)}" ${busy ? "disabled" : ""}>${escapeHtml(busy ? copy.inspectingPackage : copy.inspectPackage)}</button>` : "";
  return `<article class="plugin-management-card plugin-source-card" data-plugin-source="${escapeAttribute(source.repository)}"><div class="plugin-management-card-header"><div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(source.description)}</p></div><div class="plugin-management-enabled"><span>${escapeHtml(copy.enableSource)}</span>${renderToggle(`<input data-plugin-source-enabled="${escapeAttribute(source.repository)}" type="checkbox" role="switch" ${source.enabled ? "checked" : ""} ${busy ? "disabled" : ""} aria-label="${escapeAttribute(copy.enableSource)}" />`)}</div></div><div class="plugin-management-meta"><span class="plugin-management-builtin">${escapeHtml(source.builtIn ? copy.officialSource : copy.customSource)}</span><span><code>${escapeHtml(source.repository)}</code></span><span>${escapeHtml(catalogStatus)}</span></div>${catalogError}<div class="plugin-source-release">${packageDetail}${checked}</div><div class="plugin-source-actions"><button class="primary-button" type="button" data-plugin-source-refresh="${escapeAttribute(source.repository)}" ${busy || !source.enabled ? "disabled" : ""}>${escapeHtml(busy ? copy.refreshingSource : copy.refreshSource)}</button>${install}${customActions}</div>${deleteReview}</article>`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderPluginEntry(entry: PluginManagementEntry, copy: PluginManagementCopy): string {
  const name = pluginMessage(entry, copy, entry.nameKey);
  const description = pluginMessage(entry, copy, entry.descriptionKey);
  const state = [
    `<span class="plugin-management-status plugin-management-status-enabled" data-plugin-status="${entry.enabled ? "enabled" : "disabled"}" aria-label="${escapeAttribute(entry.enabled ? copy.enabled : copy.disabled)}">${escapeHtml(entry.enabled ? copy.enabled : copy.disabled)}</span>`,
    `<span class="plugin-management-status plugin-management-status-match" data-plugin-status="${entry.matched ? "matched" : "not-matched"}" aria-label="${escapeAttribute(entry.matched ? copy.matched : copy.notMatched)}">${escapeHtml(entry.matched ? copy.matched : copy.notMatched)}</span>`,
    `<span class="plugin-management-status plugin-management-status-active" data-plugin-status="${entry.active ? "active" : "inactive"}" aria-label="${escapeAttribute(entry.active ? copy.active : copy.inactive)}">${escapeHtml(entry.active ? copy.active : copy.inactive)}</span>`,
  ].join("");
  const diagnostics = entry.diagnostics.length > 0
    ? `<div class="plugin-management-diagnostics" role="alert"><strong>${escapeHtml(copy.diagnostics)}</strong><ul>${entry.diagnostics.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => `<li>${escapeHtml(boundedDiagnostic(diagnostic.message))}</li>`).join("")}</ul></div>`
    : "";
  const settings = entry.settingDescriptors.map((descriptor) => renderSetting(entry, descriptor, copy)).join("");
  const authorization = renderWorkspaceTrust(entry, copy);
  return `<article class="plugin-management-card" data-plugin-id="${escapeAttribute(entry.id)}" tabindex="-1">
    <div class="plugin-management-card-header"><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(description)}</p></div><label class="plugin-management-enabled"><input id="plugin-enabled-${escapeAttribute(entry.id)}" data-plugin-id="${escapeAttribute(entry.id)}" data-plugin-setting="enabled" type="checkbox" ${entry.enabled ? "checked" : ""} aria-label="${escapeAttribute(copy.enablePlugin)}" /><span>${escapeHtml(copy.enablePlugin)}</span></label></div>
    <div class="plugin-management-meta"><span class="plugin-management-builtin">${escapeHtml(copy.builtIn)}</span><span>${escapeHtml(copy.version)}: <code>${escapeHtml(entry.version)}</code></span>${state}</div>
    ${diagnostics}
    <div class="plugin-management-settings" data-plugin-settings="${escapeAttribute(entry.id)}"><h4>${escapeHtml(copy.settings)}</h4>${settings}${authorization}${!settings && !authorization ? `<p class="plugin-management-no-settings">${escapeHtml(copy.noSettings)}</p>` : ""}</div>
  </article>`;
}

function renderWorkspaceTrust(entry: PluginManagementEntry, copy: PluginManagementCopy): string {
  const descriptor = entry.taskAuthorization?.workspaceTrust;
  if (!descriptor) return "";
  const label = pluginMessage(entry, copy, descriptor.labelKey);
  const description = descriptor.descriptionKey ? pluginMessage(entry, copy, descriptor.descriptionKey) : "";
  const state = entry.workspaceTrust ?? "unavailable";
  const disabled = state === "unavailable" || state === "loading" || state === "error";
  const id = `plugin-authorization-${entry.id}-${descriptor.id}`;
  const control = renderToggle(`<input id="${escapeAttribute(id)}" data-plugin-id="${escapeAttribute(entry.id)}" data-plugin-workspace-trust="${escapeAttribute(descriptor.id)}" type="checkbox" role="switch" ${state === "trusted" ? "checked" : ""} ${disabled ? "disabled" : ""} ${state === "loading" ? 'aria-busy="true"' : ""} aria-label="${escapeAttribute(label)}" />`);
  return `<div class="plugin-setting-row" data-plugin-authorization-row="${escapeAttribute(descriptor.id)}"><div><strong>${escapeHtml(label)}</strong>${description ? `<span>${escapeHtml(description)}</span>` : ""}</div><div class="plugin-setting-control">${control}</div></div>`;
}

const MAX_DIAGNOSTICS = 4;
const MAX_DIAGNOSTIC_LENGTH = 512;

function boundedDiagnostic(message: string): string {
  return message.length > MAX_DIAGNOSTIC_LENGTH
    ? `${message.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`
    : message;
}

function renderSetting(
  entry: PluginManagementEntry,
  descriptor: PluginSettingDescriptor,
  copy: PluginManagementCopy,
): string {
  const value = entry.settings[descriptor.id] ?? descriptor.defaultValue;
  const id = `plugin-setting-${entry.id}-${descriptor.id}`;
  const label = pluginMessage(entry, copy, descriptor.labelKey);
  const description = descriptor.descriptionKey
    ? pluginMessage(entry, copy, descriptor.descriptionKey)
    : "";
  const detail = description ? `<span>${escapeHtml(description)}</span>` : "";
  const control = descriptor.kind === "boolean"
    ? renderToggle(`<input id="${escapeAttribute(id)}" data-plugin-id="${escapeAttribute(entry.id)}" data-plugin-setting="${escapeAttribute(descriptor.id)}" type="checkbox" role="switch" ${value === true ? "checked" : ""} aria-label="${escapeAttribute(label)}" />`)
    : renderEnum(id, entry, descriptor, value, label, copy);
  return `<div class="plugin-setting-row" data-plugin-setting-row="${escapeAttribute(descriptor.id)}"><div><strong>${escapeHtml(label)}</strong>${detail}</div><div class="plugin-setting-control">${control}</div></div>`;
}

function renderEnum(
  id: string,
  entry: PluginManagementEntry,
  descriptor: PluginSettingDescriptor,
  value: PluginSettingValue,
  label: string,
  copy: PluginManagementCopy,
): string {
  const options = descriptor.options ?? [];
  if (options.length === 0) return `<span class="plugin-management-invalid-setting" role="alert">${escapeHtml(copy.invalidSetting)}</span>`;
  return renderSelectControl(`<select id="${escapeAttribute(id)}" data-plugin-id="${escapeAttribute(entry.id)}" data-plugin-setting="${escapeAttribute(descriptor.id)}" aria-label="${escapeAttribute(label)}">${options.map((option) => `<option value="${escapeAttribute(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(pluginMessage(entry, copy, option.labelKey))}</option>`).join("")}</select>`);
}

function renderToggle(input: string): string {
  return `<label class="plugin-setting-toggle">${input}<span class="plugin-setting-switch-track" aria-hidden="true"></span></label>`;
}

function pluginMessage(entry: PluginManagementEntry, copy: PluginManagementCopy, key: string): string {
  const messages = entry.localization.locales;
  return messages[copy.locale]?.[key] ?? messages[entry.localization.defaultLocale]?.[key] ?? key;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
