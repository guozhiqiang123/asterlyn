import type { MarkdownEditorMode } from "./editor-session.ts";

export const MARKDOWN_MODE_PREFERENCES_KEY = "asterlyn.markdownModes.v1";
export const MARKDOWN_MODE_DOCUMENT_LIMIT = 128;

export interface MarkdownModePreferences {
  lastUsed: MarkdownEditorMode;
  documents: Map<string, MarkdownEditorMode>;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadMarkdownModePreferences(
  storage: Pick<StorageLike, "getItem">,
): MarkdownModePreferences {
  try {
    const raw = storage.getItem(MARKDOWN_MODE_PREFERENCES_KEY);
    if (!raw) return emptyPreferences();
    const value = JSON.parse(raw) as {
      version?: unknown;
      lastUsed?: unknown;
      documents?: unknown;
    };
    if (value.version !== 1) return emptyPreferences();
    const documents = new Map<string, MarkdownEditorMode>();
    if (Array.isArray(value.documents)) {
      for (const entry of value.documents.slice(-MARKDOWN_MODE_DOCUMENT_LIMIT)) {
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "string" &&
          entry[0].length > 0 &&
          entry[0].length <= 4096 &&
          isMarkdownEditorMode(entry[1])
        ) {
          documents.delete(entry[0]);
          documents.set(entry[0], entry[1]);
        }
      }
    }
    return {
      lastUsed: isMarkdownEditorMode(value.lastUsed) ? value.lastUsed : "source",
      documents,
    };
  } catch {
    return emptyPreferences();
  }
}

export function markdownModeForDocument(
  preferences: MarkdownModePreferences,
  documentKey: string,
): MarkdownEditorMode {
  return preferences.documents.get(documentKey) ?? preferences.lastUsed;
}

export function rememberMarkdownMode(
  preferences: MarkdownModePreferences,
  documentKey: string,
  mode: MarkdownEditorMode,
): MarkdownModePreferences {
  const documents = new Map(preferences.documents);
  documents.delete(documentKey);
  documents.set(documentKey, mode);
  while (documents.size > MARKDOWN_MODE_DOCUMENT_LIMIT) {
    const oldest = documents.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    documents.delete(oldest);
  }
  return { lastUsed: mode, documents };
}

export function saveMarkdownModePreferences(
  storage: Pick<StorageLike, "setItem">,
  preferences: MarkdownModePreferences,
): void {
  try {
    storage.setItem(
      MARKDOWN_MODE_PREFERENCES_KEY,
      JSON.stringify({
        version: 1,
        lastUsed: preferences.lastUsed,
        documents: Array.from(preferences.documents),
      }),
    );
  } catch {
    // Presentation preferences are optional and cannot block editing.
  }
}

function emptyPreferences(): MarkdownModePreferences {
  return { lastUsed: "source", documents: new Map() };
}

function isMarkdownEditorMode(value: unknown): value is MarkdownEditorMode {
  return value === "source" || value === "split" || value === "preview";
}
