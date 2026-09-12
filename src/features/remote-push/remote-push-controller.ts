import type {
  CommitDetails,
  CommitDiffResult,
  CommitFileChange,
  ImageDiffPreview,
  PushMode,
  PushPreview,
  PushTagMode,
  RepositoryMutationOutcome,
  RepositorySnapshot,
} from "../../models.ts";
import { preferredRemote, remotePolicy } from "../../remote-policy.ts";
import { filesForPushReview } from "../../workbench/push-review.ts";
import { isImagePreviewPath } from "../../workbench/image-preview.ts";
import { RecentValueCache } from "../../workbench/recent-value-cache.ts";
import {
  createRemotePushState,
  type RemoteUpdateStrategy,
  type RemotePushState,
} from "./remote-push-state.ts";

export type {
  PushDiffState,
  RemotePushState,
  RemoteUpdateStrategy,
} from "./remote-push-state.ts";

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
}

type Listener = (change: RemotePushChange) => void;

export class RemotePushController {
  readonly state: RemotePushState = createRemotePushState();

  private readonly gateway: RemotePushGateway;
  private readonly previewPageSize: number;
  private readonly commitDetailsCache: RecentValueCache<CommitDetails>;
  private readonly listeners = new Set<Listener>();
  private snapshot: RepositorySnapshot | null = null;
  private repositoryGeneration = 0;
  private dialogSequence = 0;
  private detailsSequence = 0;
  private diffSequence = 0;
  private operationSequence = 0;
  private disposed = false;

  constructor(gateway: RemotePushGateway, options: RemotePushControllerOptions = {}) {
    this.gateway = gateway;
    this.previewPageSize = options.previewPageSize ?? PUSH_PREVIEW_PAGE_SIZE;
    this.commitDetailsCache = new RecentValueCache(
      options.detailCacheLimit ?? PUSH_COMMIT_DETAILS_CACHE_LIMIT,
    );
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installSnapshot(snapshot: RepositorySnapshot | null): void {
    const rootChanged = this.snapshot?.root !== snapshot?.root;
    this.snapshot = snapshot;
    if (rootChanged) {
      this.repositoryGeneration += 1;
      this.invalidateDialogRequests();
      this.resetDialog();
      this.state.operation = null;
    }
    this.state.selectedRemote = snapshot
      ? preferredRemote(snapshot, this.state.selectedRemote)
      : null;
    this.emit({ reason: "snapshot", toolbarChanged: true, dialogChanged: rootChanged });
  }

  selectRemote(remote: string): boolean {
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      this.state.operation ||
      !snapshot.remotes.some((candidate) => candidate.name === remote) ||
      remote === this.state.selectedRemote
    ) {
      return false;
    }
    this.state.selectedRemote = remote;
    this.emit({ reason: "remote-selection", toolbarChanged: true });
    if (this.state.dialog === "push") this.reloadPushPreview(false);
    return true;
  }

  openDialog(dialog: "update" | "push"): boolean {
    const snapshot = this.snapshot;
    if (!snapshot || this.state.operation) return false;
    const policy = remotePolicy(snapshot, this.state.selectedRemote);
    const action = dialog === "update" ? policy.pull : policy.push;
    if (!action.enabled) return false;
    this.invalidateDialogRequests();
    this.resetDialog();
    this.state.dialog = dialog;
    if (dialog === "update") {
      this.state.updateStrategy = snapshot.branch.ahead > 0 && snapshot.branch.behind > 0
        ? "merge"
        : "ffOnly";
    }
    this.state.pushPreviewLoading = dialog === "push";
    const sequence = this.dialogSequence;
    this.emit({ reason: "dialog-open", dialogChanged: true, diffChanged: true });
    if (dialog === "push") void this.loadPushPreview(sequence);
    return true;
  }

