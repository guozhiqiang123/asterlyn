import type {
  SdkTaskDescriptor,
  SdkTaskProviderSnapshot,
  SdkTaskExecutionRequest,
  SdkTaskExecutionResult,
  SdkTaskRefreshPlan,
  SdkTaskRunPlan,
} from "../../../packages/plugin-sdk/index.ts";

export type GradleTaskDescriptor = SdkTaskDescriptor;
export type GradleTaskDiscoveryResult = SdkTaskProviderSnapshot & { readonly tasks: readonly GradleTaskDescriptor[] };
export type TaskExecutionRequest = SdkTaskExecutionRequest;
export type PluginTaskExecutionResult = SdkTaskExecutionResult;
export type PluginTaskRefreshPlan = SdkTaskRefreshPlan;
export type PluginTaskRunPlan = SdkTaskRunPlan;
export type TaskProviderSnapshot = SdkTaskProviderSnapshot;
export type TaskDescriptor = SdkTaskDescriptor;

export type AndroidGradleQuickActionKind = "assemble" | "bundle" | "install" | "uninstall";
const QUICK_KIND = "android.quickAction.kind";
const QUICK_MODULE = "android.quickAction.module";
const QUICK_VARIANT = "android.quickAction.variant";

export interface AndroidGradleQuickActionMetadata {
  readonly kind: AndroidGradleQuickActionKind;
  readonly module: string;
  readonly variant: string;
}

export function withQuickAction(task: SdkTaskDescriptor, quick: AndroidGradleQuickActionMetadata): SdkTaskDescriptor {
  return { ...task, metadata: { ...(task.metadata ?? {}), [QUICK_KIND]: quick.kind, [QUICK_MODULE]: quick.module, [QUICK_VARIANT]: quick.variant } };
}

export function readQuickAction(task: SdkTaskDescriptor): AndroidGradleQuickActionMetadata | null {
  const metadata = task.metadata;
  if (!metadata) return null;
  const kind = metadata[QUICK_KIND];
  const module = metadata[QUICK_MODULE];
  const variant = metadata[QUICK_VARIANT];
  return kind && module && variant && ["assemble", "bundle", "install", "uninstall"].includes(kind)
    ? { kind: kind as AndroidGradleQuickActionKind, module, variant } : null;
}

export function withoutRunState(task: SdkTaskDescriptor): SdkTaskDescriptor {
  const { runState: _runState, disabledReason: _disabledReason, runnable: _runnable, ...declarative } = task;
  return { ...declarative, runnable: false };
}
