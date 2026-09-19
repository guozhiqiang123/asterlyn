import type { CommitFileChange, RepositorySnapshot } from "../../models.ts";
import type { CommitFileIdentity } from "../../application/workbench-navigation.ts";
import type { CommitFileView } from "../../workbench/git-presentation.ts";
import type { GitHistoryDetailsState } from "./history-details-controller.ts";
import { commitKey } from "../../workbench/history-identity.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export type CommitDetailContextTarget = CommitFileIdentity & {
  readonly historyGeneration: number;
  readonly repositoryRevision: number;
  readonly workspacePath: string;
  readonly parentOid: string | null;
  readonly kind: "file" | "directory";
  readonly file: CommitFileChange | null;
  readonly descendants: readonly CommitFileChange[];
};

export type CommitDetailDirectoryContextTarget = CommitDetailContextTarget & {
  readonly kind: "directory";
  readonly file: null;
};

export type CommitDetailFileContextTarget = CommitDetailContextTarget & {
  readonly kind: "file";
  readonly file: CommitFileChange;
};

export class CommitDetailContextBinding {
  private readonly binding: DelegatedContextBinding<CommitDetailContextTarget>;

  constructor(
    root: HTMLElement,
    current: () => {
      readonly state: GitHistoryDetailsState;
      readonly workspaceGeneration: number;
      readonly repositoryRevision: number;
      readonly snapshot: RepositorySnapshot | null;
      readonly fileView: CommitFileView;
    },
    open: (request: DelegatedContextRequest<CommitDetailContextTarget>) => boolean,
  ) {
    this.binding = new DelegatedContextBinding(root, {
      selector: "[data-commit-file], [data-commit-file-directory] > summary",
      resolve: (trigger) => {
        const context = current();
        const filePath = trigger.dataset.commitFile;
        if (filePath) {
          return resolveCommitDetailContextTarget(
            context.state,
            context.workspaceGeneration,
            "file",
            filePath,
            context.snapshot,
            context.repositoryRevision,
            context.fileView,
          );
        }
        const directory = trigger.parentElement?.dataset.commitFileDirectory;
        return directory
          ? resolveCommitDetailContextTarget(
              context.state,
              context.workspaceGeneration,
              "directory",
              directory,
              context.snapshot,
              context.repositoryRevision,
              context.fileView,
            )
          : null;
      },
      open,
    });
  }

  dispose(): void {
    this.binding.dispose();
  }
}

export function resolveCommitDetailContextTarget(
  state: GitHistoryDetailsState,
  workspaceGeneration: number,
  kind: "file" | "directory",
  path: string,
  snapshot: RepositorySnapshot | null,
  repositoryRevision: number,
  fileView: CommitFileView,
): CommitDetailContextTarget | null {
  const root = state.history.root;
  const details = state.details;
  const selectedCommit = state.selectedCommit
    ? state.history.commits.find((commit) => commitKey(commit) === state.selectedCommit) ?? null
    : null;
  if (
    !root ||
    !snapshot ||
    snapshot.root !== root ||
    !details ||
    !selectedCommit ||
    selectedCommit.repositoryId !== details.repositoryId ||
    selectedCommit.oid !== details.oid
  ) return null;
  if (kind === "directory" && (path === "." || fileView !== "tree")) return null;
  const file = kind === "file"
    ? details.files.find((candidate) => candidate.path === path) ?? null
    : null;
  const descendants = kind === "directory"
    ? details.files.filter((candidate) => candidate.path.startsWith(`${path}/`))
    : [];
  const directoryExists = kind === "directory" && descendants.length > 0;
  if ((kind === "file" && !file) || (kind === "directory" && !directoryExists)) return null;
  const repository = snapshot.repositoryRoots.find((candidate) => candidate.id === details.repositoryId);
  if (!repository) return null;
  const workspacePath = repositoryWorkspacePath(repository.relativePath, path);
  if (!workspacePath) return null;
  return {
    workspaceRoot: root,
    workspaceGeneration,
    repositoryId: details.repositoryId,
    repositoryRevision,
    oid: details.oid,
    path,
    workspacePath,
    parentOid: details.parentOid,
    kind,
    file: file ? { ...file } : null,
    descendants: descendants.map((candidate) => ({ ...candidate })),
    historyGeneration: state.history.generation,
  };
}

function repositoryWorkspacePath(relativeRoot: string, repositoryPath: string): string | null {
  const root = normalizePath(relativeRoot);
  const path = normalizePath(repositoryPath);
  if (root === null || path === null) return null;
  if (root === ".") return path;
  if (path === ".") return root;
  return `${root}/${path}`;
}

function normalizePath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "") || ".";
  if (normalized === ".") return normalized;
  const segments = normalized.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..")
    ? normalized
    : null;
}
