export const RECENT_REPOSITORY_KEY = "asterlyn.recentRepository";

interface RecentRepositoryStorage {
  getItem(key: string): string | null;
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

  try {
    storage.removeItem(RECENT_REPOSITORY_KEY);
  } catch {
    // The chooser remains usable even when persisted state is unavailable.
  }
  await choose();
  return "recovered";
}
