import {
  SDK_PLUGIN_NOTIFICATION_LIMITS,
  type SdkPluginNotificationCapability,
  type SdkPluginNotificationKind,
  type SdkPluginNotificationRequest,
} from "../../packages/plugin-sdk/index.ts";
import type { HostNotificationPublisher } from "../application/notifications/index.ts";
import {
  resolvePluginMessageOrNull,
  type BundledPlugin,
} from "../application/plugins/index.ts";

const MESSAGE_KEY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;

/** Creates a plugin-scoped adapter; activation scope supplies revocation. */
export function createPluginNotificationCapability(
  plugin: BundledPlugin,
  locale: () => string,
  publisher: HostNotificationPublisher,
): SdkPluginNotificationCapability {
  return Object.freeze({
    publish: (request: SdkPluginNotificationRequest) => {
      const value = validateRequest(request);
      const message = resolvePluginMessageOrNull(
        plugin.manifest.localization,
        locale(),
        value.messageKey,
      );
      if (message === null) throw new Error(`Unknown plugin notification message key: ${plugin.id}`);
      if (message.length > SDK_PLUGIN_NOTIFICATION_LIMITS.maxResolvedMessageLength) {
        throw new Error(`Plugin notification message exceeds the host limit: ${plugin.id}`);
      }
      publisher.publish({
        kind: value.kind,
        message,
        source: `plugin:${plugin.id}`,
      });
    },
  });
}

function validateRequest(request: SdkPluginNotificationRequest): {
  readonly kind: SdkPluginNotificationKind;
  readonly messageKey: string;
} {
  if (!request || typeof request !== "object") throw new Error("Invalid plugin notification request");
  const { kind, messageKey } = request as Partial<SdkPluginNotificationRequest>;
  if (kind !== "info" && kind !== "success" && kind !== "warning" && kind !== "error") {
    throw new Error("Invalid plugin notification kind");
  }
  if (typeof messageKey !== "string" || messageKey.length === 0 ||
    messageKey.length > SDK_PLUGIN_NOTIFICATION_LIMITS.maxMessageKeyLength ||
    !MESSAGE_KEY.test(messageKey)) {
    throw new Error("Invalid plugin notification message key");
  }
  return Object.freeze({ kind, messageKey });
}
