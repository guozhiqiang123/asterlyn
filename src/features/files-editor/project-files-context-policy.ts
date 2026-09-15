import type { HistoryQueryIntent } from "../../application/workbench-navigation.ts";
import type { ProjectFile, RepositorySnapshot } from "../../models.ts";
import type { ContextMenuAvailability } from "../../shared/context-menu/context-menu-model.ts";
import { defaultHistoryQuery } from "../../workbench/history-query.ts";
import type { ProjectFilesContextTarget } from "./project-files-binding.ts";

export interface ProjectFilesContextPolicyReasons {
  readonly readOnly: string;
  readonly mutationBusy: string;
  readonly clipboardEmpty: string;
  readonly operationsUnavailable: string;
  readonly gitUnavailable: string;
  readonly noHistory: string;
  readonly ambiguousHistory: string;
}

export function projectFilesContextPolicy(
  target: ProjectFilesContextTarget,
  options: {
    readonly snapshot: RepositorySnapshot | null;
    readonly files: readonly ProjectFile[];
    readonly mutationBusy: boolean;
    readonly mutationAvailable: boolean;
    readonly clipboardAvailable: boolean;
    readonly reasons: ProjectFilesContextPolicyReasons;
  },
): {
  readonly mutation: ContextMenuAvailability;
  readonly paste: ContextMenuAvailability;
  readonly history: ContextMenuAvailability;
} {
  const mutation = target.readOnly
    ? blocked(options.reasons.readOnly)
    : options.mutationBusy
      ? busy(options.reasons.mutationBusy)
      : options.mutationAvailable
        ? enabled()
        : blocked(options.reasons.operationsUnavailable);
  const paste = mutation.kind === "enabled" && !options.clipboardAvailable
    ? blocked(options.reasons.clipboardEmpty)
    : mutation;
  const history = projectFilesHistoryIntent(target, options.snapshot, options.files)
    ? enabled()
    : blocked(historyUnavailableReason(target, options.snapshot, options.files, options.reasons));
  return { mutation, paste, history };
}

export function projectFilesHistoryIntent(
  target: ProjectFilesContextTarget,
  snapshot: RepositorySnapshot | null,
  files: readonly ProjectFile[],
): HistoryQueryIntent | null {
  if (!snapshot || target.readOnly) return null;
  const path = historyPath(target, snapshot, files);
  if (!path) return null;
  const query = defaultHistoryQuery();
  query.repositoryIds = [path.repositoryId];
  query.paths = [{ repositoryId: path.repositoryId, path: path.path }];
  return {
    workspaceRoot: target.workspaceRoot,
    workspaceGeneration: target.workspaceGeneration,
    query,
  };
}

function historyPath(
  target: ProjectFilesContextTarget,
  snapshot: RepositorySnapshot,
  files: readonly ProjectFile[],
): { repositoryId: string; path: string } | null {
  if (target.kind === "file") {
    if (!target.file || target.status === "untracked" || target.status === "ignored") return null;
    return snapshot.repositoryRoots.some((root) => root.id === target.file?.repositoryId)
      ? { repositoryId: target.file.repositoryId, path: target.file.path }
      : null;
  }
  const prefix = `${target.workspacePath}/`;
  const candidates = files.filter((file) =>
    !file.readOnly &&
    file.workspacePath.startsWith(prefix) &&
    !isUntracked(snapshot, file)
  );
  const repositoryIds = Array.from(new Set(candidates.map((file) => file.repositoryId)));
  if (repositoryIds.length !== 1) return null;
  const repositoryId = repositoryIds[0]!;
  const root = snapshot.repositoryRoots.find((candidate) => candidate.id === repositoryId);
  if (!root) return null;
  const rootPath = root.relativePath === "." ? "" : trimPath(root.relativePath);
  const workspacePath = trimPath(target.workspacePath);
  if (rootPath && workspacePath !== rootPath && !workspacePath.startsWith(`${rootPath}/`)) {
    return null;
  }
  const repositoryPath = rootPath
    ? workspacePath.slice(rootPath.length).replace(/^\/+/, "")
    : workspacePath;
  return { repositoryId, path: repositoryPath || "." };
}

function isUntracked(snapshot: RepositorySnapshot, file: ProjectFile): boolean {
  return snapshot.changes.some((change) =>
    (change.path === file.workspacePath || change.path === file.path) &&
    (change.indexStatus === "untracked" || change.worktreeStatus === "untracked")
  );
}

function historyUnavailableReason(
  target: ProjectFilesContextTarget,
  snapshot: RepositorySnapshot | null,
  files: readonly ProjectFile[],
  reasons: ProjectFilesContextPolicyReasons,
): string {
  if (!snapshot) return reasons.gitUnavailable;
  if (target.readOnly || target.status === "untracked") return reasons.noHistory;
  if (target.kind === "directory") {
    const prefix = `${target.workspacePath}/`;
    const roots = new Set(files.filter((file) =>
      !file.readOnly && file.workspacePath.startsWith(prefix) && !isUntracked(snapshot, file)
    ).map((file) => file.repositoryId));
    if (roots.size > 1) return reasons.ambiguousHistory;
  }
  return reasons.noHistory;
}

function enabled(): ContextMenuAvailability {
  return { kind: "enabled" };
}

function blocked(reason: string): ContextMenuAvailability {
  return { kind: "blocked", reason };
}

function busy(label: string): ContextMenuAvailability {
  return { kind: "busy", label };
}

function trimPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}
