import type { PluginLanguageServiceContribution, PluginContributionRegistry } from "../application/plugins/index.ts";
import { createEditorLanguageServicePort } from "../features/language-services/language-service-client.ts";
import type { EditorLanguageServiceHandle } from "../protocol/editor-language-service.ts";
import type { createTauriLanguageServiceBridge } from "../adapters/tauri/tauri-language-service-bridge.ts";

export function createLanguageServicesRuntime(registry: PluginContributionRegistry, native: ReturnType<typeof createTauriLanguageServiceBridge>, reportError: (error: unknown) => void) {
  const contribution = () => registry.list().find((entry): entry is PluginLanguageServiceContribution & typeof entry => entry.kind === "language-service") ?? null;
  return createEditorLanguageServicePort((handle: EditorLanguageServiceHandle) => {
    const provider = contribution();
    if (!provider) return null;
    const languageId = provider.languageIds.includes("typescript") ? "typescript" : provider.languageIds[0];
    if (!languageId) return null;
    return { workspaceRoot: "", workspaceGeneration: handle.loadEpoch, uri: `file://${encodeURI(handle.path)}`, languageId, pluginId: provider.pluginId };
  }, native, reportError);
}
