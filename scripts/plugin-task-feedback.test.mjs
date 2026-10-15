import assert from "node:assert/strict";
import test from "node:test";

import { HOST_NOTIFICATION_LIMITS } from "../src/application/notifications/index.ts";
import { pluginTaskTerminalNotification } from "../src/composition/plugin-task-feedback.ts";
import { EN_US_TASKS_COPY, ZH_CN_TASKS_COPY } from "../src/localization/tasks-copy.ts";

test("failed and crashed user tasks produce localized host error notifications", () => {
  assert.deepEqual(pluginTaskTerminalNotification(
    EN_US_TASKS_COPY,
    "dev.example.gradle",
    ":app:installDebug",
    "failed",
  ), {
    kind: "error",
    message: "Task failed: :app:installDebug",
    source: "plugin-task:dev.example.gradle",
  });
  assert.equal(pluginTaskTerminalNotification(
    ZH_CN_TASKS_COPY,
    "dev.example.gradle",
    ":app:installDebug",
    "crashed",
  )?.message, "任务异常中止：:app:installDebug");
});

test("success and cancellation stay in task and Terminal state without global noise", () => {
  assert.equal(pluginTaskTerminalNotification(EN_US_TASKS_COPY, "plugin", "task", "succeeded"), null);
  assert.equal(pluginTaskTerminalNotification(EN_US_TASKS_COPY, "plugin", "task", "cancelled"), null);
});

test("task notification text and source remain within host bounds", () => {
  const notification = pluginTaskTerminalNotification(
    EN_US_TASKS_COPY,
    `plugin.${"x".repeat(200)}`,
    `:${"😀".repeat(1_000)}`,
    "failed",
  );
  assert.ok(notification);
  assert.ok(notification.message.length <= HOST_NOTIFICATION_LIMITS.maxMessageLength);
  assert.ok(notification.source.length <= HOST_NOTIFICATION_LIMITS.maxSourceLength);
  assert.equal(notification.message.isWellFormed(), true);
});
