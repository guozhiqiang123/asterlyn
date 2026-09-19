import assert from "node:assert/strict";
import test from "node:test";

import { SettingsPresentationRuntime } from "../src/composition/settings-presentation-runtime.ts";

test("Settings and presentation composition owns subscriptions and disposal", () => {
  const values = new Map();
  let settingsChanged = 0;
  let presentationChanged = 0;
  let syncDisposed = 0;
  let systemReleased = 0;
  const runtime = new SettingsPresentationRuntime({
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    preferenceSync: {
      sourceId: "test",
      publish: () => {},
      subscribe: () => () => {},
      dispose: () => {
        syncDisposed += 1;
      },
    },
    systemPresentation: {
      locales: () => ["en-US"],
      prefersDark: () => true,
      subscribe: () => () => {
        systemReleased += 1;
      },
    },
    document: {
      documentElement: {
        lang: "",
        dir: "",
        dataset: {},
        style: { colorScheme: "" },
      },
      querySelector: () => null,
    },
    nativeAppearance: { setTheme: async () => {} },
    settingsChanged: () => {
      settingsChanged += 1;
    },
    presentationChanged: () => {
      presentationChanged += 1;
    },
  });

  runtime.settings.selectSection("appearance");
  runtime.presentation.updatePreferences({ locale: "en-US", theme: "light" });
  assert.equal(settingsChanged, 1);
  assert.equal(presentationChanged, 1);

  runtime.dispose();
  runtime.dispose();
  runtime.settings.selectSection("editor");
  assert.equal(runtime.presentation.updatePreferences({ locale: "zh-CN", theme: "dark" }), false);
  assert.equal(settingsChanged, 1);
  assert.equal(presentationChanged, 1);
  assert.equal(syncDisposed, 1);
  assert.equal(systemReleased, 1);
});
