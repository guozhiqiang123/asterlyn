import {
  HOST_NOTIFICATION_LIMITS,
  type HostNotificationRequest,
} from "../application/notifications/index.ts";
import type { PluginTaskExecutionResult } from "../application/plugins/index.ts";
import type { TasksCopy } from "../localization/catalog.ts";

/** Maps only authoritative user-task terminal failures into global host feedback. */
export function pluginTaskTerminalNotification(
  copy: TasksCopy,
  pluginId: string,
  taskLabel: string,
  status: PluginTaskExecutionResult["status"],
): HostNotificationRequest | null {
  if (status !== "failed" && status !== "crashed") return null;
  const message = status === "failed" ? copy.taskFailed(taskLabel) : copy.taskCrashed(taskLabel);
  return Object.freeze({
    kind: "error",
    message: boundedText(message, HOST_NOTIFICATION_LIMITS.maxMessageLength),
    source: boundedText(`plugin-task:${pluginId}`, HOST_NOTIFICATION_LIMITS.maxSourceLength),
  });
}

function boundedText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let prefix = value.slice(0, Math.max(0, limit - 1));
  if (/[\uD800-\uDBFF]$/u.test(prefix)) prefix = prefix.slice(0, -1);
  return `${prefix}…`;
}
