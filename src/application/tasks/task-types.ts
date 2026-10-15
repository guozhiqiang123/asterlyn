export type TaskProviderStatus = "unavailable" | "loading" | "ready" | "error";

export type TaskProviderCacheStatus = "validating" | "ready" | "stale";
export type TaskProviderStaleReason =
  | "fingerprint-mismatch"
  | "watcher-change"
  | "overflow-recovery"
  | "cache-miss"
  | "cache-expired"
  | "cache-corrupt"
  | "refresh-failed"
  | "fingerprint-unavailable";

export interface TaskProviderCacheMetadata {
  readonly status: TaskProviderCacheStatus;
  readonly staleReason?: TaskProviderStaleReason;
  readonly restoredTaskCount?: number;
}

export type TaskRunState =
  | "idle"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "crashed";

export type AndroidTaskQuickActionKind = "assemble" | "bundle" | "install" | "uninstall";

export interface AndroidTaskQuickActionMetadata {
  readonly kind: AndroidTaskQuickActionKind;
  readonly module: string;
  readonly variant: string;
}

export type TaskProviderUnavailableReason =
  | "discovery-not-supported"
  | "evidence-incomplete"
  | "workspace-untrusted";

export interface TaskDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly projectPath?: string;
  readonly description?: string;
  readonly runnable: boolean;
  readonly disabledReason?: string;
  readonly runState?: TaskRunState;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly androidQuickAction?: AndroidTaskQuickActionMetadata;
}

/** A bounded, declarative projection. It grants no process or filesystem authority. */
export interface TaskProviderSnapshot {
  readonly status: TaskProviderStatus;
  readonly tasks: readonly TaskDescriptor[];
  readonly unavailableReason?: TaskProviderUnavailableReason;
  readonly error?: string;
  /** Host-reviewed cache state; it never grants execution authority. */
  readonly cache?: TaskProviderCacheMetadata;
}
