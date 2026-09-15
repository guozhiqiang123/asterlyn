import type { CommitFileChange } from "../../models.ts";
import type { CommitFileIdentity } from "../../application/workbench-navigation.ts";
import type { GitHistoryDetailsState } from "./history-details-controller.ts";
import { commitKey } from "../../workbench/history-identity.ts";
import {
  DelegatedContextBinding,
  type DelegatedContextRequest,
} from "../../shared/context-menu/delegated-context-binding.ts";

export type CommitDetailContextTarget = CommitFileIdentity & {
  readonly historyGeneration: number;
  readonly kind: "file" | "directory";
  readonly file: CommitFileChange | null;
};

export class CommitDetailContextBinding {
  private readonly binding: DelegatedContextBinding<CommitDetailContextTarget>;

  constructor(
    root: HTMLElement,
    current: () => {
      readonly state: GitHistoryDetailsState;
      readonly workspaceGeneration: number;
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
          );
        }
        const directory = trigger.parentElement?.dataset.commitFileDirectory;
        return directory
          ? resolveCommitDetailContextTarget(
              context.state,
              context.workspaceGeneration,
              "directory",
              directory,
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
): CommitDetailContextTarget | null {
  const root = state.history.root;
  const details = state.details;
  const selectedCommit = state.selectedCommit
    ? state.history.commits.find((commit) => commitKey(commit) === state.selectedCommit) ?? null
    : null;
  if (
    !root ||
    !details ||
    !selectedCommit ||
    selectedCommit.repositoryId !== details.repositoryId ||
    selectedCommit.oid !== details.oid
  ) return null;
  const file = kind === "file"
    ? details.files.find((candidate) => candidate.path === path) ?? null
    : null;
  const directoryExists = kind === "directory" && (
    path === "." || details.files.some((candidate) => candidate.path.startsWith(`${path}/`))
  );
  if ((kind === "file" && !file) || (kind === "directory" && !directoryExists)) return null;
  return {
    workspaceRoot: root,
    workspaceGeneration,
    repositoryId: details.repositoryId,
    oid: details.oid,
    path,
    kind,
    file: file ? { ...file } : null,
    historyGeneration: state.history.generation,
  };
}