  closeDialog(): boolean {
    if (this.state.operation) return false;
    this.invalidateDialogRequests();
    this.resetDialog();
    this.emit({ reason: "dialog-close", dialogChanged: true, diffChanged: true });
    return true;
  }

  setDialogError(message: string | null): void {
    this.state.dialogError = message;
    this.emit({ reason: "dialog-error", dialogChanged: true, error: message ?? undefined });
  }

  setUpdateStrategy(strategy: RemoteUpdateStrategy): void {
    if (this.state.dialog !== "update" || this.state.operation) return;
    if (strategy === "rebase" && (this.snapshot?.branch.ahead ?? 0) === 0) return;
    if (strategy === "ffOnly" && (this.snapshot?.branch.ahead ?? 0) > 0) return;
    if (this.state.updateStrategy === strategy) return;
    this.state.updateStrategy = strategy;
    this.emit({ reason: "update-options", dialogChanged: true });
  }

  setPushTagsEnabled(enabled: boolean): void {
    if (this.state.pushTagsEnabled === enabled || this.state.operation) return;
    this.state.pushTagsEnabled = enabled;
    this.reloadPushPreview(true);
  }

  setPushTagMode(mode: Exclude<PushTagMode, "none">): void {
    if (this.state.pushTagMode === mode || this.state.operation) return;
    this.state.pushTagMode = mode;
    this.reloadPushPreview(true);
  }

  togglePushModeMenu(): void {
    if (!this.state.pushPreview || this.state.operation) return;
    this.state.pushModeMenuOpen = !this.state.pushModeMenuOpen;
    this.emit({ reason: "push-options", dialogChanged: true });
  }

  setPushMode(mode: PushMode): void {
    if (this.state.operation) return;
    this.state.pushMode = mode;
    this.state.pushModeMenuOpen = false;
    this.emit({ reason: "push-options", dialogChanged: true });
  }

  togglePushFileView(): void {
    this.state.pushFileView = this.state.pushFileView === "tree" ? "flat" : "tree";
    this.emit({ reason: "file-presentation", dialogChanged: true });
  }

  setPushDirectoryExpanded(path: string, expanded: boolean): void {
    if (expanded) this.state.pushCollapsedFileDirectories.delete(path);
    else this.state.pushCollapsedFileDirectories.add(path);
  }

  expandPushDirectories(): void {
    this.state.pushCollapsedFileDirectories.clear();
    this.emit({ reason: "file-presentation", dialogChanged: true });
  }

  collapsePushDirectories(paths: Iterable<string>): void {
    this.state.pushCollapsedFileDirectories = new Set(paths);
    this.emit({ reason: "file-presentation", dialogChanged: true });
  }

  selectPushFile(path: string | null): void {
    if (path === this.state.pushSelectedFile) return;
    this.diffSequence += 1;
    this.state.pushSelectedFile = path;
    this.state.pushDiff = null;
    this.state.pushFileActionLoading = false;
    this.emit({ reason: "file-selection", dialogChanged: false, diffChanged: true });
  }

  pushReviewFiles(): CommitFileChange[] {
    const preview = this.state.pushPreview;
    if (!preview) return [];
    return filesForPushReview(
      preview.files,
      this.state.pushSelectedCommit,
      this.state.pushCommitDetails,
    );
  }

