import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveEffectiveLocale,
  resolveEffectiveTheme,
  resolvePresentationSnapshot,
} from "../src/presentation/presentation-environment.ts";
import { DEFAULT_APP_PREFERENCES } from "../src/workbench/preferences.ts";
import { PreferenceStore } from "../src/workbench/preference-store.ts";

test("system locale maps only supported Simplified Chinese locales", () => {
  assert.equal(resolveEffectiveLocale("system", ["zh-CN"]), "zh-CN");
  assert.equal(resolveEffectiveLocale("system", ["zh-Hans-US"]), "zh-CN");
  assert.equal(resolveEffectiveLocale("system", ["zh-Hant", "zh-TW"]), "en-US");
  assert.equal(resolveEffectiveLocale("system", ["fr-FR", "en-US"]), "en-US");
  assert.equal(resolveEffectiveLocale("zh-CN", ["en-US"]), "zh-CN");
});

test("system theme resolves without changing the requested preference", () => {
  assert.equal(resolveEffectiveTheme("system", true), "dark");
  assert.equal(resolveEffectiveTheme("system", false), "light");
  assert.equal(resolveEffectiveTheme("dark", false), "dark");
  assert.deepEqual(
    resolvePresentationSnapshot(DEFAULT_APP_PREFERENCES, {
      locales: () => ["zh-SG"],
      prefersDark: () => true,
    }),
    {
      requestedLocale: "system",
      locale: "zh-CN",
      requestedTheme: "system",
      theme: "dark",
    },
  );
});

test("preference store applies external storage once without echoing it", () => {
  const storage = memoryStorage();
  const sync = memorySync("window-a");
  const store = new PreferenceStore(storage, sync.port);
  const changes = [];
  store.subscribe((change) => changes.push(change));

  assert.equal(store.update({ theme: "dark" }), true);
  assert.equal(sync.published.length, 1);
  storage.setItem(
    "asterlyn.preferences.v1",
    JSON.stringify({
      version: 6,
      preferences: { ...store.preferences, locale: "zh-CN" },
    }),
  );
  sync.signal({ sourceId: "window-b", schemaVersion: 6 });

  assert.equal(store.preferences.locale, "zh-CN");
  assert.deepEqual(changes.map((change) => change.source), ["local", "external"]);
  assert.equal(sync.published.length, 1);
  sync.signal({ sourceId: "window-b", schemaVersion: 6 });
  assert.equal(changes.length, 2);
  store.dispose();
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function memorySync(sourceId) {
  const listeners = new Set();
  const published = [];
  return {
    published,
    port: {
      sourceId,
      publish(signal) { published.push(signal); },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose() { listeners.clear(); },
    },
    signal(signal) {
      for (const listener of listeners) listener(signal);
    },
  };
}
