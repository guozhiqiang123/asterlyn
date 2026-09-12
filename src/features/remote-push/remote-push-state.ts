import type {
  CommitDetails,
  CommitDiffResult,
  CommitFileChange,
  ImageDiffPreview,
  PushMode,
  PushPreview,
  PushTagMode,
} from "../../models.ts";

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

export type RemoteUpdateStrategy = "ffOnly" | "merge" | "rebase";

export interface RemotePushState {
  selectedRemote: string | null;
  operation: RemoteOperationState | null;
  dialog: "update" | "push" | null;
  dialogError: string | null;
  updateStrategy: RemoteUpdateStrategy;
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
