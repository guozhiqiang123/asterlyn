import type { WorkspaceMutationOutcome, WorkspaceMutationRecoverySummary } from "../../models.ts";
import type {
  WorkspaceMutationExecutionResult,
  WorkspaceMutationIdentity,
  WorkspaceMutationPlanResult,
} from "../../application/workspace-mutation-coordinator.ts";
import type { ProjectFilesContextTarget } from "./project-files-binding.ts";
import type {
  ProjectFilesInlineEdit,
} from "./project-files-operation-controller.ts";
import type { ProjectFilesOperationMessages } from "./project-files-operation-types.ts";

export function validateWorkspaceEntryName(value: string): string | null {
  if (
    !value || value === "." || value === ".." || value.includes("/") ||
    value.includes("\\") || value.includes("\0")
  ) return null;
  return value;
}

export function destinationDirectory(target: ProjectFilesContextTarget): string {
  return target.kind === "directory" ? target.workspacePath : parentPath(target.workspacePath);
}

export function parentPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const offset = normalized.lastIndexOf("/");
  return offset < 0 ? "" : normalized.slice(0, offset);
}

export function baseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").at(-1) ?? path;
}

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function completedOutcome(
  result: WorkspaceMutationExecutionResult,
): WorkspaceMutationOutcome | null {
  return result.status === "completed" &&
      (result.outcome.status === "completed" || result.outcome.status === "noOp")
    ? result.outcome
    : null;
}

export function planFailure(
  result: WorkspaceMutationPlanResult,
  messages: ProjectFilesOperationMessages,
): string {
  if (result.status === "blocked" && result.reason === "destinationExists") {
    return messages.destinationExists;
  }
  if (result.status === "failure" && result.error instanceof Error) return result.error.message;
  return messages.operationFailed;
}

export function executionFailure(
  result: WorkspaceMutationExecutionResult,
  messages: ProjectFilesOperationMessages,
): string {
  if ("outcome" in result && result.outcome.error) return result.outcome.error;
  if (result.status === "failure" && result.error instanceof Error) return result.error.message;
  return messages.operationFailed;
}

export function recoveryPaths(recovery: WorkspaceMutationRecoverySummary): string[] {
  const paths = recovery.sourceStates.map((state) => state.path);
  if (recovery.destination) paths.push(recovery.destination);
  return Array.from(new Set(paths));
}

export function targetFromEdit(
  identity: WorkspaceMutationIdentity,
  edit: ProjectFilesInlineEdit,
): ProjectFilesContextTarget {
  return {
    workspaceRoot: identity.root,
    workspaceGeneration: identity.generation,
    workspacePath: edit.sourcePath ?? edit.anchorPath,
    kind: edit.sourceKind ?? "file",
    file: null,
    status: "unmodified",
    readOnly: false,
  };
}

export function isAtOrBelow(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}
