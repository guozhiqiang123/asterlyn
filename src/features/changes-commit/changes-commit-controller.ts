import type {
  ChangeSelection,
  CommitSelectedResult,
  DiffResult,
  FileChange,
  RestoreChangesPlan,
  ImageDiffPreview,
  RepositoryMutationOutcome,
  RepositorySnapshot,
  WorkingDiffBase,
  WorkingTreeMutationOutcome,
} from "../../models.ts";
import {
  includedChanges,
  reconcileExcludedChangePaths,
  type ChangeFileView,
} from "./change-presentation.ts";
import { isImagePreviewPath } from "../../presentation/image-preview.ts";
import type { ChangesCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";
import {
  fileChangeKey,
  changeWorkspacePath,
  findFileChange,
  sameFileChangeIdentity,
} from "../../change-identity.ts";

export interface ChangesCommitState {
  selectedChange: ChangeSelection | null;
  workingDiffPath: string | null;
  excludedPaths: Set<string>;
  fileView: ChangeFileView;
  collapsedDirectories: Set<string>;
  commitMessage: string;
  workingPatch: DiffResult | null;
  workingDiffBase: WorkingDiffBase | null;
  workingImageDiff: ImageDiffPreview | null;
  workingPatchLoading: boolean;
  workingPatchError: string | null;
  workingPatchVersion: number;
  mutation: "revert" | "commit" | "stash" | null;
}

export type ChangesCommitChangeReason =
  | "snapshot"
  | "selection"
  | "inclusion"
  | "presentation"
  | "message"
  | "diff-clear"
  | "diff-start"
  | "diff-complete"
  | "diff-error"
  | "mutation-start"
  | "mutation-complete";

export interface ChangesCommitChange {
  reason: ChangesCommitChangeReason;
  navigationChanged?: boolean;
  selectionChanged?: boolean;
  inclusionChanged?: boolean;
  composerChanged?: boolean;
  diffChanged?: boolean;
  error?: string;
  warning?: string;
}

export interface ChangesCommitGateway {
  readLocalDiff(
    repositoryRoot: string,
    change: FileChange,
    expandedUnchanged: boolean,
  ): Promise<DiffResult>;
  readLocalImageDiff(
    repositoryRoot: string,
    change: FileChange,
  ): Promise<ImageDiffPreview>;
  readWorkingDiffBase(
    repositoryRoot: string,
    change: FileChange,
  ): Promise<WorkingDiffBase>;
  revertChanges(
    repositoryRoot: string,
    plan: RestoreChangesPlan,
  ): Promise<WorkingTreeMutationOutcome>;
  prepareRestoreChanges(repositoryRoot: string, changes: FileChange[]): Promise<RestoreChangesPlan>;
  commitChanges(
    repositoryRoot: string,
    message: string,
    changes: FileChange[],
  ): Promise<CommitSelectedResult>;
  stashChanges(
    repositoryRoot: string,
    message: string,
    changes: FileChange[],
    keepIndex: boolean,
  ): Promise<RepositoryMutationOutcome>;
}

export interface SnapshotInstallOptions {
  clearInclusion?: boolean;
  clearDisclosure?: boolean;
  clearSelection?: boolean;
}

export type ChangesMutationResult<T> =
  | { status: "success"; value: T }
  | { status: "failure"; error: unknown }
  | { status: "stale" }
  | { status: "unavailable" };

type Listener = (change: ChangesCommitChange) => void;

const DEFAULT_DIFF_REQUEST_TIMEOUT_MS = 15_000;

export class ChangesCommitController {
  readonly state: ChangesCommitState;

  private readonly gateway: ChangesCommitGateway;
  private readonly listeners = new Set<Listener>();
  private snapshot: RepositorySnapshot | null = null;
  private repositoryGeneration = 0;
  private diffSequence = 0;
  private mutationSequence = 0;
  private disposed = false;
  private messages: Pick<ChangesCopy, "patchTruncated" | "patchTimedOut" | "unexpectedError">;
  private readonly diffRequestTimeoutMs: number;

  constructor(
    gateway: ChangesCommitGateway,
    initialFileView: ChangeFileView = "tree",
    messages: Pick<ChangesCopy, "patchTruncated" | "patchTimedOut" | "unexpectedError"> = EN_US.changes,
    diffRequestTimeoutMs = DEFAULT_DIFF_REQUEST_TIMEOUT_MS,
  ) {
    this.gateway = gateway;
    this.state = createChangesCommitState(initialFileView);
    this.messages = messages;
    this.diffRequestTimeoutMs = Math.max(1, diffRequestTimeoutMs);
  }

  setMessages(messages: Pick<ChangesCopy, "patchTruncated" | "patchTimedOut" | "unexpectedError">): void {
    this.messages = messages;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  installSnapshot(
    snapshot: RepositorySnapshot | null,
    options: SnapshotInstallOptions = {},
  ): void {
    const previousSnapshot = this.snapshot;
    const previousExcludedPaths = new Set(this.state.excludedPaths);
    const previousSelection = this.state.selectedChange
      ? JSON.stringify([this.state.selectedChange.repositoryId || ".", this.state.selectedChange.path])
      : null;
    const previousDiffPath = this.state.workingDiffPath;
    const rootChanged = previousSnapshot?.root !== snapshot?.root;
    const changesChanged = rootChanged || !sameFileChanges(
      previousSnapshot?.changes ?? [],
      snapshot?.changes ?? [],
    );
    const scanStateChanged = previousSnapshot?.untrackedState !== snapshot?.untrackedState;
    this.snapshot = snapshot;
    if (rootChanged) {
      this.repositoryGeneration += 1;
      this.diffSequence += 1;
      this.mutationSequence += 1;
      this.state.mutation = null;
    }
    if (rootChanged || options.clearInclusion) this.state.excludedPaths.clear();
    else if (snapshot) {
      this.state.excludedPaths = reconcileExcludedChangePaths(
        this.state.excludedPaths,
        snapshot.changes,
      );
    }
    if (rootChanged || options.clearDisclosure) this.state.collapsedDirectories.clear();
    if (rootChanged || options.clearSelection) this.state.selectedChange = null;
    this.chooseValidSelection();
    const selectionChanged = previousSelection !== (this.state.selectedChange
      ? JSON.stringify([this.state.selectedChange.repositoryId || ".", this.state.selectedChange.path])
      : null);
    const inclusionChanged = changesChanged ||
      !sameStringSets(previousExcludedPaths, this.state.excludedPaths);
    const retainedDiff = !rootChanged && previousDiffPath !== null &&
      Boolean(snapshot?.changes.some((change) => changeWorkspacePath(change) === previousDiffPath));
    this.diffSequence += 1;
    const diffStateChanged = previousDiffPath !== null && (
      !retainedDiff || this.state.workingPatchLoading || this.state.workingPatchError !== null
    );
    if (!retainedDiff) {
      this.state.workingPatch = null;
      this.state.workingDiffBase = null;
      this.state.workingImageDiff = null;
      this.state.workingDiffPath = null;
    }
    this.state.workingPatchLoading = false;
    this.state.workingPatchError = null;
    const navigationChanged = changesChanged || scanStateChanged;
    if (!navigationChanged && !selectionChanged && !inclusionChanged && !diffStateChanged) return;
    this.emit({
      reason: "snapshot",
      navigationChanged,
      selectionChanged,
      inclusionChanged,
      composerChanged: inclusionChanged,
      diffChanged: diffStateChanged,
    });
  }

  selectedChange(): FileChange | null {
    const selected = this.state.selectedChange;
    return selected && this.snapshot
      ? findFileChange(this.snapshot.changes, selected.repositoryId || ".", selected.path)
      : null;
  }

  includedChanges(): FileChange[] {
    return this.snapshot
      ? includedChanges(this.snapshot.changes, this.state.excludedPaths)
      : [];
  }

  selectChange(path: string, repositoryId = "."): boolean {
    if (!this.snapshot || !findFileChange(this.snapshot.changes, repositoryId, path)) return false;
    const changed = this.state.selectedChange?.path !== path ||
      (this.state.selectedChange.repositoryId || ".") !== repositoryId;
    this.state.selectedChange = { repositoryId, path, staged: false };
    this.clearWorkingDiff(false);
    this.emit({
      reason: "selection",
      selectionChanged: changed,
      navigationChanged: false,
      diffChanged: true,
    });
    return true;
  }

  selectContextChange(path: string, repositoryId = "."): boolean {
    if (!this.snapshot || !findFileChange(this.snapshot.changes, repositoryId, path)) return false;
    const changed = this.state.selectedChange?.path !== path ||
      (this.state.selectedChange.repositoryId || ".") !== repositoryId;
    this.state.selectedChange = { repositoryId, path, staged: false };
    if (changed) {
      this.emit({
        reason: "selection",
        selectionChanged: true,
        navigationChanged: true,
        diffChanged: false,
      });
    }
    return true;
  }

  selectConflict(path: string, repositoryId = "."): boolean {
    if (!this.selectChange(path, repositoryId)) return false;
    const selected = this.selectedChange();
    if (selected) this.state.excludedPaths.delete(fileChangeKey(selected));
    this.emit({ reason: "inclusion", inclusionChanged: true, composerChanged: true });
    return true;
  }

  setPathsIncluded(paths: Iterable<string>, included: boolean): void {
    const known = new Map(
      this.snapshot?.changes.map((change) => [fileChangeKey(change), change]) ?? [],
    );
    let changed = false;
    for (const path of paths) {
      if (!known.has(path)) continue;
      const conflict = known.get(path)?.conflicted === true;
      if (conflict) {
        changed = this.state.excludedPaths.delete(path) || changed;
        continue;
      }
      if (included) changed = this.state.excludedPaths.delete(path) || changed;
      else if (!this.state.excludedPaths.has(path)) {
        this.state.excludedPaths.add(path);
        changed = true;
      }
    }
    if (changed) {
      this.emit({ reason: "inclusion", inclusionChanged: true, composerChanged: true });
    }
  }

  setFileView(view: ChangeFileView): void {
    if (this.state.fileView === view) return;
    this.state.fileView = view;
    this.emit({ reason: "presentation", navigationChanged: true });
  }

  setDirectoryExpanded(key: string, expanded: boolean): void {
    if (expanded) this.state.collapsedDirectories.delete(key);
    else this.state.collapsedDirectories.add(key);
  }

  expandDirectories(): void {
    if (this.state.collapsedDirectories.size === 0) return;
    this.state.collapsedDirectories.clear();
    this.emit({ reason: "presentation", navigationChanged: true });
  }

  collapseDirectories(keys: Iterable<string>): void {
    this.state.collapsedDirectories = new Set(keys);
    this.emit({ reason: "presentation", navigationChanged: true });
  }

  setCommitMessage(message: string): void {
    if (this.state.commitMessage === message) return;
    this.state.commitMessage = message;
    this.emit({ reason: "message", composerChanged: false });
  }

  clearCommitMessage(): void {
    if (!this.state.commitMessage) return;
    this.state.commitMessage = "";
    this.emit({ reason: "message", composerChanged: true });
  }

  hasIncludedStagedChanges(): boolean {
    return this.includedChanges().some(hasStagedChange);
  }

  canStash(keepStagedChanges = false): boolean {
    const snapshot = this.snapshot;
    const selected = this.includedChanges();
    return Boolean(
      snapshot && selected.length > 0 &&
      !selected.some((change) => change.conflicted) &&
      !selected.some((change) => change.submodule) &&
      selectedRepositoryCount(selected) === 1 &&
      (selected[0]?.repositoryId || ".") === "." &&
      (!keepStagedChanges || (
        selected.some(hasStagedChange) && selected.some(hasUnstagedOrUntrackedChange)
      )) &&
      !this.state.mutation,
    );
  }

  canCommit(): boolean {
    const snapshot = this.snapshot;
    const selected = this.includedChanges();
    return Boolean(
      snapshot &&
      this.state.commitMessage.trim() &&
      selected.length > 0 &&
      !selected.some((change) => change.conflicted) &&
      !selected.some((change) => change.submodule) &&
      selectedRepositoryCount(selected) === 1 &&
      !this.state.mutation,
    );
  }

  clearWorkingDiff(emit = true): void {
    this.diffSequence += 1;
    this.state.workingPatch = null;
    this.state.workingDiffBase = null;
    this.state.workingImageDiff = null;
    this.state.workingDiffPath = null;
    this.state.workingPatchLoading = false;
    this.state.workingPatchError = null;
    if (emit) this.emit({ reason: "diff-clear", diffChanged: true });
  }

  async loadSelectedDiff(expandedUnchanged: boolean): Promise<void> {
    const snapshot = this.snapshot;
    const selected = this.selectedChange();
    if (!snapshot || !selected) return;
    const sequence = ++this.diffSequence;
    const generation = this.repositoryGeneration;
    const path = changeWorkspacePath(selected);
    const image = isImagePreviewPath(path);
    const hasExistingDiff = this.state.workingDiffPath === path &&
      ((image && this.state.workingImageDiff !== null) || (!image && this.state.workingPatch !== null));
    this.state.workingDiffPath = path;
    if (image) {
      this.state.workingPatch = null;
      this.state.workingDiffBase = null;
    } else {
      this.state.workingImageDiff = null;
    }
    this.state.workingPatchLoading = true;
    this.state.workingPatchError = null;
    this.emit({ reason: "diff-start", diffChanged: !hasExistingDiff });
    const baseline = image
      ? null
      : settle(withDeadline(
          Promise.resolve().then(() => this.gateway.readWorkingDiffBase(snapshot.root, selected)),
          this.diffRequestTimeoutMs,
          this.messages.patchTimedOut,
        ));
    try {
      const request: Promise<DiffResult | ImageDiffPreview> = image
        ? this.gateway.readLocalImageDiff(snapshot.root, selected)
        : this.gateway.readLocalDiff(snapshot.root, selected, expandedUnchanged);
      const result = await withDeadline(
        request,
        this.diffRequestTimeoutMs,
        this.messages.patchTimedOut,
      );
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      let changed = !hasExistingDiff;
      if (image) {
        const nextImage = result as ImageDiffPreview;
        changed = changed || !imageDiffsEqual(this.state.workingImageDiff, nextImage);
        this.state.workingImageDiff = nextImage;
      } else {
        const nextPatch = result as DiffResult;
        changed = changed || !diffResultsEqual(this.state.workingPatch, nextPatch);
        this.state.workingPatch = nextPatch;
      }
      this.state.workingPatchLoading = false;
      if (changed) {
        this.state.workingPatchVersion += 1;
      }
      this.emit({
        reason: "diff-complete",
        diffChanged: changed,
        warning: !image && this.state.workingPatch?.truncated
          ? this.messages.patchTruncated
          : undefined,
      });
      if (!baseline) return;
      const base = await baseline;
      if (
        base.status !== "fulfilled" ||
        !this.diffRequestMatches(sequence, generation, snapshot.root, path)
      ) return;
      const baseChanged = !workingDiffBasesEqual(this.state.workingDiffBase, base.value);
      this.state.workingDiffBase = base.value;
      if (!baseChanged) return;
      this.state.workingPatchVersion += 1;
      this.emit({ reason: "diff-complete", diffChanged: true });
    } catch (error) {
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      this.state.workingPatchLoading = false;
      this.state.workingPatchError = toErrorMessage(error, this.messages.unexpectedError);
      this.emit({
        reason: "diff-error",
        diffChanged: true,
        error: this.state.workingPatchError,
      });
    }
  }

  async prepareRestoreSelected(): Promise<RestoreChangesPlan | null> {
    const root = this.snapshot?.root;
    const selected = this.selectedChange();
    const generation = this.repositoryGeneration;
    if (!root || !selected || this.state.mutation) return null;
    const plan = await this.gateway.prepareRestoreChanges(root, [selected]);
    return !this.disposed && generation === this.repositoryGeneration &&
      this.snapshot?.root === root &&
      Boolean(this.selectedChange() && sameFileChangeIdentity(this.selectedChange()!, selected))
        ? plan
        : null;
  }

  async revertSelected(plan: RestoreChangesPlan): Promise<ChangesMutationResult<WorkingTreeMutationOutcome>> {
    const snapshot = this.snapshot;
    const selected = this.selectedChange();
    if (!snapshot || !selected || this.state.mutation || plan.root !== snapshot.root ||
      plan.selected.length !== 1 ||
      !sameFileChangeIdentity(plan.selected[0]!, selected)) return { status: "unavailable" };
    const sequence = ++this.mutationSequence;
    const generation = this.repositoryGeneration;
    this.state.mutation = "revert";
    this.emit({ reason: "mutation-start", composerChanged: true });
    try {
      const next = await this.gateway.revertChanges(snapshot.root, plan);
      if (!this.mutationRequestMatches(sequence, generation, snapshot.root, "revert")) {
        return { status: "stale" };
      }
      return { status: "success", value: next };
    } catch (error) {
      if (!this.mutationRequestMatches(sequence, generation, snapshot.root, "revert")) {
        return { status: "stale" };
      }
      return { status: "failure", error };
    } finally {
      if (this.mutationRequestMatches(sequence, generation, snapshot.root, "revert")) {
        this.state.mutation = null;
        this.emit({ reason: "mutation-complete", composerChanged: true });
      }
    }
  }

  async commit(): Promise<ChangesMutationResult<CommitSelectedResult>> {
    const snapshot = this.snapshot;
    const selected = this.includedChanges();
    const message = this.state.commitMessage.trim();
    if (!snapshot || !this.canCommit() || this.state.mutation) {
      return { status: "unavailable" };
    }
    const sequence = ++this.mutationSequence;
    const generation = this.repositoryGeneration;
    this.state.mutation = "commit";
    this.emit({ reason: "mutation-start", composerChanged: true });
    try {
      const result = await this.gateway.commitChanges(snapshot.root, message, selected);
      if (!this.mutationRequestMatches(sequence, generation, snapshot.root, "commit")) {
        return { status: "stale" };
      }
      this.state.commitMessage = "";
      return { status: "success", value: result };
    } catch (error) {
      if (!this.mutationRequestMatches(sequence, generation, snapshot.root, "commit")) {
        return { status: "stale" };
      }
      return { status: "failure", error };
    } finally {
      if (this.mutationRequestMatches(sequence, generation, snapshot.root, "commit")) {
        this.state.mutation = null;
        this.emit({ reason: "mutation-complete", composerChanged: true });
      }
    }
  }

  async stash(keepStagedChanges = false): Promise<ChangesMutationResult<RepositoryMutationOutcome>> {
    const snapshot = this.snapshot;
    const selected = this.includedChanges();
    if (!snapshot || !this.canStash(keepStagedChanges) || this.state.mutation) return { status: "unavailable" };
    const sequence = ++this.mutationSequence;
    const generation = this.repositoryGeneration;
    this.state.mutation = "stash";
    this.emit({ reason: "mutation-start", composerChanged: true });
    try {
      const result = await this.gateway.stashChanges(
        snapshot.root, this.state.commitMessage.trim(), selected, keepStagedChanges,
      );
      if (!this.mutationRequestMatches(sequence, generation, snapshot.root, "stash")) {
        return { status: "stale" };
      }
      this.state.commitMessage = "";
      return { status: "success", value: result };
    } catch (error) {
      if (!this.mutationRequestMatches(sequence, generation, snapshot.root, "stash")) {
        return { status: "stale" };
      }
      return { status: "failure", error };
    } finally {
      if (this.mutationRequestMatches(sequence, generation, snapshot.root, "stash")) {
        this.state.mutation = null;
        this.emit({ reason: "mutation-complete", composerChanged: true });
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.repositoryGeneration += 1;
    this.diffSequence += 1;
    this.mutationSequence += 1;
    this.state.mutation = null;
    this.listeners.clear();
    this.snapshot = null;
  }

  private chooseValidSelection(): void {
    const changes = this.snapshot?.changes ?? [];
    const current = this.state.selectedChange;
    if (current && findFileChange(changes, current.repositoryId || ".", current.path)) {
      this.state.selectedChange = {
        repositoryId: current.repositoryId || ".",
        path: current.path,
        staged: false,
      };
      return;
    }
    this.state.selectedChange = changes[0]
      ? { repositoryId: changes[0].repositoryId || ".", path: changes[0].path, staged: false }
      : null;
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
      this.state.workingDiffPath === path;
  }

  private mutationRequestMatches(
    sequence: number,
    generation: number,
    root: string,
    kind: "revert" | "commit" | "stash",
  ): boolean {
    return !this.disposed &&
      sequence === this.mutationSequence &&
      generation === this.repositoryGeneration &&
      this.snapshot?.root === root &&
      this.state.mutation === kind;
  }

  private emit(change: ChangesCommitChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

export function createChangesCommitState(fileView: ChangeFileView): ChangesCommitState {
  return {
    selectedChange: null,
    workingDiffPath: null,
    excludedPaths: new Set(),
    fileView,
    collapsedDirectories: new Set(),
    commitMessage: "",
    workingPatch: null,
    workingDiffBase: null,
    workingImageDiff: null,
    workingPatchLoading: false,
    workingPatchError: null,
    workingPatchVersion: 0,
    mutation: null,
  };
}

function hasUnstagedOrUntrackedChange(change: FileChange): boolean {
  return change.worktreeStatus !== "unmodified" && change.worktreeStatus !== "ignored";
}

function hasStagedChange(change: FileChange): boolean {
  return change.indexStatus !== "unmodified" && change.indexStatus !== "ignored";
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  );
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let complete = false;
    const timer = globalThis.setTimeout(() => {
      if (complete) return;
      complete = true;
      reject(new Error(message));
    }, timeoutMs);
    void promise.then(
      (value) => {
        if (complete) return;
        complete = true;
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (complete) return;
        complete = true;
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function diffResultsEqual(a: DiffResult | null, b: DiffResult | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.path === b.path &&
    a.staged === b.staged &&
    a.headOid === b.headOid &&
    a.patch === b.patch &&
    a.binary === b.binary &&
    a.truncated === b.truncated;
}

function workingDiffBasesEqual(a: WorkingDiffBase | null, b: WorkingDiffBase | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.path === b.path &&
    a.blobOid === b.blobOid &&
    a.headOid === b.headOid &&
    a.originalPath === b.originalPath &&
    a.content === b.content;
}

function imageDiffsEqual(a: ImageDiffPreview | null, b: ImageDiffPreview | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.path === b.path &&
    a.before?.dataUrl === b.before?.dataUrl &&
    a.before?.byteLength === b.before?.byteLength &&
    a.after?.dataUrl === b.after?.dataUrl &&
    a.after?.byteLength === b.after?.byteLength;
}

function sameFileChanges(left: readonly FileChange[], right: readonly FileChange[]): boolean {
  return left.length === right.length && left.every((change, index) => {
    const next = right[index];
    if (!next) return false;
    return change.repositoryId === next.repositoryId && change.path === next.path &&
      change.workspacePath === next.workspacePath && change.originalPath === next.originalPath &&
      change.indexStatus === next.indexStatus && change.worktreeStatus === next.worktreeStatus &&
      change.conflicted === next.conflicted && change.submodule === next.submodule;
  });
}

function selectedRepositoryCount(changes: readonly FileChange[]): number {
  return new Set(changes.map((change) => change.repositoryId || ".")).size;
}

function sameStringSets(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && Array.from(left).every((value) => right.has(value));
}
