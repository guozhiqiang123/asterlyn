import type {
  CommitDetails,
  CommitDiffResult,
  ImageDiffPreview,
  PushMode,
  PushPreview,
  PushTagMode,
  RepositoryMutationOutcome,
} from "../../models.ts";
import type { ErrorCopy, RemoteCopy } from "../../localization/catalog.ts";
import type { RemoteUpdateStrategy } from "./remote-push-state.ts";

export const PUSH_PREVIEW_PAGE_SIZE = 100;
export const PUSH_COMMIT_DETAILS_CACHE_LIMIT = 48;

export type RemotePushChangeReason =
  | "snapshot"
  | "remote-selection"
  | "dialog-open"
  | "dialog-close"
  | "dialog-error"
  | "preview-refresh-start"
  | "preview-complete"
  | "preview-error"
  | "preview-page-start"
  | "preview-page-complete"
  | "commit-selection"
  | "commit-details-start"
  | "commit-details-complete"
  | "commit-details-error"
  | "file-selection"
  | "file-presentation"
  | "update-options"
  | "push-options"
  | "diff-start"
  | "diff-complete"
  | "diff-error"
  | "diff-close"
  | "operation-start"
  | "operation-cancelling"
  | "operation-complete";

export interface RemotePushChange {
  reason: RemotePushChangeReason;
  toolbarChanged?: boolean;
  dialogChanged?: boolean;
  diffChanged?: boolean;
  preserveDialogDom?: boolean;
  error?: string;
}

export interface RemotePushGateway {
  readPushPreview(
    repositoryRoot: string,
    remote: string,
    tagMode: PushTagMode,
    offset: number,
    pageSize: number,
  ): Promise<PushPreview>;
  readCommitDetails(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
  ): Promise<CommitDetails>;
  readPushFileCommit(
    repositoryRoot: string,
    remote: string,
    tagMode: PushTagMode,
    previewToken: string,
    path: string,
  ): Promise<CommitDetails | null>;
  readCommitDiff(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    path: string,
    originalPath: string | null,
    expandedUnchanged: boolean,
  ): Promise<CommitDiffResult>;
  readCommitImageDiff(
    repositoryRoot: string,
    repositoryId: string,
    commitOid: string,
    path: string,
    originalPath: string | null,
  ): Promise<ImageDiffPreview>;
  fetchRemote(
    repositoryRoot: string,
    remote: string,
    operationId: string,
  ): Promise<RepositoryMutationOutcome>;
  pullCurrent(repositoryRoot: string, operationId: string): Promise<RepositoryMutationOutcome>;
  pushCurrent(
    repositoryRoot: string,
    remote: string,
    mode: PushMode,
    tagMode: PushTagMode,
    previewToken: string,
    operationId: string,
  ): Promise<RepositoryMutationOutcome>;
  cancelRemoteOperation(repositoryRoot: string, operationId: string): Promise<void>;
}

export type RemoteOperationResult =
  | { status: "success"; outcome: RepositoryMutationOutcome }
  | { status: "failure"; error: unknown }
  | { status: "stale" }
  | { status: "unavailable" };

export interface RemotePushControllerOptions {
  previewPageSize?: number;
  detailCacheLimit?: number;
  messages?: RemoteCopy;
  errorMessages?: ErrorCopy;
}

export interface UpdateDialogOptions {
  strategy?: RemoteUpdateStrategy;
  rememberStrategy?: boolean;
}
