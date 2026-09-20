import type { RepositorySnapshot } from "../models.ts";
import type { SessionInvalidationSlice } from "./session-invalidation.ts";

export interface RepositoryProjectionRenderPort {
  readonly changesVisible: boolean;
  readonly branchDetailVisible: boolean;
  renderCapability(): void;
  renderChanges(): void;
  renderRefs(snapshot: RepositorySnapshot, includeDetail: boolean): void;
  renderEditor(): void;
  renderStatus(snapshot: RepositorySnapshot): void;
  renderTransient(): void;
}

export function renderRepositoryProjectionSlices(
  snapshot: RepositorySnapshot,
  slices: Iterable<SessionInvalidationSlice>,
  port: RepositoryProjectionRenderPort,
): void {
  const changed = new Set(slices);
  if (changed.has("repositoryCapability")) port.renderCapability();
  if (changed.has("workingTree") && port.changesVisible) port.renderChanges();
  if (changed.has("head") || changed.has("refs")) {
    port.renderRefs(snapshot, port.branchDetailVisible);
  }
  if (changed.has("workingTree") || changed.has("openDocuments")) port.renderEditor();
  if (["workingTree", "head", "refs", "history", "operation"].some((slice) =>
    changed.has(slice as SessionInvalidationSlice)
  )) port.renderStatus(snapshot);
  port.renderTransient();
}
