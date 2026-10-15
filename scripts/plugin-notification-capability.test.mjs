import assert from "node:assert/strict";
import test from "node:test";

import { createPluginNotificationCapability } from "../src/composition/plugin-notification-capability.ts";

const plugin = {
  id: "example.plugin",
  version: "1.0.0",
  manifest: {
    id: "example.plugin",
    version: "1.0.0",
    nameKey: "name",
    descriptionKey: "description",
    localization: {
      defaultLocale: "en-US",
      locales: {
        "en-US": { name: "Example", description: "Description", "notice.ready": "Ready" },
        "zh-CN": { name: "示例", description: "说明", "notice.ready": "已就绪" },
      },
    },
    settings: [],
  },
  matches: () => true,
  activate: () => undefined,
};

test("plugin notification capability resolves admitted copy and binds source identity", () => {
  const published = [];
  const capability = createPluginNotificationCapability(plugin, () => "zh-CN", {
    publish: (request) => { published.push(request); return "notification-1"; },
  });
  capability.publish({ kind: "success", messageKey: "notice.ready" });
  assert.deepEqual(published, [{
    kind: "success",
    message: "已就绪",
    source: "plugin:example.plugin",
  }]);
});

test("plugin notification capability falls back to the default locale", () => {
  const published = [];
  const capability = createPluginNotificationCapability(plugin, () => "fr-FR", {
    publish: (request) => { published.push(request); return null; },
  });
  capability.publish({ kind: "info", messageKey: "notice.ready" });
  assert.equal(published[0].message, "Ready");
});

test("plugin notification capability fails closed for invalid, unknown, and oversized values", () => {
  const capability = createPluginNotificationCapability(plugin, () => "en-US", { publish: () => null });
  assert.throws(() => capability.publish({ kind: "other", messageKey: "notice.ready" }), /kind/u);
  assert.throws(() => capability.publish({ kind: "info", messageKey: "bad key" }), /message key/u);
  assert.throws(() => capability.publish({ kind: "info", messageKey: "missing" }), /Unknown/u);

  const oversized = {
    ...plugin,
    manifest: {
      ...plugin.manifest,
      localization: {
        defaultLocale: "en-US",
        locales: { "en-US": { oversized: "x".repeat(513) } },
      },
    },
  };
  const oversizedCapability = createPluginNotificationCapability(oversized, () => "en-US", { publish: () => null });
  assert.throws(() => oversizedCapability.publish({ kind: "warning", messageKey: "oversized" }), /host limit/u);
});
