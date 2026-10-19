import type {
  PluginCatalogEntry,
  PluginRunRecoveryConfirmation,
} from "../application/plugins/index.ts";
import { resolvePluginMessageOrNull } from "../application/plugins/plugin-localization.ts";
import type { ApplicationConfirmationRequest } from "../shared/application-confirmation-dialog.ts";

/** Resolves plugin-owned recovery copy only when a failed Run reaches this exceptional path. */
export function confirmPluginRunRecovery(
  plugin: Pick<PluginCatalogEntry, "id" | "manifest">,
  locale: string,
  confirmation: PluginRunRecoveryConfirmation,
  confirm: (request: ApplicationConfirmationRequest) => Promise<boolean>,
): Promise<boolean> {
  const resolve = (key: string): string | null => resolvePluginMessageOrNull(
    plugin.manifest.localization,
    locale,
    key,
  );
  const title = resolve(confirmation.titleKey);
  const message = resolve(confirmation.messageKey);
  const confirmLabel = resolve(confirmation.confirmLabelKey);
  const cancelLabel = resolve(confirmation.cancelLabelKey);
  if (!title || !message || !confirmLabel || !cancelLabel) {
    throw new Error(`Plugin Run recovery copy is unavailable: ${plugin.id}`);
  }
  return confirm({ title, message, confirmLabel, cancelLabel, destructive: confirmation.destructive });
}
