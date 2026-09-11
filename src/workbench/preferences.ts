import type { DiffLayout } from "../diff-presentation";

export const APP_PREFERENCES_KEY = "asterlyn.preferences.v1";
export const UI_FONT_SIZES = [10, 11, 12, 13, 14] as const;
export const EDITOR_FONT_SIZES = [11, 12, 13, 14, 16, 18, 20, 22, 24] as const;
export const EDITOR_LINE_HEIGHTS = [1, 1.1, 1.2, 1.35, 1.5, 1.62, 1.8, 2] as const;
export const EDITOR_LETTER_SPACINGS = [-0.5, -0.25, 0, 0.25, 0.5, 1] as const;
export const EDITOR_INDENT_SIZES = [2, 4, 8] as const;
export const EDITOR_TAB_SIZES = [2, 4, 8] as const;

export interface AppPreferences {
  uiFontSize: number;
  editorFontSize: number;
  editorLineHeight: number;
  editorLetterSpacing: number;
  editorIndentSize: number;
  editorTabSize: number;
  diffLayout: DiffLayout;
  showWhitespace: boolean;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  uiFontSize: 13,
  editorFontSize: 14,
  editorLineHeight: 1.35,
  editorLetterSpacing: 0,
  editorIndentSize: 4,
  editorTabSize: 4,
  diffLayout: "split",
  showWhitespace: false,
};

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

export function loadAppPreferences(storage: StorageReader): AppPreferences {
  try {
    const raw = storage.getItem(APP_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_APP_PREFERENCES };
    const value = JSON.parse(raw) as { version?: unknown; preferences?: unknown };
    if (
      (value.version !== 1 &&
        value.version !== 2 &&
        value.version !== 3 &&
        value.version !== 4) ||
      !isRecord(value.preferences)
    ) {
      return { ...DEFAULT_APP_PREFERENCES };
    }
    const preferences = value.preferences;
    const uiFontDefault = value.version === 1 ? 11 : null;
    const editorFontDefault = value.version === 1 ? 12 : value.version < 4 ? 13 : null;
    const editorLineHeightDefault =
      value.version === 1 ? 1.62 : value.version < 4 ? 1.2 : null;
    return {
      uiFontSize: allowedNumber(
        migrateVersionedDefault(
          preferences.uiFontSize,
          uiFontDefault,
          DEFAULT_APP_PREFERENCES.uiFontSize,
        ),
        UI_FONT_SIZES,
        13,
      ),
      editorFontSize: allowedNumber(
        migrateVersionedDefault(
          preferences.editorFontSize,
          editorFontDefault,
          DEFAULT_APP_PREFERENCES.editorFontSize,
        ),
        EDITOR_FONT_SIZES,
        DEFAULT_APP_PREFERENCES.editorFontSize,
      ),
      editorLineHeight: allowedNumber(
        migrateVersionedDefault(
          preferences.editorLineHeight,
          editorLineHeightDefault,
          DEFAULT_APP_PREFERENCES.editorLineHeight,
        ),
        EDITOR_LINE_HEIGHTS,
        DEFAULT_APP_PREFERENCES.editorLineHeight,
      ),
      editorLetterSpacing: allowedNumber(
        preferences.editorLetterSpacing,
        EDITOR_LETTER_SPACINGS,
        0,
      ),
      editorIndentSize: allowedNumber(
        preferences.editorIndentSize,
        EDITOR_INDENT_SIZES,
        4,
      ),
      editorTabSize: allowedNumber(
        preferences.editorTabSize,
        EDITOR_TAB_SIZES,
        4,
      ),
      diffLayout:
        preferences.diffLayout === "unified" || preferences.diffLayout === "split"
          ? preferences.diffLayout
          : "split",
      showWhitespace:
        typeof preferences.showWhitespace === "boolean"
          ? preferences.showWhitespace
          : false,
    };
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

export function saveAppPreferences(
  storage: StorageWriter,
  preferences: AppPreferences,
): void {
  storage.setItem(
    APP_PREFERENCES_KEY,
    JSON.stringify({ version: 4, preferences }),
  );
}

export function updateAppPreferences(
  current: AppPreferences,
  patch: Partial<AppPreferences>,
): AppPreferences {
  const candidate = { ...current, ...patch };
  return {
    uiFontSize: allowedNumber(candidate.uiFontSize, UI_FONT_SIZES, current.uiFontSize),
    editorFontSize: allowedNumber(
      candidate.editorFontSize,
      EDITOR_FONT_SIZES,
      current.editorFontSize,
    ),
    editorLineHeight: allowedNumber(
      candidate.editorLineHeight,
      EDITOR_LINE_HEIGHTS,
      current.editorLineHeight,
    ),
    editorLetterSpacing: allowedNumber(
      candidate.editorLetterSpacing,
      EDITOR_LETTER_SPACINGS,
      current.editorLetterSpacing,
    ),
    editorIndentSize: allowedNumber(
      candidate.editorIndentSize,
      EDITOR_INDENT_SIZES,
      current.editorIndentSize,
    ),
    editorTabSize: allowedNumber(
      candidate.editorTabSize,
      EDITOR_TAB_SIZES,
      current.editorTabSize,
    ),
    diffLayout:
      candidate.diffLayout === "unified" || candidate.diffLayout === "split"
        ? candidate.diffLayout
        : current.diffLayout,
    showWhitespace:
      typeof candidate.showWhitespace === "boolean"
        ? candidate.showWhitespace
        : current.showWhitespace,
  };
}

function allowedNumber<T extends number>(
  value: unknown,
  allowed: readonly T[],
  fallback: number,
): number {
  return typeof value === "number" && allowed.includes(value as T) ? value : fallback;
}

function migrateVersionedDefault(
  value: unknown,
  previousDefault: number | null,
  nextDefault: number,
): unknown {
  return previousDefault !== null && value === previousDefault ? nextDefault : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
