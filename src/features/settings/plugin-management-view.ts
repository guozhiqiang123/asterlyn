import type {
  PluginManagementEntry,
  PluginManagementSnapshot,
  PluginSettingDescriptor,
  PluginSettingValue,
} from "../../application/plugins/plugin-types.ts";

export interface PluginManagementCopy {
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
  readonly resolve: (key: string) => string;
}

/** Renders host-owned plugin metadata; plugins contribute keys and values, never HTML. */
export function renderPluginManagementSection(
  snapshot: PluginManagementSnapshot,
  copy: PluginManagementCopy,
  loading = false,
): string {
  const cards = snapshot.entries.map((entry) => renderPluginEntry(entry, copy)).join("");
  return `<section class="settings-group plugin-management" data-plugin-management>
    <header><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.description)}</p></header>
    <div class="plugin-management-list">${cards || `<p class="plugin-management-empty" role="status">${escapeHtml(loading ? copy.loadingPlugins : copy.noPlugins)}</p>`}</div>
  </section>`;
}

function renderPluginEntry(entry: PluginManagementEntry, copy: PluginManagementCopy): string {
  const name = copy.resolve(entry.nameKey);
  const description = copy.resolve(entry.descriptionKey);
  const state = [
    `<span class="plugin-management-status plugin-management-status-enabled" data-plugin-status="${entry.enabled ? "enabled" : "disabled"}" aria-label="${escapeAttribute(entry.enabled ? copy.enabled : copy.disabled)}">${escapeHtml(entry.enabled ? copy.enabled : copy.disabled)}</span>`,
    `<span class="plugin-management-status plugin-management-status-match" data-plugin-status="${entry.matched ? "matched" : "not-matched"}" aria-label="${escapeAttribute(entry.matched ? copy.matched : copy.notMatched)}">${escapeHtml(entry.matched ? copy.matched : copy.notMatched)}</span>`,
    `<span class="plugin-management-status plugin-management-status-active" data-plugin-status="${entry.active ? "active" : "inactive"}" aria-label="${escapeAttribute(entry.active ? copy.active : copy.inactive)}">${escapeHtml(entry.active ? copy.active : copy.inactive)}</span>`,
  ].join("");
  const diagnostics = entry.diagnostics.length > 0
    ? `<div class="plugin-management-diagnostics" role="alert"><strong>${escapeHtml(copy.diagnostics)}</strong><ul>${entry.diagnostics.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => `<li>${escapeHtml(boundedDiagnostic(diagnostic.message))}</li>`).join("")}</ul></div>`
    : "";
  const settings = entry.settingDescriptors.map((descriptor) => renderSetting(entry, descriptor, copy)).join("");
  return `<article class="plugin-management-card" data-plugin-id="${escapeAttribute(entry.id)}" tabindex="-1">
    <div class="plugin-management-card-header"><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(description)}</p></div><label class="plugin-management-enabled"><input id="plugin-enabled-${escapeAttribute(entry.id)}" data-plugin-id="${escapeAttribute(entry.id)}" data-plugin-setting="enabled" type="checkbox" ${entry.enabled ? "checked" : ""} aria-label="${escapeAttribute(copy.enablePlugin)}" /><span>${escapeHtml(copy.enablePlugin)}</span></label></div>
    <div class="plugin-management-meta"><span class="plugin-management-builtin">${escapeHtml(copy.builtIn)}</span><span>${escapeHtml(copy.version)}: <code>${escapeHtml(entry.version)}</code></span>${state}</div>
    ${diagnostics}
    <div class="plugin-management-settings" data-plugin-settings="${escapeAttribute(entry.id)}"><h4>${escapeHtml(copy.settings)}</h4>${settings || `<p class="plugin-management-no-settings">${escapeHtml(copy.noSettings)}</p>`}</div>
  </article>`;
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
  const label = copy.resolve(descriptor.labelKey);
  const description = descriptor.descriptionKey ? copy.resolve(descriptor.descriptionKey) : "";
  const detail = description ? `<span>${escapeHtml(description)}</span>` : "";
  const control = descriptor.kind === "boolean"
    ? `<label class="plugin-setting-toggle"><input id="${escapeAttribute(id)}" data-plugin-id="${escapeAttribute(entry.id)}" data-plugin-setting="${escapeAttribute(descriptor.id)}" type="checkbox" ${value === true ? "checked" : ""} aria-label="${escapeAttribute(label)}" /><span>${escapeHtml(label)}</span></label>`
    : renderEnum(id, entry.id, descriptor, value, label, copy);
  return `<div class="plugin-setting-row" data-plugin-setting-row="${escapeAttribute(descriptor.id)}"><div><strong>${escapeHtml(label)}</strong>${detail}</div><div class="plugin-setting-control">${control}</div></div>`;
}

function renderEnum(
  id: string,
  pluginId: string,
  descriptor: PluginSettingDescriptor,
  value: PluginSettingValue,
  label: string,
  copy: PluginManagementCopy,
): string {
  const options = descriptor.options ?? [];
  if (options.length === 0) return `<span class="plugin-management-invalid-setting" role="alert">${escapeHtml(copy.invalidSetting)}</span>`;
  return `<select id="${escapeAttribute(id)}" data-plugin-id="${escapeAttribute(pluginId)}" data-plugin-setting="${escapeAttribute(descriptor.id)}" aria-label="${escapeAttribute(label)}">${options.map((option) => `<option value="${escapeAttribute(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(copy.resolve(option.labelKey))}</option>`).join("")}</select>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
