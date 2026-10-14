export type RecentTaskStatus = "succeeded" | "failed" | "cancelled" | "crashed";
export interface RecentTaskRecord {
  readonly pluginId: string;
  readonly providerId: string;
  readonly taskId: string;
  readonly label: string;
  readonly status: RecentTaskStatus;
  readonly timestamp: number;
}

export interface RecentTaskStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }
const MAX_RECORDS = 20;
const MAX_TEXT = 256;
const MAX_SERIALIZED_LENGTH = 64 * 1024;
const STATUSES = new Set<RecentTaskStatus>(["succeeded", "failed", "cancelled", "crashed"]);

export class RecentTaskStore {
  private readonly storage: RecentTaskStorage;
  private readonly key: string;
  constructor(storage: RecentTaskStorage, key = "asterlyn.recentTasks") { this.storage = storage; this.key = key; }
  list(): readonly RecentTaskRecord[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw || raw.length > MAX_SERIALIZED_LENGTH) return [];
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length > MAX_RECORDS) return [];
      const records = value.map(normalize);
      return records.some((item) => item === null) ? [] : records as RecentTaskRecord[];
    } catch { return []; }
  }
  record(record: RecentTaskRecord): void {
    const normalized = normalize(record);
    if (!normalized) return;
    try { this.storage.setItem(this.key, JSON.stringify([normalized, ...this.list()].slice(0, MAX_RECORDS))); } catch { /* profile storage is optional */ }
  }
}

function normalize(value: unknown): RecentTaskRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const fields = [item.pluginId, item.providerId, item.taskId, item.label];
  if (!fields.every((field) => typeof field === "string" && field.length > 0 && field.length <= MAX_TEXT)) return null;
  if (typeof item.status !== "string" || !STATUSES.has(item.status as RecentTaskStatus)) return null;
  if (typeof item.timestamp !== "number" || !Number.isSafeInteger(item.timestamp) || item.timestamp < 0) return null;
  return Object.freeze({ pluginId: item.pluginId as string, providerId: item.providerId as string, taskId: item.taskId as string, label: item.label as string, status: item.status as RecentTaskStatus, timestamp: item.timestamp });
}

export const RECENT_TASK_LIMIT = MAX_RECORDS;
