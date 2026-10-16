import type { PluginManagementEntry } from "../application/plugins/index.ts";
import { resolvePluginMessage } from "../application/plugins/plugin-localization.ts";
import { renderHostPanelState } from "../presentation/host-presentation.ts";
import type { PluginWorkbenchSnapshot } from "./plugin-workbench-contribution-runtime.ts";
import type { PluginRunSessionSnapshot } from "./plugin-run-session-runtime.ts";
import { renderSelectControl } from "../shared/select-control.ts";
import { icon } from "../icons.ts";

export function renderPluginWorkbenchView(
  viewId: string,
  pluginId: string,
  workbench: PluginWorkbenchSnapshot,
  entry: PluginManagementEntry,
  locale: string,
  runSession: PluginRunSessionSnapshot | null = null,
): string {
  if (viewId === "devices") return renderDeviceView(
    workbench.targetProviders.filter((provider) => provider.pluginId === pluginId),
    entry,
    locale,
  );
  if (viewId === "run") return renderRunView(
    workbench.runConfigurationProviders.filter((provider) => provider.pluginId === pluginId),
    workbench.targetProviders.filter((provider) => provider.pluginId === pluginId),
    entry,
    locale,
    runSession,
  );
  return "";
}

function renderDeviceView(
  providers: PluginWorkbenchSnapshot["targetProviders"],
  entry: PluginManagementEntry,
  locale: string,
): string {
  const provider = providers[0];
  if (!provider) return renderHostPanelState({ kind: "empty", title: message(entry, locale, "device.empty") });
  const snapshot = provider.snapshot;
  if (snapshot.status === "loading") {
    return renderHostPanelState({ kind: "loading", title: message(entry, locale, "device.loading") });
  }
  if (snapshot.status === "error" || snapshot.status === "unavailable") {
    return renderHostPanelState({
      kind: snapshot.status === "error" ? "error" : "empty",
      title: snapshot.status === "error"
        ? message(entry, locale, "device.error.discovery")
        : message(entry, locale, "device.error.adbUnavailable"),
      detail: snapshot.error,
      actions: [{ id: "refresh-devices", label: message(entry, locale, "device.action.retry"), intent: "recommended", attributes: { "data-target-provider-refresh": provider.qualifiedId } }],
    });
  }
  const rows = snapshot.targets.map((target) => {
    const selected = target.id === snapshot.selectedTargetId;
    return `<button type="button" class="plugin-device-row${selected ? " selected" : ""}" data-execution-target="${attribute(target.id)}" ${target.selectable ? "" : "disabled"} aria-pressed="${selected}"><span class="plugin-device-copy"><strong>${html(target.label)}</strong><small>${html(target.detail ?? target.id)}</small></span><span class="plugin-device-status status-${attribute(target.status)}">${html(message(entry, locale, `device.status.${target.status}`))}</span></button>`;
  }).join("");
  const body = rows || `<div class="plugin-workbench-empty"><strong>${html(message(entry, locale, "device.empty"))}</strong><span>${html(message(entry, locale, "device.emptyDetail"))}</span></div>`;
  const count = message(entry, locale, "device.count").replace("{count}", String(snapshot.targets.length));
  return `<section class="plugin-device-view" data-execution-target-provider="${attribute(provider.qualifiedId)}"><header><div><strong>${html(message(entry, locale, "device.title"))}</strong><small>${html(count)}</small></div></header><div class="plugin-device-list">${body}</div></section>`;
}

