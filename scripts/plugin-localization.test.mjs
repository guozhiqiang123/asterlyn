import assert from "node:assert/strict";
import test from "node:test";

import { SDK_PLUGIN_LOCALIZATION_LIMITS } from "../packages/plugin-sdk/index.ts";
import {
  resolvePluginMessage,
  validateAndFreezePluginLocalization,
} from "../src/application/plugins/plugin-localization.ts";

const manifest = (overrides = {}) => ({
  id: "example.plugin",
  nameKey: "name",
  descriptionKey: "description",
  settings: [{
    id: "mode", kind: "enum", labelKey: "settings.mode.label",
    descriptionKey: "settings.mode.description", defaultValue: "all",
    options: [{ value: "all", labelKey: "settings.mode.all" }],
  }],
  localization: {
    defaultLocale: "en-US",
    locales: {
      "en-US": {
        name: "Example", description: "Example description",
        "settings.mode.label": "Mode", "settings.mode.description": "Choose a mode.",
        "settings.mode.all": "All",
      },
      "zh-CN": { name: "示例", description: "示例说明", "settings.mode.label": "模式" },
    },
  },
  ...overrides,
});

test("validates, detaches, freezes, and resolves plugin-scoped catalogs", () => {
  const source = manifest();
  const localization = validateAndFreezePluginLocalization(source);
  source.localization.locales["en-US"].name = "Changed";
  assert.equal(resolvePluginMessage(localization, "zh-CN", "name"), "示例");
  assert.equal(resolvePluginMessage(localization, "zh-CN", "settings.mode.all"), "All");
  assert.equal(resolvePluginMessage(localization, "fr-FR", "description"), "Example description");
  assert.equal(resolvePluginMessage(localization, "fr-FR", "missing.key"), "missing.key");
  assert.equal(Object.isFrozen(localization), true);
  assert.equal(Object.isFrozen(localization.locales), true);
  assert.equal(Object.isFrozen(localization.locales["en-US"]), true);
  assert.equal(localization.locales["en-US"].name, "Example");
});

test("rejects missing defaults, non-canonical locales, invalid keys, controls, and missing references", () => {
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ localization: { defaultLocale: "fr-FR", locales: { "en-US": { name: "x", description: "y" } } } })), /default locale/u);
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ localization: { defaultLocale: "en-us", locales: { "en-us": { name: "x", description: "y" } } } })), /locale en-us/u);
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ localization: { defaultLocale: "en-US", locales: { "en-US": { name: "x", description: "y", "bad key": "z" } } } })), /message en-US.bad key/u);
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ localization: { defaultLocale: "en-US", locales: { "en-US": { name: "x\u0000", description: "y" } } } })), /message en-US.name/u);
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ localization: { defaultLocale: "en-US", locales: { "en-US": { name: "x", description: "y" } } } })), /missing default message settings.mode.label/u);
});

test("enforces locale, message, value, and total catalog bounds", () => {
  const locales = Object.fromEntries(Array.from(
    { length: SDK_PLUGIN_LOCALIZATION_LIMITS.maxLocales + 1 },
    (_, index) => [`x-${String(index).padStart(2, "0")}`, { name: "x", description: "y" }],
  ));
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ localization: { defaultLocale: "x-00", locales } })), /locale count/u);
  const messages = Object.fromEntries(Array.from(
    { length: SDK_PLUGIN_LOCALIZATION_LIMITS.maxMessagesPerLocale + 1 },
    (_, index) => [`message.${index}`, "x"],
  ));
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ settings: [], localization: { defaultLocale: "en-US", locales: { "en-US": { ...messages, name: "x", description: "y" } } } })), /message count/u);
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ settings: [], localization: { defaultLocale: "en-US", locales: { "en-US": { name: "x".repeat(SDK_PLUGIN_LOCALIZATION_LIMITS.maxValueLength + 1), description: "y" } } } })), /message en-US.name/u);
  const largeLocales = Object.fromEntries(["en-US", "fr-FR", "de-DE", "es-ES"].map((locale) => [locale, {
    name: "x".repeat(SDK_PLUGIN_LOCALIZATION_LIMITS.maxValueLength),
    description: "x".repeat(SDK_PLUGIN_LOCALIZATION_LIMITS.maxValueLength),
    ...Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`large.${index}`, "x".repeat(SDK_PLUGIN_LOCALIZATION_LIMITS.maxValueLength)])),
  }]));
  assert.throws(() => validateAndFreezePluginLocalization(manifest({ settings: [], localization: { defaultLocale: "en-US", locales: largeLocales } })), /total character count/u);
});
