import type { PushTagMode } from "../../models.ts";

export const PUSH_TAGS_ENABLED_KEY = "asterlyn.push-tags-enabled";
export const PUSH_TAG_MODE_KEY = "asterlyn.push-tag-mode";

type PushPreferenceStorage = Pick<Storage, "getItem" | "setItem"> | null;

export function readPushTagsEnabled(storage: PushPreferenceStorage): boolean | null {
  try {
    const value = storage?.getItem(PUSH_TAGS_ENABLED_KEY);
    return value === "true" ? true : value === "false" ? false : null;
  } catch {
    return null;
  }
}

export function readPushTagMode(
  storage: PushPreferenceStorage,
): Exclude<PushTagMode, "none"> | null {
  try {
    const value = storage?.getItem(PUSH_TAG_MODE_KEY);
    return value === "currentBranch" || value === "all" ? value : null;
  } catch {
    return null;
  }
}

export function storePushTagsEnabled(
  storage: PushPreferenceStorage,
  enabled: boolean,
): void {
  try {
    storage?.setItem(PUSH_TAGS_ENABLED_KEY, String(enabled));
  } catch {}
}

export function storePushTagMode(
  storage: PushPreferenceStorage,
  mode: Exclude<PushTagMode, "none">,
): void {
  try {
    storage?.setItem(PUSH_TAG_MODE_KEY, mode);
  } catch {}
}