  async selectPushCommit(oid: string | null): Promise<void> {
    const snapshot = this.snapshot;
    const preview = this.state.pushPreview;
    if (!snapshot || !preview || this.state.dialog !== "push") return;
    this.detailsSequence += 1;
    this.diffSequence += 1;
    this.state.pushSelectedCommit = oid;
    this.state.pushCommitDetails = null;
    this.state.pushCommitDetailsLoading = false;
    this.state.pushCommitDetailsError = null;
    this.state.pushSelectedFile = null;
    this.state.pushDiff = null;
    this.state.pushCollapsedFileDirectories.clear();
    this.emit({ reason: "commit-selection", dialogChanged: true, diffChanged: true });
    if (!oid) return;
    const commit = preview.commits.find((candidate) => candidate.oid === oid);
    if (!commit) return;
    const cacheKey = detailsCacheKey(snapshot.root, commit.repositoryId, oid);
    const cached = this.commitDetailsCache.get(cacheKey);
    if (cached) {
      this.state.pushCommitDetails = cached;
      this.emit({ reason: "commit-details-complete", dialogChanged: true });
      return;
    }
    const sequence = ++this.detailsSequence;
    const generation = this.repositoryGeneration;
    this.state.pushCommitDetailsLoading = true;
    this.emit({ reason: "commit-details-start", dialogChanged: true });
    try {
      const details = await this.gateway.readCommitDetails(
        snapshot.root,
        commit.repositoryId,
        oid,
      );
      if (!this.detailsRequestMatches(sequence, generation, snapshot.root, oid)) return;
      this.commitDetailsCache.set(cacheKey, details);
      this.state.pushCommitDetails = details;
      this.state.pushCommitDetailsLoading = false;
      this.emit({ reason: "commit-details-complete", dialogChanged: true });
    } catch (error) {
      if (!this.detailsRequestMatches(sequence, generation, snapshot.root, oid)) return;
      this.state.pushCommitDetailsLoading = false;
      this.state.pushCommitDetailsError = toErrorMessage(error);
      this.emit({
        reason: "commit-details-error",
        dialogChanged: true,
        error: this.state.pushCommitDetailsError,
      });
    }
  }

  async loadMorePushPreview(): Promise<void> {
    const snapshot = this.snapshot;
    const preview = this.state.pushPreview;
    if (
      !snapshot ||
      !preview ||
      !preview.hasMore ||
      this.state.pushPreviewLoadingMore ||
      this.state.dialog !== "push"
    ) return;
    const sequence = this.dialogSequence;
    const generation = this.repositoryGeneration;
    this.state.pushPreviewLoadingMore = true;
    this.emit({ reason: "preview-page-start", dialogChanged: true });
    try {
      const page = await this.gateway.readPushPreview(
        snapshot.root,
        preview.remote,
        preview.tagMode,
        preview.commits.length,
        this.previewPageSize,
      );
      if (!this.dialogRequestMatches(sequence, generation, snapshot.root)) return;
      if (page.previewToken !== preview.previewToken) {
        throw new Error("The branch or remote-tracking state changed. Close and review Push again.");
      }
      this.state.pushPreview = {
        ...page,
        offset: 0,
        commits: [...preview.commits, ...page.commits],
      };
      this.state.pushPreviewLoadingMore = false;
      this.emit({ reason: "preview-page-complete", dialogChanged: true });
    } catch (error) {
      if (!this.dialogRequestMatches(sequence, generation, snapshot.root)) return;
      this.state.pushPreviewLoadingMore = false;
      this.state.dialogError = toErrorMessage(error);
      this.emit({ reason: "preview-error", dialogChanged: true, error: this.state.dialogError });
    }
  }

