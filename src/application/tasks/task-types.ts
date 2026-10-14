export type TaskProviderStatus = "unavailable" | "loading" | "ready" | "error";

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
  readonly description?: string;
  readonly runnable: boolean;
  readonly disabledReason?: string;
  readonly runState?: TaskRunState;
  readonly androidQuickAction?: AndroidTaskQuickActionMetadata;
}

/** A bounded, declarative projection. It grants no process or filesystem authority. */
export interface TaskProviderSnapshot {
  readonly status: TaskProviderStatus;
  readonly tasks: readonly TaskDescriptor[];
  readonly unavailableReason?: TaskProviderUnavailableReason;
  readonly error?: string;
}
