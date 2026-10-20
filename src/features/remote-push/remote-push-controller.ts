import type { CommitDetails, CommitFileChange, PushMode, PushTagMode, RepositorySnapshot } from "../../models.ts";
import { preferredRemote, remotePolicy } from "../../remote-policy.ts";
import { preferredPushRepository, repositoryRemotes } from "./git-root-scope.ts";
import { filesForPushReview, isPushPreviewActionable } from "./push-review.ts";
import { isValidGitBranchName } from "./git-branch-name.ts";
import { RecentValueCache } from "../../shared/recent-value-cache.ts";
import type { ErrorCopy, RemoteCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";
import { localizedOperationError, localizedRemoteOperationError, type OperationErrorPresentation } from "../../localization/error-message.ts";
import { PUSH_COMMIT_DETAILS_CACHE_LIMIT, PUSH_PREVIEW_PAGE_SIZE, type RemoteOperationResult, type RemotePushChange, type RemotePushControllerOptions, type RemotePushGateway, type UpdateDialogOptions } from "./remote-push-contract.ts";
import { createRemotePushState, defaultRemoteUpdateStrategy, isRemoteUpdateStrategyAvailable, type RemoteUpdateStrategy, type RemotePushState } from "./remote-push-state.ts";
import { readPushTagMode, readPushTagsEnabled, storePushTagMode, storePushTagsEnabled } from "./push-preferences.ts";
import { branchPushRemote, clearRemotePushSelectionState, effectivePushDestination, resetRemotePushDialogState } from "./remote-push-dialog-state.ts";
import { commitPushDiffState, initialPushDiffState, readPushDiffContent } from "./remote-push-diff.ts";

export type { PushDiffState, RemotePushState, RemoteUpdateStrategy } from "./remote-push-state.ts";
export { defaultRemoteUpdateStrategy, isRemoteUpdateStrategyAvailable, resolveRemoteUpdateActivation } from "./remote-push-state.ts";
export { PUSH_COMMIT_DETAILS_CACHE_LIMIT, PUSH_PREVIEW_PAGE_SIZE } from "./remote-push-contract.ts";
export { PUSH_TAG_MODE_KEY, PUSH_TAGS_ENABLED_KEY } from "./push-preferences.ts";
export type { RemoteOperationResult, RemotePushChange, RemotePushChangeReason, RemotePushControllerOptions, RemotePushGateway, UpdateDialogOptions } from "./remote-push-contract.ts";

type Listener = (change: RemotePushChange) => void;

export class RemotePushController {
  readonly state: RemotePushState = createRemotePushState();

  private readonly gateway: RemotePushGateway;
  private readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  private readonly previewPageSize: number;
  private readonly commitDetailsCache: RecentValueCache<CommitDetails>;
  private readonly listeners = new Set<Listener>();
  private messages: RemoteCopy;
  private errorMessages: ErrorCopy;
  private snapshot: RepositorySnapshot | null = null;
  private repositoryGeneration = 0;
  private dialogSequence = 0;
  private detailsSequence = 0;
  private diffSequence = 0;
  private operationSequence = 0;
  private disposed = false;

  constructor(gateway: RemotePushGateway, options: RemotePushControllerOptions = {}) {
    this.gateway = gateway;
    this.storage = options.storage ?? null;
    this.messages = options.messages ?? EN_US.remote;
    this.errorMessages = options.errorMessages ?? EN_US.errors;
    this.previewPageSize = options.previewPageSize ?? PUSH_PREVIEW_PAGE_SIZE;
    this.commitDetailsCache = new RecentValueCache(
      options.detailCacheLimit ?? PUSH_COMMIT_DETAILS_CACHE_LIMIT,
    );
    const initialTagsEnabled = readPushTagsEnabled(this.storage);
    if (initialTagsEnabled !== null) {
      this.state.pushTagsEnabled = initialTagsEnabled;
    }
    const initialTagMode = readPushTagMode(this.storage);
    if (initialTagMode !== null) {
      this.state.pushTagMode = initialTagMode;
    }
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMessages(messages: RemoteCopy, errorMessages: ErrorCopy = this.errorMessages): void {
    this.messages = messages;
    this.errorMessages = errorMessages;
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
    const repositoryId = this.state.dialog === "push" ? this.state.pushRepositoryId : ".";
    this.state.selectedRemote = snapshot
      ? preferredRemote(snapshot, this.state.selectedRemote, repositoryId)
      : null;
    this.emit({ reason: "snapshot", toolbarChanged: true, dialogChanged: rootChanged });
  }

  selectRemote(remote: string): boolean {
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      this.state.operation ||
      !repositoryRemotes(snapshot, this.state.dialog === "push" ? this.state.pushRepositoryId : ".")
        .some((candidate) => candidate.name === remote) ||
      remote === this.state.selectedRemote
    ) return false;
    this.state.selectedRemote = remote;
    this.state.destinationBranch = null;
    this.state.pushCustomBranch = false;
    this.state.pushCustomBranchInput = "";
    this.emit({ reason: "remote-selection", toolbarChanged: true });
    if (this.state.dialog === "push") this.reloadPushPreview(false);
    return true;
  }

  selectPushRepository(repositoryId: string): boolean {
    const snapshot = this.snapshot;
    if (
      !snapshot || this.state.dialog !== "push" || this.state.operation ||
      repositoryId === this.state.pushRepositoryId ||
      !snapshot.repositoryRoots.some((root) => root.id === repositoryId)
    ) return false;
    this.invalidateDialogRequests();
    this.resetDialog();
    this.state.pushRepositoryId = repositoryId;
    this.state.selectedRemote = preferredRemote(snapshot, null, repositoryId);
    this.state.dialog = "push";
    this.state.pushPreviewLoading = true;
    const sequence = this.dialogSequence;
    this.emit({ reason: "push-options", toolbarChanged: true, dialogChanged: true, diffChanged: true });
    void this.loadPushPreview(sequence);
    return true;
  }

  setDestinationBranch(branch: string): boolean {
    if (this.state.operation) return false;
    this.state.pushCustomBranch = false;
    this.state.pushCustomBranchInput = "";
    if (this.state.destinationBranch === branch) return false;
    this.state.destinationBranch = branch;
    if (this.state.dialog === "push") this.reloadPushPreview(true);
    return true;
  }

  enableCustomBranch(initialValue?: string): boolean {
    if (this.state.dialog !== "push" || this.state.operation) return false;
    this.state.pushCustomBranch = true;
    this.state.pushCustomBranchInput = initialValue ?? "";
    this.emit({ reason: "push-options", dialogChanged: true });
    return true;
  }

  disableCustomBranch(): boolean {
    if (this.state.dialog !== "push" || this.state.operation || !this.state.pushCustomBranch) return false;
    this.state.pushCustomBranch = false;
    this.state.pushCustomBranchInput = "";
    this.state.destinationBranch = null;
    this.reloadPushPreview(true);
    return true;
  }

  setCustomBranchInput(input: string): boolean {
    if (this.state.dialog !== "push" || this.state.operation || !this.state.pushCustomBranch) return false;
    this.state.pushCustomBranchInput = input;
    const trimmed = input.trim();
    if (isValidGitBranchName(trimmed) && trimmed !== this.state.destinationBranch) {
      this.state.destinationBranch = trimmed;
      this.reloadPushPreview(true);
    } else {
      this.emit({ reason: "push-options", dialogChanged: true });
    }
    return true;
  }

  openDialog(
    dialog: "update" | "push",
    updateOptions: UpdateDialogOptions = {},
  ): boolean {
    const snapshot = this.snapshot;
    if (!snapshot || this.state.operation) return false;
    const repositoryId = dialog === "push" ? preferredPushRepository(snapshot) : ".";
    const selectedRemote = preferredRemote(snapshot, this.state.selectedRemote, repositoryId);
    const policy = remotePolicy(snapshot, selectedRemote, undefined, repositoryId);
    const action = dialog === "update" ? policy.pull : policy.push;
    if (!action.enabled) return false;
    this.invalidateDialogRequests();
    this.resetDialog();
    this.state.pushRepositoryId = repositoryId;
    this.state.selectedRemote = selectedRemote;
    this.state.dialog = dialog;
    if (dialog === "update") {
      this.state.updateStrategy = updateOptions.strategy &&
          isRemoteUpdateStrategyAvailable(snapshot, updateOptions.strategy)
        ? updateOptions.strategy
        : defaultRemoteUpdateStrategy(snapshot);
      this.state.rememberUpdateStrategy = updateOptions.rememberStrategy ?? false;
    }
    this.state.pushPreviewLoading = dialog === "push";
    const sequence = this.dialogSequence;
    this.emit({ reason: "dialog-open", dialogChanged: true, diffChanged: true });
    if (dialog === "push") void this.loadPushPreview(sequence);
    return true;
  }

  openBranchPush(sourceBranch: string, remoteName: string, repositoryId = "."): boolean {
    const remote = branchPushRemote(this.snapshot, this.state, sourceBranch, remoteName, repositoryId);
    if (!remote) return false;
    this.invalidateDialogRequests();
    this.resetDialog();
    this.state.selectedRemote = remote;
    this.state.pushRepositoryId = repositoryId;
    this.state.sourceBranch = sourceBranch;
    this.state.dialog = "push";
    this.state.pushPreviewLoading = true;
    const sequence = this.dialogSequence;
    this.emit({ reason: "dialog-open", toolbarChanged: true, dialogChanged: true, diffChanged: true });
    void this.loadPushPreview(sequence);
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
    this.state.dialogError = message ? this.dialogError(message) : null;
    this.emit({ reason: "dialog-error", dialogChanged: true, error: message ?? undefined });
  }

  setUpdateStrategy(strategy: RemoteUpdateStrategy): void {
    if (this.state.dialog !== "update" || this.state.operation) return;
    if (!this.snapshot || !isRemoteUpdateStrategyAvailable(this.snapshot, strategy)) return;
    if (this.state.updateStrategy === strategy) return;
    this.state.updateStrategy = strategy;
    this.emit({ reason: "update-options", dialogChanged: true });
  }

  setRememberUpdateStrategy(remember: boolean): void {
    if (
      this.state.dialog !== "update" ||
      this.state.operation ||
      this.state.rememberUpdateStrategy === remember
    ) return;
    this.state.rememberUpdateStrategy = remember;
    // The native checkbox already reflects the pointer/keyboard change. Retaining the value in
    // feature state is enough and avoids replacing the entire modal for a one-bit local option.
    this.emit({ reason: "update-options" });
  }

  setPushTagsEnabled(enabled: boolean): void {
    if (this.state.pushTagsEnabled === enabled || this.state.operation) return;
    this.state.pushTagsEnabled = enabled;
    storePushTagsEnabled(this.storage, enabled);
    this.reloadPushPreview(true);
  }

  setPushTagMode(mode: Exclude<PushTagMode, "none">): void {
    if (this.state.pushTagMode === mode || this.state.operation) return;
    this.state.pushTagMode = mode;
    storePushTagMode(this.storage, mode);
    this.reloadPushPreview(true);
  }

  togglePushModeMenu(): void {
    if (!isPushPreviewActionable(this.state.pushPreview) || this.state.operation) return;
    this.state.pushModeMenuOpen = !this.state.pushModeMenuOpen;
    this.emit({ reason: "push-options", dialogChanged: true });
  }

  closePushModeMenu(): boolean {
    if (!this.state.pushModeMenuOpen) return false;
    this.state.pushModeMenuOpen = false;
    this.emit({ reason: "push-options", dialogChanged: true });
    return true;
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
    const cacheKey = `${snapshot.root}\u0000${commit.repositoryId}\u0000${oid}`;
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
      this.state.pushCommitDetailsError = this.errorMessage(error);
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
        this.state.pushRepositoryId,
        preview.remote,
        preview.tagMode,
        preview.commits.length,
        this.previewPageSize,
        this.effectiveDestinationBranch(),
        this.state.sourceBranch,
      );
      if (!this.dialogRequestMatches(sequence, generation, snapshot.root)) return;
      if ((page.repositoryId ?? this.state.pushRepositoryId) !== this.state.pushRepositoryId || page.previewToken !== preview.previewToken) {
        throw new Error(this.messages.branchOrRemoteChanged);
      }
      this.state.pushPreview = {
        ...page,
        repositoryId: this.state.pushRepositoryId,
        offset: 0,
        commits: [...preview.commits, ...page.commits.map((commit) => ({ ...commit, repositoryId: this.state.pushRepositoryId }))],
      };
      this.state.pushPreviewLoadingMore = false;
      this.emit({ reason: "preview-page-complete", dialogChanged: true });
    } catch (error) {
      if (!this.dialogRequestMatches(sequence, generation, snapshot.root)) return;
      this.state.pushPreviewLoadingMore = false;
      this.state.dialogError = this.dialogError(error);
      this.emit({
        reason: "preview-error",
        dialogChanged: true,
        error: this.dialogErrorAnnouncement(this.state.dialogError),
      });
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
    const initialDiff = initialPushDiffState(
      preview,
      this.state.pushSelectedCommit,
      selectedFile,
    );
    this.state.pushDiff = initialDiff;
    this.emit({ reason: "diff-start", dialogChanged: true, diffChanged: true });
    try {
      if (initialDiff.comparison) {
        await this.loadPushDiffContent(sequence, generation, snapshot.root);
        return;
      }
      const selectedDetails = this.state.pushSelectedCommit
        ? this.state.pushCommitDetails
        : null;
      const details = selectedDetails?.oid === this.state.pushSelectedCommit
        ? selectedDetails
        : await this.gateway.readPushFileCommit(
            snapshot.root,
            preview.repositoryId ?? this.state.pushRepositoryId,
            preview.remote,
            preview.tagMode,
            preview.previewToken,
            path,
            this.effectiveDestinationBranch(),
            this.state.sourceBranch,
          );
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      if (!details) throw new Error(this.messages.noOutgoingCommitForFile(path));
      const file = details.files.find((candidate) => candidate.path === path);
      if (!file) throw new Error(this.messages.selectedOutgoingFileMissing);
      this.state.pushDiff = commitPushDiffState(details, file);
      await this.loadPushDiffContent(sequence, generation, snapshot.root);
    } catch (error) {
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      if (this.state.pushDiff) {
        this.state.pushDiff = {
          ...this.state.pushDiff,
          loading: false,
          error: this.errorMessage(error),
        };
      }
      this.emit({
        reason: "diff-error",
        dialogChanged: true,
        diffChanged: true,
        error: this.errorMessage(error),
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
          error: this.errorMessage(error),
        };
      }
      this.emit({
        reason: "diff-error",
        dialogChanged: true,
        diffChanged: true,
        error: this.errorMessage(error),
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

  async runOperation(kind: "fetch" | "pull" | "push", background = false): Promise<RemoteOperationResult> {
    const snapshot = this.snapshot;
    if (!snapshot || this.state.operation) return { status: "unavailable" };
    const repositoryId = kind === "push" ? this.state.pushRepositoryId : ".";
    const policy = remotePolicy(snapshot, this.state.selectedRemote, undefined, repositoryId);
    const remote = policy.selectedRemote;
    const branchPush = kind === "push" && this.state.sourceBranch !== null;
    if (branchPush) {
      if (snapshot.operation || !remote?.pushSupported) return { status: "unavailable" };
    } else if (!policy[kind].enabled) {
      return { status: "unavailable" };
    }
    if (kind !== "pull" && !remote) return { status: "unavailable" };
    const preview = kind === "push" ? this.state.pushPreview : null;
    if (kind === "push" && (!preview || (this.state.pushCustomBranch && !isValidGitBranchName(this.state.pushCustomBranchInput.trim())))) {
      return { status: "unavailable" };
    }

    const generation = this.repositoryGeneration;
    const operationId = `${generation}-${++this.operationSequence}-${kind}`;
    this.state.operation = {
      id: operationId,
      root: snapshot.root,
      kind,
      background,
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
              repositoryId,
              remote!.name,
              this.state.pushMode,
              preview!.tagMode,
              preview!.previewToken,
              operationId,
              this.effectiveDestinationBranch(),
              this.state.sourceBranch,
            );
      if (!this.operationRequestMatches(generation, snapshot.root, operationId)) {
        return { status: "stale" };
      }
      return { status: "success", outcome };
    } catch (error) {
      if (!this.operationRequestMatches(generation, snapshot.root, operationId)) {
        return { status: "stale" };
      }
      this.state.dialogError = this.dialogError(error);
      this.emit({
        reason: "dialog-error",
        dialogChanged: true,
        error: this.dialogErrorAnnouncement(this.state.dialogError),
      });
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
        error: this.errorMessage(error),
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
    const repositoryId = this.state.pushRepositoryId;
    const remote = remotePolicy(snapshot, this.state.selectedRemote, undefined, repositoryId).selectedRemote;
    if (!remote) return;
    try {
      const preview = await this.gateway.readPushPreview(
        snapshot.root,
        repositoryId,
        remote.name,
        this.effectivePushTagMode(),
        0,
        this.previewPageSize,
        this.effectiveDestinationBranch(),
        this.state.sourceBranch,
      );
      if (!this.dialogRequestMatches(sequence, generation, snapshot.root)) return;
      if ((preview.repositoryId ?? repositoryId) !== repositoryId) {
        throw new Error(this.messages.branchOrRemoteChanged);
      }
      this.state.pushPreview = {
        ...preview,
        repositoryId,
        commits: preview.commits.map((commit) => ({ ...commit, repositoryId })),
      };
      this.state.pushPreviewLoading = false;
      this.state.pushPreviewRefreshing = false;
      if (
        this.state.pushSelectedCommit &&
        !this.state.pushPreview.commits.some((commit) => commit.oid === this.state.pushSelectedCommit)
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
      this.state.dialogError = this.dialogError(error);
      this.emit({
        reason: "preview-error",
        dialogChanged: true,
        error: this.dialogErrorAnnouncement(this.state.dialogError),
      });
    }
  }

  private effectivePushTagMode(): PushTagMode {
    return this.state.pushTagsEnabled ? this.state.pushTagMode : "none";
  }

  private effectiveDestinationBranch(): string | null {
    return effectivePushDestination(this.state, this.snapshot);
  }

  private async loadPushDiffContent(
    sequence: number,
    generation: number,
    repositoryRoot: string,
  ): Promise<void> {
    const current = this.state.pushDiff;
    if (!current) return;
    const content = await readPushDiffContent(this.gateway, repositoryRoot, current);
    if (!this.diffRequestMatches(sequence, generation, repositoryRoot, current.file.path)) return;
    this.state.pushDiff = {
      ...current,
      ...content,
      loading: false,
      error: null,
    };
    this.emit({ reason: "diff-complete", dialogChanged: true, diffChanged: true });
  }

  private clearPushSelection(): void {
    this.detailsSequence += 1;
    this.diffSequence += 1;
    clearRemotePushSelectionState(this.state);
  }

  private resetDialog(): void {
    this.clearPushSelection();
    resetRemotePushDialogState(this.state, this.storage);
    if (this.snapshot) this.state.selectedRemote = preferredRemote(this.snapshot, this.state.selectedRemote);
  }

  private invalidateDialogRequests(): void {
    this.dialogSequence += 1;
    this.detailsSequence += 1;
    this.diffSequence += 1;
  }

  private dialogRequestMatches(sequence: number, generation: number, root: string): boolean {
    return !this.disposed && sequence === this.dialogSequence && generation === this.repositoryGeneration && this.snapshot?.root === root && this.state.dialog === "push";
  }

  private detailsRequestMatches(sequence: number, generation: number, root: string, oid: string): boolean {
    return !this.disposed && sequence === this.detailsSequence && generation === this.repositoryGeneration && this.snapshot?.root === root && this.state.dialog === "push" && this.state.pushSelectedCommit === oid;
  }

  private diffRequestMatches(sequence: number, generation: number, root: string, path: string): boolean {
    return !this.disposed && sequence === this.diffSequence && generation === this.repositoryGeneration && this.snapshot?.root === root && this.state.dialog === "push" && this.state.pushSelectedFile === path && this.state.pushDiff?.file.path === path;
  }

  private operationRequestMatches(generation: number, root: string, operationId: string): boolean {
    return !this.disposed && generation === this.repositoryGeneration && this.snapshot?.root === root && this.state.operation?.id === operationId;
  }

  private errorMessage(error: unknown): string {
    return localizedOperationError(error, this.errorMessages);
  }

  private dialogError(error: unknown): OperationErrorPresentation {
    return localizedRemoteOperationError(
      error,
      this.errorMessages,
      this.messages.unexpectedError,
    );
  }

  private dialogErrorAnnouncement(error: OperationErrorPresentation): string {
    return error.detail ?? error.summary;
  }

  private emit(change: RemotePushChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}