  async openSelectedPushFileDiff(): Promise<void> {
    const snapshot = this.snapshot;
    const preview = this.state.pushPreview;
    const path = this.state.pushSelectedFile;
    if (!snapshot || !preview || !path || this.state.pushFileActionLoading) return;
    const selectedFile = this.pushReviewFiles().find((file) => file.path === path);
    if (!selectedFile) return;
    const sequence = ++this.diffSequence;
    const generation = this.repositoryGeneration;
    this.state.pushFileActionLoading = true;
    this.state.pushDiff = {
      repositoryId: null,
      oid: null,
      file: selectedFile,
      patch: null,
      image: null,
      loading: true,
      error: null,
      expandedUnchanged: false,
    };
    this.emit({ reason: "diff-start", dialogChanged: true, diffChanged: true });
    try {
      const selectedDetails = this.state.pushSelectedCommit
        ? this.state.pushCommitDetails
        : null;
      const details = selectedDetails?.oid === this.state.pushSelectedCommit
        ? selectedDetails
        : await this.gateway.readPushFileCommit(
            snapshot.root,
            preview.remote,
            preview.tagMode,
            preview.previewToken,
            path,
          );
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      if (!details) throw new Error("No outgoing commit contains this file.");
      const file = details.files.find((candidate) => candidate.path === path);
      if (!file) throw new Error("The selected file is not present in its latest outgoing commit.");
      this.state.pushDiff = {
        repositoryId: details.repositoryId,
        oid: details.oid,
        file,
        patch: null,
        image: null,
        loading: true,
        error: null,
        expandedUnchanged: false,
      };
      await this.loadPushDiffContent(sequence, generation, snapshot.root);
    } catch (error) {
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      if (this.state.pushDiff) {
        this.state.pushDiff = {
          ...this.state.pushDiff,
          loading: false,
          error: toErrorMessage(error),
        };
      }
      this.emit({
        reason: "diff-error",
        dialogChanged: true,
        diffChanged: true,
        error: toErrorMessage(error),
      });
    } finally {
      if (this.diffRequestMatches(sequence, generation, snapshot.root, path)) {
        this.state.pushFileActionLoading = false;
        this.emit({ reason: "diff-complete", dialogChanged: false });
      }
    }
  }

