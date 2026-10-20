import type { RepositorySnapshot } from "../../models.ts";
import { isValidGitBranchName } from "./git-branch-name.ts";
import { readPushTagMode, readPushTagsEnabled } from "./push-preferences.ts";
import type { RemotePushState } from "./remote-push-state.ts";
import { repositoryBranch, repositoryRemotes } from "./git-root-scope.ts";

type PushPreferenceStorage = Pick<Storage, "getItem" | "setItem"> | null;

export function branchPushRemote(
  snapshot: RepositorySnapshot | null,
  state: RemotePushState,
  sourceBranch: string,
  remoteName: string,
  repositoryId = ".",
): string | null {
  if (!snapshot || state.operation || snapshot.operation) return null;
  const remote = repositoryRemotes(snapshot, repositoryId).find((candidate) => candidate.name === remoteName);
  const branch = snapshot.branches.find((candidate) =>
    candidate.repositoryId === repositoryId && candidate.kind === "local" &&
    candidate.fullName === sourceBranch
  );
  return remote?.pushSupported && branch ? remote.name : null;
}

export function effectivePushDestination(
  state: RemotePushState,
  snapshot: RepositorySnapshot | null,
): string | null {
  if (state.pushCustomBranch) {
    const trimmed = state.pushCustomBranchInput.trim();
    return isValidGitBranchName(trimmed) ? trimmed : null;
  }
  return state.destinationBranch ?? (state.sourceBranch
    ? null
    : (snapshot ? repositoryBranch(snapshot, state.pushRepositoryId)?.head ?? null : null));
}

export function resetRemotePushDialogState(
  state: RemotePushState,
  storage: PushPreferenceStorage,
): void {
  state.sourceBranch = null;
  state.pushRepositoryId = ".";
  state.dialog = null;
  state.dialogError = null;
  state.rememberUpdateStrategy = false;
  state.pushPreview = null;
  state.pushPreviewLoading = false;
  state.pushPreviewRefreshing = false;
  state.pushPreviewLoadingMore = false;
  clearRemotePushSelectionState(state);
  state.pushTagsEnabled = readPushTagsEnabled(storage) ?? state.pushTagsEnabled;
  state.pushTagMode = readPushTagMode(storage) ?? state.pushTagMode;
  state.destinationBranch = null;
  state.pushCustomBranch = false;
  state.pushCustomBranchInput = "";
  state.pushMode = "ordinary";
  state.pushModeMenuOpen = false;
  state.pushFileActionLoading = false;
}

export function clearRemotePushSelectionState(state: RemotePushState): void {
  state.pushSelectedCommit = null;
  state.pushCommitDetails = null;
  state.pushCommitDetailsLoading = false;
  state.pushCommitDetailsError = null;
  state.pushSelectedFile = null;
  state.pushDiff = null;
  state.pushCollapsedFileDirectories.clear();
}
