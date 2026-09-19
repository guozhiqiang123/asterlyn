import type {
  CommitDetails,
  CommitDiffResult,
  CommitFileChange,
  ImageDiffPreview,
  PushMode,
  PushPreview,
  PushTagMode,
  RepositorySnapshot,
} from "../../models.ts";
import type {
  AppPreferences,
  RemoteUpdateStrategyPreference,
} from "../../preferences.ts";

export interface PushDiffState {
  repositoryId: string | null;
  oid: string | null;
  file: CommitFileChange;
  patch: CommitDiffResult | null;
  image: ImageDiffPreview | null;
  loading: boolean;
  error: string | null;
  expandedUnchanged: boolean;
}

export interface RemoteOperationState {
  id: string;
  root: string;
  kind: "fetch" | "pull" | "push";
  cancelling: boolean;
}

export type RemoteUpdateStrategy = RemoteUpdateStrategyPreference;

export function defaultRemoteUpdateStrategy(
  snapshot: RepositorySnapshot,
): RemoteUpdateStrategy {
  return snapshot.branch.ahead > 0 && snapshot.branch.behind > 0
    ? "merge"
    : "ffOnly";
}

export function isRemoteUpdateStrategyAvailable(
  snapshot: RepositorySnapshot,
  strategy: RemoteUpdateStrategy,
): boolean {
  if (strategy === "ffOnly") {
    return snapshot.branch.ahead === 0 || snapshot.branch.behind === 0;
  }
  if (strategy === "rebase") return snapshot.branch.ahead > 0;
  return true;
}

export type RemoteUpdateActivation =
  | { kind: "execute"; strategy: RemoteUpdateStrategy }
  | {
      kind: "review";
      strategy: RemoteUpdateStrategy;
      rememberStrategy: boolean;
    };

export function resolveRemoteUpdateActivation(
  snapshot: RepositorySnapshot,
  preferences: Pick<
    AppPreferences,
    "askBeforeRemoteUpdate" | "preferredRemoteUpdateStrategy"
  >,
): RemoteUpdateActivation {
  const preferred = preferences.preferredRemoteUpdateStrategy;
  if (
    !preferences.askBeforeRemoteUpdate &&
    isRemoteUpdateStrategyAvailable(snapshot, preferred)
  ) {
    return { kind: "execute", strategy: preferred };
  }
  return {
    kind: "review",
    strategy: isRemoteUpdateStrategyAvailable(snapshot, preferred)
      ? preferred
      : defaultRemoteUpdateStrategy(snapshot),
    rememberStrategy: !preferences.askBeforeRemoteUpdate,
  };
}

export interface RemotePushState {
  selectedRemote: string | null;
  operation: RemoteOperationState | null;
  dialog: "update" | "push" | null;
  dialogError: string | null;
  updateStrategy: RemoteUpdateStrategy;
  rememberUpdateStrategy: boolean;
  pushPreview: PushPreview | null;
  pushPreviewLoading: boolean;
  pushPreviewRefreshing: boolean;
  pushPreviewLoadingMore: boolean;
  pushSelectedCommit: string | null;
  pushCommitDetails: CommitDetails | null;
  pushCommitDetailsLoading: boolean;
  pushCommitDetailsError: string | null;
  pushSelectedFile: string | null;
  pushFileView: "tree" | "flat";
  pushCollapsedFileDirectories: Set<string>;
  pushTagsEnabled: boolean;
  pushTagMode: Exclude<PushTagMode, "none">;
  pushMode: PushMode;
  pushModeMenuOpen: boolean;
  pushFileActionLoading: boolean;
  pushDiff: PushDiffState | null;
}

export function createRemotePushState(): RemotePushState {
  return {
    selectedRemote: null,
    operation: null,
    dialog: null,
    dialogError: null,
    updateStrategy: "ffOnly",
    rememberUpdateStrategy: false,
    pushPreview: null,
    pushPreviewLoading: false,
    pushPreviewRefreshing: false,
    pushPreviewLoadingMore: false,
    pushSelectedCommit: null,
    pushCommitDetails: null,
    pushCommitDetailsLoading: false,
    pushCommitDetailsError: null,
    pushSelectedFile: null,
    pushFileView: "tree",
    pushCollapsedFileDirectories: new Set(),
    pushTagsEnabled: false,
    pushTagMode: "all",
    pushMode: "ordinary",
    pushModeMenuOpen: false,
    pushFileActionLoading: false,
    pushDiff: null,
  };
}
