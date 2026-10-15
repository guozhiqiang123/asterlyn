import type { BundledPlugin } from "../application/plugins/index.ts";
import type { PluginDiagnostic } from "../application/plugins/index.ts";
import { ANDROID_GRADLE_PLUGIN } from "@asterlyn/plugin-android-gradle";
import { adaptSdkPluginCatalog } from "../application/plugins/plugin-sdk-adapter.ts";

/** Compile-time reviewed integrations shipped with Asterlyn. */
export const BUNDLED_PLUGIN_CATALOG = adaptSdkPluginCatalog([ANDROID_GRADLE_PLUGIN]);
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = BUNDLED_PLUGIN_CATALOG.plugins;

export function loadBundledPlugins(
  reportDiagnostic: (diagnostic: PluginDiagnostic) => void,
): readonly BundledPlugin[] {
  BUNDLED_PLUGIN_CATALOG.diagnostics.forEach(reportDiagnostic);
  return BUNDLED_PLUGIN_CATALOG.plugins;
}
