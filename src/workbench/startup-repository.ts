export const RECENT_REPOSITORY_KEY = "asterlyn.recentRepository";
export const RECENT_REPOSITORIES_KEY = "asterlyn.recentRepositories.v1";
export const RECENT_REPOSITORY_LIMIT = 8;

interface RecentRepositoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type RecentRepositoryRestore = "opened" | "recovered" | "empty";

export async function restoreRecentRepository(
  storage: RecentRepositoryStorage,
  open: (path: string) => Promise<boolean>,
  choose: () => Promise<void>,
): Promise<RecentRepositoryRestore> {
  let recent: string | null = null;
  try {
    recent = storage.getItem(RECENT_REPOSITORY_KEY);
  } catch {
    // Storage failure must not block the first project chooser.
  }
  if (!recent) {
    await choose();
    return "empty";
  }

  let opened = false;
  try {
    opened = await open(recent);
  } catch {
    // A stale path is a recoverable startup condition, not a fatal toast.
  }
  if (opened) return "opened";

  forgetRecentRepository(storage, recent);
  await choose();
  return "recovered";
}

export function loadRecentRepositories(
  storage: Pick<RecentRepositoryStorage, "getItem">,
): string[] {
  try {
    const encoded = storage.getItem(RECENT_REPOSITORIES_KEY);
    if (!encoded) return [];
    const value = JSON.parse(encoded) as { version?: unknown; paths?: unknown };
    if (value.version !== 1 || !Array.isArray(value.paths)) return [];
    return normalizedRecentPaths(value.paths);
  } catch {
    return [];
  }
}

export function touchRecentRepository(
  storage: RecentRepositoryStorage,
  path: string,
): string[] {
  const normalized = normalizedPath(path);
  if (!normalized) return loadRecentRepositories(storage);
  const paths = [
    normalized,
    ...loadRecentRepositories(storage).filter((candidate) => candidate !== normalized),
  ].slice(0, RECENT_REPOSITORY_LIMIT);
  try {
    storage.setItem(RECENT_REPOSITORY_KEY, normalized);
    saveRecentRepositories(storage, paths);
  } catch {
    // Recent-project persistence is optional and cannot invalidate an open project.
  }
  return paths;
}

export function forgetRecentRepository(
  storage: RecentRepositoryStorage,
  path: string,
): string[] {
  const normalized = normalizedPath(path);
  const paths = loadRecentRepositories(storage).filter(
    (candidate) => candidate !== normalized,
  );
  try {
    if (storage.getItem(RECENT_REPOSITORY_KEY) === normalized) {
      storage.removeItem(RECENT_REPOSITORY_KEY);
    }
    saveRecentRepositories(storage, paths);
  } catch {
    // The chooser remains usable even when persisted state is unavailable.
  }
  return paths;
}

function saveRecentRepositories(
  storage: Pick<RecentRepositoryStorage, "setItem">,
  paths: string[],
): void {
  storage.setItem(
    RECENT_REPOSITORIES_KEY,
    JSON.stringify({ version: 1, paths }),
  );
}

function normalizedRecentPaths(paths: unknown[]): string[] {
  const unique = new Set<string>();
  for (const candidate of paths) {
    const path = normalizedPath(candidate);
    if (path) unique.add(path);
    if (unique.size === RECENT_REPOSITORY_LIMIT) break;
  }
  return [...unique];
}

function normalizedPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  const normalized = path.trim();
  return normalized.length > 0 ? normalized : null;
}
