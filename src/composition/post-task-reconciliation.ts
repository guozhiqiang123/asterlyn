import type { PluginWorkspaceIdentity } from "../application/plugins/index.ts";

export interface PostTaskReconciliationPort {
  readonly matches: (identity: PluginWorkspaceIdentity) => boolean;
  readonly filesRoot: () => string | null;
  readonly refreshFiles: () => Promise<unknown>;
  readonly activateWatch: () => void;
  readonly repositoryRoot: () => string | null;
  readonly ensureUntracked: (identity: PluginWorkspaceIdentity) => Promise<void>;
  readonly scheduleTracked: (identity: PluginWorkspaceIdentity) => void;
}

/** Reconciles only state a successful workspace task may have changed. */
export async function reconcileAfterSuccessfulTask(
  identity: PluginWorkspaceIdentity,
  port: PostTaskReconciliationPort,
): Promise<void> {
  if (!port.matches(identity) || port.filesRoot() !== identity.root) return;
  await port.refreshFiles();
  if (!port.matches(identity)) return;
  port.activateWatch();
  if (port.repositoryRoot() !== identity.root) return;
  await port.ensureUntracked(identity);
  if (port.matches(identity)) port.scheduleTracked(identity);
}