function renderRunView(
  providers: PluginWorkbenchSnapshot["runConfigurationProviders"],
  targetProviders: PluginWorkbenchSnapshot["targetProviders"],
  entry: PluginManagementEntry,
  locale: string,
  runSession: PluginRunSessionSnapshot | null,
): string {
  const provider = providers[0];
  if (!provider) return renderHostPanelState({ kind: "empty", title: message(entry, locale, "run.empty") });
  const snapshot = provider.snapshot;
  if (snapshot.status === "loading") return renderHostPanelState({ kind: "loading", title: message(entry, locale, "run.loading") });
  if (snapshot.status === "error") return renderHostPanelState({ kind: "error", title: message(entry, locale, "run.error"), detail: snapshot.error });
  const configuration = snapshot.configurations.find((candidate) => candidate.id === snapshot.selectedConfigurationId)
    ?? snapshot.configurations[0];
  if (!configuration) return renderHostPanelState({ kind: "empty", title: message(entry, locale, "run.empty") });
  const labelKey = configuration.metadata?.labelKey;
  const detailKey = configuration.metadata?.detailKey;
  if (configuration.status !== "ready") return renderHostPanelState({
    kind: configuration.status === "invalid" ? "error" : "empty",
    title: labelKey ? message(entry, locale, labelKey) : configuration.label,
    detail: detailKey ? message(entry, locale, detailKey) : configuration.detail,
  });
  const targets = configuration.targetProviderId
    ? targetProviders.find((candidate) => candidate.providerId === configuration.targetProviderId) ?? null
    : null;
  const configurationSelect = renderSelectControl(`<select data-run-configuration-provider="${attribute(provider.qualifiedId)}" aria-label="${attribute(message(entry, locale, "run.configuration.select"))}">${snapshot.configurations.map((candidate) => `<option value="${attribute(candidate.id)}" ${candidate.id === configuration.id ? "selected" : ""} ${candidate.status === "invalid" ? "disabled" : ""}>${html(candidate.label)}</option>`).join("")}</select>`);
  const selectedTarget = targets?.snapshot.targets.find((target) => target.id === targets.snapshot.selectedTargetId);
  const targetLoading = targets?.snapshot.status === "loading";
  const targetSelect = targets ? renderSelectControl(`<select data-run-target-provider="${attribute(targets.qualifiedId)}" aria-label="${attribute(message(entry, locale, "run.target.select"))}" ${targetLoading ? "disabled" : ""}>${targets.snapshot.selectedTargetId ? "" : `<option value="" selected disabled>${html(message(entry, locale, "run.target.select"))}</option>`}${targets.snapshot.targets.map((target) => `<option value="${attribute(target.id)}" ${target.id === targets.snapshot.selectedTargetId ? "selected" : ""} ${target.status !== "online" || !target.selectable ? "disabled" : ""}>${html(target.label)}${target.detail ? ` — ${html(target.detail)}` : ""}</option>`).join("")}</select>`) : "";
  const refreshLabel = message(entry, locale, "device.action.refresh");
  const targetRefresh = targets ? `<button class="compact-icon-button plugin-run-target-refresh" type="button" data-target-provider-refresh="${attribute(targets.qualifiedId)}" aria-label="${attribute(refreshLabel)}" title="${attribute(refreshLabel)}" ${targetLoading ? "disabled" : ""}>${targetLoading ? `<span class="spinner" aria-hidden="true"></span>` : icon("refresh", 15)}</button>` : "";
  const targetControl = `<div class="plugin-run-target-control">${targetSelect}${targetRefresh}</div>`;
  const anyRunActive = runSession?.status === "running";
  const running = anyRunActive && runSession.pluginId === entry.id;
  const canRun = configuration.status === "ready"
    && targets?.snapshot.status === "ready"
    && selectedTarget?.status === "online"
    && selectedTarget.selectable
    && !anyRunActive;
  const actionLabel = message(entry, locale, running ? "run.action.stop" : "run.action.start");
  const action = `<div class="plugin-run-actions"><button class="primary-button plugin-run-button" type="button" data-plugin-run-action ${running || canRun ? "" : "disabled"}>${html(actionLabel)}</button></div>`;
  const status = runSession?.pluginId === entry.id
    ? `<div class="plugin-run-status status-${attribute(runSession.status)}"><strong>${html(message(entry, locale, `run.session.${runSession.status}`))}</strong>${runSession.status === "running" ? `<span>${html(message(entry, locale, `run.phase.${runSession.phase}`))}</span>` : ""}${runSession.error ? `<small>${html(runSession.error)}</small>` : ""}</div>`
    : "";
  return `<section class="plugin-run-view"><div class="plugin-run-form"><label><span>${html(message(entry, locale, "run.configuration.select"))}</span>${configurationSelect}</label><label><span>${html(message(entry, locale, "run.target.select"))}</span>${targetControl}</label></div><div class="plugin-run-summary"><strong>${html(labelKey ? message(entry, locale, labelKey) : configuration.label)}</strong>${configuration.detail ? `<span>${html(detailKey ? message(entry, locale, detailKey) : configuration.detail)}</span>` : ""}</div>${action}${status}</section>`;
}

function message(entry: PluginManagementEntry, locale: string, key: string): string {
  return resolvePluginMessage(entry.localization, locale, key);
}

function html(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function attribute(value: string): string { return html(value).replace(/`/gu, "&#96;"); }
