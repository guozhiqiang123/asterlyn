const HISTORY_REFS_KEY_PREFIX = "asterlyn.historyRefs.v1.";
const RECENT_LIMIT = 8;

export interface HistoryRefPreferences {
  favoriteRefs: string[];
  recentRefs: string[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadHistoryRefPreferences(
  storage: StorageLike,
  repositoryRoot: string,
  availableRefs: Iterable<string>,
): HistoryRefPreferences {
  const available = new Set(availableRefs);
  try {
    const value = JSON.parse(storage.getItem(preferenceKey(repositoryRoot)) ?? "null") as
      | Partial<HistoryRefPreferences>
      | null;
    return {
      favoriteRefs: validRefs(value?.favoriteRefs, available),
      recentRefs: validRefs(value?.recentRefs, available).slice(0, RECENT_LIMIT),
    };
  } catch {
    return { favoriteRefs: [], recentRefs: [] };
  }
}

export function saveHistoryRefPreferences(
  storage: StorageLike,
  repositoryRoot: string,
  preferences: HistoryRefPreferences,
): void {
  storage.setItem(
    preferenceKey(repositoryRoot),
    JSON.stringify({
      favoriteRefs: uniqueStrings(preferences.favoriteRefs),
      recentRefs: uniqueStrings(preferences.recentRefs).slice(0, RECENT_LIMIT),
    }),
  );
}

export function toggleFavoriteRef(
  preferences: HistoryRefPreferences,
  fullName: string,
): HistoryRefPreferences {
  const favorites = new Set(preferences.favoriteRefs);
  if (favorites.has(fullName)) favorites.delete(fullName);
  else favorites.add(fullName);
  return {
    favoriteRefs: Array.from(favorites),
    recentRefs: [...preferences.recentRefs],
  };
}

export function touchRecentRef(
  preferences: HistoryRefPreferences,
  fullName: string,
): HistoryRefPreferences {
  return {
    favoriteRefs: [...preferences.favoriteRefs],
    recentRefs: [
      fullName,
      ...preferences.recentRefs.filter((reference) => reference !== fullName),
    ].slice(0, RECENT_LIMIT),
  };
}

function validRefs(values: unknown, available: Set<string>): string[] {
  if (!Array.isArray(values)) return [];
  return uniqueStrings(values).filter((value) => available.has(value));
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)),
  );
}

function preferenceKey(repositoryRoot: string): string {
  return `${HISTORY_REFS_KEY_PREFIX}${encodeURIComponent(repositoryRoot)}`;
}
