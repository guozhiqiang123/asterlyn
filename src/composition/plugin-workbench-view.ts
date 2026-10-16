import type { PluginManagementEntry } from "../application/plugins/index.ts";
import { resolvePluginMessage } from "../application/plugins/plugin-localization.ts";
import { renderHostPanelState } from "../presentation/host-presentation.ts";
import type { PluginWorkbenchSnapshot } from "./plugin-workbench-contribution-runtime.ts";

export function renderPluginWorkbenchView(
  viewId: string,
  pluginId: string,
  workbench: PluginWorkbenchSnapshot,
  entry: PluginManagementEntry,
  locale: string,
): string {
  if (viewId === "devices") return renderDeviceView(
    workbench.targetProviders.filter((provider) => provider.pluginId === pluginId),
    entry,
    locale,
  );
  if (viewId === "run") return renderRunView(
    workbench.runConfigurationProviders.filter((provider) => provider.pluginId === pluginId),
    entry,
    locale,
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
  entry: PluginManagementEntry,
  locale: string,
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
  return renderHostPanelState({
    kind: configuration.status === "invalid" ? "error" : "empty",
    title: labelKey ? message(entry, locale, labelKey) : configuration.label,
    detail: detailKey ? message(entry, locale, detailKey) : configuration.detail,
  });
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
