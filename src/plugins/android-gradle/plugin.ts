import type {
  BundledPlugin,
  PluginActivationContext,
  PluginMatchContext,
  PluginWorkspaceCatalogEvidence,
} from "../../application/plugins/index.ts";
import {
  ANDROID_GRADLE_DETECTOR_LIMITS,
  detectAndroidGradleEvidence,
  type AndroidGradleEvidenceSnapshot,
} from "./detector.ts";

export const ANDROID_GRADLE_PLUGIN_ID = "dev.asterlyn.android-gradle";

/**
 * First-party Android/Gradle integration descriptor.
 *
 * Activation starts no process. Until the host owns a narrow Gradle discovery and
 * execution policy, the provider exposes only an explicit unavailable status.
 */
export const ANDROID_GRADLE_PLUGIN: BundledPlugin = Object.freeze({
  id: ANDROID_GRADLE_PLUGIN_ID,
  version: "0.1.0",
  matches: (context: PluginMatchContext) => detectAndroidGradlePluginEvidence(context)?.android === true,
  activate: (context: PluginActivationContext) => {
    const detection = detectAndroidGradlePluginEvidence(context);
    if (!detection?.android) return;
    context.contribute({
      kind: "provider",
      id: "gradle-tasks",
      label: "Gradle",
      snapshot: () => ({
        status: "unavailable",
        tasks: [],
        unavailableReason: detection.catalogTruncated
          ? "evidence-incomplete"
          : "discovery-not-supported",
      }),
    });
  },
});

export function detectAndroidGradlePluginEvidence(
  context: PluginMatchContext,
): AndroidGradleEvidenceSnapshot | null {
  if (!isWorkspaceCatalogEvidence(context.evidence)) return null;
  return detectAndroidGradleEvidence({
    workspaceRoot: context.identity.root,
    generation: context.identity.generation,
    platform: context.evidence.platform,
    files: context.evidence.files,
    catalogTruncated: context.evidence.truncated,
  });
}

function isWorkspaceCatalogEvidence(
  evidence: { readonly [key: string]: unknown },
): evidence is PluginWorkspaceCatalogEvidence {
  if (evidence.kind !== "workspace-catalog" ||
    (evidence.platform !== "posix" && evidence.platform !== "windows") ||
    typeof evidence.truncated !== "boolean" || !Array.isArray(evidence.files)) return false;
  if (evidence.files.length > ANDROID_GRADLE_DETECTOR_LIMITS.maxPaths) return true;
  return evidence.files.every((file) => typeof file === "object" && file !== null &&
    typeof (file as { readonly workspacePath?: unknown }).workspacePath === "string");
}
