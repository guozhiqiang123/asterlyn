import type { HistoryRef } from "../models";
import { historyRefKey } from "./history-identity.ts";

const HISTORY_REFS_KEY_PREFIX = "asterlyn.historyRefs.v2.";
const LEGACY_HISTORY_REFS_KEY_PREFIX = "asterlyn.historyRefs.v1.";
const RECENT_LIMIT = 8;

export interface HistoryRefPreferences {
  favoriteRefs: HistoryRef[];
  recentRefs: HistoryRef[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadHistoryRefPreferences(
  storage: StorageLike,
  repositoryRoot: string,
  availableRefs: Iterable<HistoryRef>,
): HistoryRefPreferences {
  const available = new Map(
    Array.from(availableRefs, (reference) => [historyRefKey(reference), reference]),
  );
  try {
    const stored = storage.getItem(preferenceKey(repositoryRoot));
    if (stored !== null) {
      const value = JSON.parse(stored) as Partial<HistoryRefPreferences> | null;
      return {
        favoriteRefs: validRefs(value?.favoriteRefs, available),
        recentRefs: validRefs(value?.recentRefs, available).slice(0, RECENT_LIMIT),
      };
    }
    const legacy = JSON.parse(
      storage.getItem(legacyPreferenceKey(repositoryRoot)) ?? "null",
    ) as { favoriteRefs?: unknown; recentRefs?: unknown } | null;
    return {
      favoriteRefs: migrateLegacyRefs(legacy?.favoriteRefs, available),
      recentRefs: migrateLegacyRefs(legacy?.recentRefs, available).slice(0, RECENT_LIMIT),
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
      favoriteRefs: uniqueRefs(preferences.favoriteRefs),
      recentRefs: uniqueRefs(preferences.recentRefs).slice(0, RECENT_LIMIT),
    }),
  );
}

export function toggleFavoriteRef(
  preferences: HistoryRefPreferences,
  reference: HistoryRef,
): HistoryRefPreferences {
  const key = historyRefKey(reference);
  const favorites = new Map(
    preferences.favoriteRefs.map((item) => [historyRefKey(item), item]),
  );
  if (favorites.has(key)) favorites.delete(key);
  else favorites.set(key, reference);
  return {
    favoriteRefs: Array.from(favorites.values()),
    recentRefs: [...preferences.recentRefs],
  };
}

export function touchRecentRef(
  preferences: HistoryRefPreferences,
  reference: HistoryRef,
): HistoryRefPreferences {
  const key = historyRefKey(reference);
  return {
    favoriteRefs: [...preferences.favoriteRefs],
    recentRefs: [
      reference,
      ...preferences.recentRefs.filter((item) => historyRefKey(item) !== key),
    ].slice(0, RECENT_LIMIT),
  };
}

function validRefs(
  values: unknown,
  available: Map<string, HistoryRef>,
): HistoryRef[] {
  if (!Array.isArray(values)) return [];
  const candidates = values.flatMap((value) => {
    if (!isHistoryRef(value)) return [];
    return [{ repositoryId: value.repositoryId, fullName: value.fullName }];
  });
  return uniqueRefs(candidates).flatMap((reference) => {
    const current = available.get(historyRefKey(reference));
    return current ? [current] : [];
  });
}

function migrateLegacyRefs(
  values: unknown,
  available: Map<string, HistoryRef>,
): HistoryRef[] {
  if (!Array.isArray(values)) return [];
  return uniqueRefs(
    values.flatMap((value) =>
      typeof value === "string" && value.length > 0
        ? [{ repositoryId: ".", fullName: value }]
        : [],
    ),
  ).flatMap((reference) => {
    const current = available.get(historyRefKey(reference));
    return current ? [current] : [];
  });
}

function uniqueRefs(values: HistoryRef[]): HistoryRef[] {
  return Array.from(
    new Map(values.map((value) => [historyRefKey(value), value])).values(),
  );
}

function isHistoryRef(value: unknown): value is HistoryRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "repositoryId" in value &&
    typeof value.repositoryId === "string" &&
    "fullName" in value &&
    typeof value.fullName === "string"
  );
}

function preferenceKey(repositoryRoot: string): string {
  return `${HISTORY_REFS_KEY_PREFIX}${encodeURIComponent(repositoryRoot)}`;
}

function legacyPreferenceKey(repositoryRoot: string): string {
  return `${LEGACY_HISTORY_REFS_KEY_PREFIX}${encodeURIComponent(repositoryRoot)}`;
}
