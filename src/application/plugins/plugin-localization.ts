import {
  SDK_PLUGIN_LOCALIZATION_LIMITS,
  type SdkPluginLocalization,
  type SdkPluginManifest,
} from "../../../packages/plugin-sdk/index.ts";

const MESSAGE_KEY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

/** Validates untrusted plugin copy and returns a detached immutable catalog. */
export function validateAndFreezePluginLocalization(
  manifest: Pick<SdkPluginManifest, "id" | "nameKey" | "descriptionKey" | "localization" | "settings" | "workspaceTool" | "taskAuthorization">,
): SdkPluginLocalization {
  const source = manifest.localization;
  if (!isPlainRecord(source) || typeof source.defaultLocale !== "string" || !isPlainRecord(source.locales)) {
    throw invalidLocalization(manifest.id, "catalog shape");
  }
  const localeEntries = Object.entries(source.locales);
  if (localeEntries.length === 0 || localeEntries.length > SDK_PLUGIN_LOCALIZATION_LIMITS.maxLocales) {
    throw invalidLocalization(manifest.id, "locale count");
  }
  validateLocale(manifest.id, source.defaultLocale);
  if (!Object.hasOwn(source.locales, source.defaultLocale)) {
    throw invalidLocalization(manifest.id, "default locale");
  }

  let totalCharacters = 0;
  const locales: Record<string, Readonly<Record<string, string>>> = {};
  for (const [locale, messages] of localeEntries) {
    validateLocale(manifest.id, locale);
    if (!isPlainRecord(messages)) throw invalidLocalization(manifest.id, `messages for ${locale}`);
    const messageEntries = Object.entries(messages);
    if (messageEntries.length > SDK_PLUGIN_LOCALIZATION_LIMITS.maxMessagesPerLocale) {
      throw invalidLocalization(manifest.id, `message count for ${locale}`);
    }
    totalCharacters += locale.length;
    const copiedMessages: Record<string, string> = {};
    for (const [key, value] of messageEntries) {
      if (!validMessageKey(key) || typeof value !== "string" || value.length === 0 ||
        value.length > SDK_PLUGIN_LOCALIZATION_LIMITS.maxValueLength || DISALLOWED_CONTROL.test(value)) {
        throw invalidLocalization(manifest.id, `message ${locale}.${key}`);
      }
      totalCharacters += key.length + value.length;
      if (totalCharacters > SDK_PLUGIN_LOCALIZATION_LIMITS.maxTotalCharacters) {
        throw invalidLocalization(manifest.id, "total character count");
      }
      copiedMessages[key] = value;
    }
    locales[locale] = Object.freeze(copiedMessages);
  }

  const defaultMessages = locales[source.defaultLocale];
  if (!defaultMessages) throw invalidLocalization(manifest.id, "default locale");
  for (const key of referencedMessageKeys(manifest)) {
    if (!validMessageKey(key) || !Object.hasOwn(defaultMessages, key)) {
      throw invalidLocalization(manifest.id, `missing default message ${key}`);
    }
  }
  return Object.freeze({
    defaultLocale: source.defaultLocale,
    locales: Object.freeze(locales),
  });
}

/** Exact application locale, then plugin default locale, then a visible unresolved key. */
export function resolvePluginMessage(
  localization: SdkPluginLocalization,
  locale: string,
  key: string,
): string {
  return resolvePluginMessageOrNull(localization, locale, key) ?? key;
}

/** Resolves admitted plugin copy without exposing an unresolved key to presentation. */
export function resolvePluginMessageOrNull(
  localization: SdkPluginLocalization,
  locale: string,
  key: string,
): string | null {
  return localization.locales[locale]?.[key]
    ?? localization.locales[localization.defaultLocale]?.[key]
    ?? null;
}

function referencedMessageKeys(
  manifest: Pick<SdkPluginManifest, "nameKey" | "descriptionKey" | "settings" | "workspaceTool" | "taskAuthorization">,
): readonly string[] {
  const keys = [manifest.nameKey, manifest.descriptionKey];
  if (manifest.workspaceTool !== undefined) {
    keys.push(manifest.workspaceTool.titleKey);
    for (const view of manifest.workspaceTool.views) keys.push(view.labelKey);
  }
  for (const setting of manifest.settings) {
    keys.push(setting.labelKey);
    if (setting.descriptionKey !== undefined) keys.push(setting.descriptionKey);
    for (const option of setting.options ?? []) keys.push(option.labelKey);
  }
  const authorization = manifest.taskAuthorization;
  if (authorization !== undefined) {
    keys.push(authorization.workspaceTrust.labelKey);
    if (authorization.workspaceTrust.descriptionKey !== undefined) {
      keys.push(authorization.workspaceTrust.descriptionKey);
    }
    if (authorization.taskConfirmation !== undefined) {
      keys.push(authorization.taskConfirmation.rememberLabelKey);
      if (authorization.taskConfirmation.rememberDescriptionKey !== undefined) {
        keys.push(authorization.taskConfirmation.rememberDescriptionKey);
      }
    }
  }
  return keys;
}

function validateLocale(pluginId: string, locale: string): void {
  if (locale.length === 0 || locale.length > SDK_PLUGIN_LOCALIZATION_LIMITS.maxLocaleLength) {
    throw invalidLocalization(pluginId, `locale ${locale}`);
  }
  try {
    const canonical = Intl.getCanonicalLocales(locale);
    if (canonical.length !== 1 || canonical[0] !== locale) throw new Error("non-canonical");
  } catch {
    throw invalidLocalization(pluginId, `locale ${locale}`);
  }
}

function validMessageKey(key: string): boolean {
  return key.length <= SDK_PLUGIN_LOCALIZATION_LIMITS.maxKeyLength && MESSAGE_KEY.test(key);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function invalidLocalization(pluginId: string, reason: string): Error {
  return new Error(`Invalid plugin localization: ${pluginId} (${reason})`);
}
