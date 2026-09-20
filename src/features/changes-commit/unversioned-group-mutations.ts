import type { WorkingTreeMutationOutcome } from "../../models.ts";
import type { LocaleCatalog } from "../../localization/catalog.ts";
import type {
  EditorPathMigrationLease,
  EditorPathMigrationPreparation,
} from "../../application/editor-session-port.ts";
import type { ChangesGroupContextTarget } from "./changes-navigation-binding.ts";

export interface UnversionedGroupMutationCopy {
  readonly targetChanged: string;
  readonly stageAction: string;
  readonly saveBeforeTrash: string;
  readonly trashBlocked: string;
  readonly ready: string;
  staging(count: number): string;
  staged(count: number): string;
  trashing(completed: number, total: number): string;
  trashed(count: number): string;
}

interface UnversionedGroupMutationPort {
  current(target: ChangesGroupContextTarget): boolean;
  saveDirtyTabsBefore(label: string): Promise<boolean>;
  beginTransition(): number;
  matches(generation: number, root: string): boolean;
  completeTransition(generation: number): void;
  setLoading(loading: boolean, message: string): void;
  stagePaths(root: string, paths: string[]): Promise<WorkingTreeMutationOutcome>;
  trashPaths(root: string, paths: string[]): Promise<WorkingTreeMutationOutcome>;
  install(outcome: WorkingTreeMutationOutcome): string;
  captureEditor(): void;
  prepareTrash(root: string, paths: readonly string[]): EditorPathMigrationPreparation;
  applyTrash(lease: EditorPathMigrationLease): "applied" | "stale" | "runtime-conflict";
  releaseTrash(lease: EditorPathMigrationLease): void;
  loadProjectFiles(root: string, generation: number): Promise<void>;
  render(): void;
  status(message: string, tone: "success" | "warning"): void;
  refresh(): Promise<void>;
  scanUntracked(root: string, generation: number): Promise<void>;
  copy(): UnversionedGroupMutationCopy;
}

export interface UnversionedGroupMutationRuntime {
  stage(target: ChangesGroupContextTarget): Promise<void>;
  trash(target: ChangesGroupContextTarget, progress: (completed: number) => void): Promise<void>;
}

export function unversionedGroupMutationCopy(catalog: LocaleCatalog): UnversionedGroupMutationCopy {
  return {
    targetChanged: catalog.changes.contextMenu.targetChanged,
    stageAction: catalog.changes.contextMenu.stageAllUnversioned,
    saveBeforeTrash: catalog.changes.saveBeforeTrashUnversioned,
    trashBlocked: catalog.projectFiles.contextMenu.trashBlocked,
    ready: catalog.common.ready,
    staging: catalog.changes.stagingUnversioned,
    staged: catalog.changes.stagedUnversioned,
    trashing: catalog.changes.trashingUnversioned,
    trashed: catalog.changes.trashedUnversioned,
  };
}

/** Serializes group mutations through the canonical window transition and reconciliation ports. */
export function createUnversionedGroupMutationRuntime(
  port: UnversionedGroupMutationPort,
): UnversionedGroupMutationRuntime {
  return {
    async stage(target) {
      const copy = port.copy();
      if (!port.current(target)) return port.status(copy.targetChanged, "warning");
      if (!(await port.saveDirtyTabsBefore(copy.stageAction))) return;
      if (!port.current(target)) return port.status(copy.targetChanged, "warning");
      const generation = port.beginTransition();
      let pendingRoot: string | null = null;
      let failure: unknown = null;
      port.setLoading(true, copy.staging(target.paths.length));
      try {
        const outcome = await port.stagePaths(target.workspaceRoot, [...target.paths]);
        if (!port.matches(generation, target.workspaceRoot)) return;
        pendingRoot = port.install(outcome);
        port.render();
        port.status(copy.staged(target.paths.length), "success");
      } catch (error) {
        failure = error;
      } finally {
        port.completeTransition(generation);
        if (port.matches(generation, target.workspaceRoot)) port.setLoading(false, copy.ready);
      }
      if (failure && port.matches(generation, target.workspaceRoot)) {
        await port.refresh();
        throw failure;
      }
      if (pendingRoot && port.matches(generation, target.workspaceRoot)) {
        void port.scanUntracked(pendingRoot, generation);
      }
    },

    async trash(target, progress) {
      const copy = port.copy();
      if (!port.current(target)) throw new Error("target-changed");
      port.captureEditor();
      const prepared = port.prepareTrash(target.workspaceRoot, target.paths);
      if (prepared.status !== "ready") {
        throw new Error(
          prepared.status === "blocked" && prepared.reason === "dirtyDelete"
            ? copy.saveBeforeTrash
            : copy.trashBlocked,
        );
      }
      const generation = port.beginTransition();
      let leaseApplied = false;
      let pendingRoot: string | null = null;
      let failure: unknown = null;
      port.setLoading(true, copy.trashing(0, target.paths.length));
      try {
        const outcome = await port.trashPaths(target.workspaceRoot, [...target.paths]);
        progress(target.paths.length);
        if (!port.matches(generation, target.workspaceRoot)) return;
        leaseApplied = port.applyTrash(prepared.lease) === "applied";
        if (!leaseApplied) throw new Error(copy.targetChanged);
        pendingRoot = port.install(outcome);
        await port.loadProjectFiles(target.workspaceRoot, generation);
        port.render();
        port.status(copy.trashed(target.paths.length), "success");
      } catch (error) {
        failure = error;
      } finally {
        if (!leaseApplied) port.releaseTrash(prepared.lease);
        port.completeTransition(generation);
        if (port.matches(generation, target.workspaceRoot)) port.setLoading(false, copy.ready);
      }
      if (failure && port.matches(generation, target.workspaceRoot)) {
        await port.refresh();
        throw failure;
      }
      if (pendingRoot && port.matches(generation, target.workspaceRoot)) {
        await port.scanUntracked(pendingRoot, generation);
      }
    },
  };
}