  async togglePushDiffUnchangedLines(): Promise<void> {
    const snapshot = this.snapshot;
    const current = this.state.pushDiff;
    if (!snapshot || !current?.repositoryId || !current.oid || !current.patch) return;
    const sequence = ++this.diffSequence;
    const generation = this.repositoryGeneration;
    this.state.pushDiff = {
      ...current,
      patch: null,
      loading: true,
      error: null,
      expandedUnchanged: !current.expandedUnchanged,
    };
    this.emit({ reason: "diff-start", dialogChanged: true, diffChanged: true });
    try {
      await this.loadPushDiffContent(sequence, generation, snapshot.root);
    } catch (error) {
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, current.file.path)) return;
      if (this.state.pushDiff) {
        this.state.pushDiff = {
          ...this.state.pushDiff,
          loading: false,
          error: toErrorMessage(error),
        };
      }
      this.emit({
        reason: "diff-error",
        dialogChanged: true,
        diffChanged: true,
        error: toErrorMessage(error),
      });
    }
  }

  closePushDiff(): string | null {
    const path = this.state.pushDiff?.file.path ?? null;
    this.diffSequence += 1;
    this.state.pushDiff = null;
    this.state.pushFileActionLoading = false;
    this.emit({ reason: "diff-close", dialogChanged: true, diffChanged: true });
    return path;
  }

  async runOperation(kind: "fetch" | "pull" | "push"): Promise<RemoteOperationResult> {
    const snapshot = this.snapshot;
    if (!snapshot || this.state.operation) return { status: "unavailable" };
    const policy = remotePolicy(snapshot, this.state.selectedRemote);
    if (!policy[kind].enabled) return { status: "unavailable" };
    const remote = policy.selectedRemote;
    if (kind !== "pull" && !remote) return { status: "unavailable" };
    const preview = kind === "push" ? this.state.pushPreview : null;
    if (kind === "push" && !preview) return { status: "unavailable" };

    const generation = this.repositoryGeneration;
    const operationId = `${generation}-${++this.operationSequence}-${kind}`;
    this.state.operation = {
      id: operationId,
      root: snapshot.root,
      kind,
      cancelling: false,
    };
    this.state.dialogError = null;
    this.state.updateStrategy = "ffOnly";
    this.emit({ reason: "operation-start", toolbarChanged: true, dialogChanged: true });
    try {
      const outcome = kind === "fetch"
        ? await this.gateway.fetchRemote(snapshot.root, remote!.name, operationId)
        : kind === "pull"
          ? await this.gateway.pullCurrent(snapshot.root, operationId)
          : await this.gateway.pushCurrent(
              snapshot.root,
              remote!.name,
              this.state.pushMode,
              preview!.tagMode,
              preview!.previewToken,
              operationId,
            );
      if (!this.operationRequestMatches(generation, snapshot.root, operationId)) {
        return { status: "stale" };
      }
      return { status: "success", outcome };
    } catch (error) {
      if (!this.operationRequestMatches(generation, snapshot.root, operationId)) {
        return { status: "stale" };
      }
      this.state.dialogError = toErrorMessage(error);
      this.emit({ reason: "dialog-error", dialogChanged: true, error: this.state.dialogError });
      return { status: "failure", error };
    } finally {
      if (this.operationRequestMatches(generation, snapshot.root, operationId)) {
        this.state.operation = null;
        this.emit({ reason: "operation-complete", toolbarChanged: true, dialogChanged: true });
      }
    }
  }

  async cancelActiveOperation(): Promise<void> {
    const operation = this.state.operation;
    if (!operation || operation.cancelling) return;
    operation.cancelling = true;
    this.emit({ reason: "operation-cancelling", toolbarChanged: true, dialogChanged: true });
    try {
      await this.gateway.cancelRemoteOperation(operation.root, operation.id);
    } catch (error) {
      if (this.state.operation?.id !== operation.id) return;
      operation.cancelling = false;
      this.emit({
        reason: "operation-complete",
        toolbarChanged: true,
        dialogChanged: true,
        error: toErrorMessage(error),
      });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.repositoryGeneration += 1;
    this.invalidateDialogRequests();
    this.listeners.clear();
    this.snapshot = null;
    this.state.operation = null;
  }

  private reloadPushPreview(preserveContent: boolean): void {
    if (this.state.dialog !== "push" || this.state.operation) return;
    const sequence = ++this.dialogSequence;
    if (!preserveContent) {
      this.state.pushPreview = null;
      this.state.pushPreviewLoading = true;
      this.clearPushSelection();
    }
    this.state.pushPreviewRefreshing = preserveContent;
    this.state.dialogError = null;
    this.state.pushModeMenuOpen = false;
    this.emit({
      reason: "preview-refresh-start",
      dialogChanged: !preserveContent,
      diffChanged: !preserveContent,
      preserveDialogDom: preserveContent,
    });
    void this.loadPushPreview(sequence);
  }

  private async loadPushPreview(sequence: number): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot || this.state.dialog !== "push") return;
    const generation = this.repositoryGeneration;
    const remote = remotePolicy(snapshot, this.state.selectedRemote).selectedRemote;
    if (!remote) return;
    try {
      const preview = await this.gateway.readPushPreview(
        snapshot.root,
        remote.name,
        this.effectivePushTagMode(),
        0,
        this.previewPageSize,
      );
      if (!this.dialogRequestMatches(sequence, generation, snapshot.root)) return;
      this.state.pushPreview = preview;
      this.state.pushPreviewLoading = false;
      this.state.pushPreviewRefreshing = false;
      if (
        this.state.pushSelectedCommit &&
        !preview.commits.some((commit) => commit.oid === this.state.pushSelectedCommit)
      ) {
        this.clearPushSelection();
      }
      if (!this.pushReviewFiles().some((file) => file.path === this.state.pushSelectedFile)) {
        this.state.pushSelectedFile = null;
      }
      this.emit({ reason: "preview-complete", dialogChanged: true });
    } catch (error) {
      if (!this.dialogRequestMatches(sequence, generation, snapshot.root)) return;
      this.state.pushPreviewLoading = false;
      this.state.pushPreviewRefreshing = false;
      this.state.dialogError = toErrorMessage(error);
      this.emit({ reason: "preview-error", dialogChanged: true, error: this.state.dialogError });
    }
  }

  private effectivePushTagMode(): PushTagMode {
    return this.state.pushTagsEnabled ? this.state.pushTagMode : "none";
  }

  private async loadPushDiffContent(
    sequence: number,
    generation: number,
    repositoryRoot: string,
  ): Promise<void> {
    const current = this.state.pushDiff;
    if (!current?.repositoryId || !current.oid) return;
    const { repositoryId, oid, file, expandedUnchanged } = current;
    const image = isImagePreviewPath(file.path);
    const result = image
      ? await this.gateway.readCommitImageDiff(
          repositoryRoot,
          repositoryId,
          oid,
          file.path,
          file.originalPath,
        )
      : await this.gateway.readCommitDiff(
          repositoryRoot,
          repositoryId,
          oid,
          file.path,
          file.originalPath,
          expandedUnchanged,
        );
    if (!this.diffRequestMatches(sequence, generation, repositoryRoot, file.path)) return;
    this.state.pushDiff = {
      ...current,
      patch: image ? null : result as CommitDiffResult,
      image: image ? result as ImageDiffPreview : null,
      loading: false,
      error: null,
    };
    this.emit({ reason: "diff-complete", dialogChanged: true, diffChanged: true });
  }

  private clearPushSelection(): void {
    this.detailsSequence += 1;
    this.diffSequence += 1;
    this.state.pushSelectedCommit = null;
    this.state.pushCommitDetails = null;
    this.state.pushCommitDetailsLoading = false;
    this.state.pushCommitDetailsError = null;
    this.state.pushSelectedFile = null;
    this.state.pushDiff = null;
    this.state.pushCollapsedFileDirectories.clear();
  }

  private resetDialog(): void {
    this.state.dialog = null;
    this.state.dialogError = null;
    this.state.pushPreview = null;
    this.state.pushPreviewLoading = false;
    this.state.pushPreviewRefreshing = false;
    this.state.pushPreviewLoadingMore = false;
    this.clearPushSelection();
    this.state.pushTagsEnabled = false;
    this.state.pushTagMode = "all";
    this.state.pushMode = "ordinary";
    this.state.pushModeMenuOpen = false;
    this.state.pushFileActionLoading = false;
  }

  private invalidateDialogRequests(): void {
    this.dialogSequence += 1;
    this.detailsSequence += 1;
    this.diffSequence += 1;
  }

  private dialogRequestMatches(
    sequence: number,
    generation: number,
    root: string,
  ): boolean {
    return !this.disposed &&
      sequence === this.dialogSequence &&
      generation === this.repositoryGeneration &&
      this.snapshot?.root === root &&
      this.state.dialog === "push";
  }

  private detailsRequestMatches(
    sequence: number,
    generation: number,
    root: string,
    oid: string,
  ): boolean {
    return !this.disposed &&
      sequence === this.detailsSequence &&
      generation === this.repositoryGeneration &&
      this.snapshot?.root === root &&
      this.state.dialog === "push" &&
      this.state.pushSelectedCommit === oid;
  }

  private diffRequestMatches(
    sequence: number,
    generation: number,
    root: string,
    path: string,
  ): boolean {
    return !this.disposed &&
      sequence === this.diffSequence &&
      generation === this.repositoryGeneration &&
      this.snapshot?.root === root &&
      this.state.dialog === "push" &&
      this.state.pushSelectedFile === path &&
      this.state.pushDiff?.file.path === path;
  }

  private operationRequestMatches(
    generation: number,
    root: string,
    operationId: string,
  ): boolean {
    return !this.disposed &&
      generation === this.repositoryGeneration &&
      this.snapshot?.root === root &&
      this.state.operation?.id === operationId;
  }

  private emit(change: RemotePushChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

function detailsCacheKey(repositoryRoot: string, repositoryId: string, oid: string): string {
  return `${repositoryRoot}\u0000${repositoryId}\u0000${oid}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unexpected Git remote error";
}
