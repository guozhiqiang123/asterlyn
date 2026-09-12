import type {
  ChangeSelection,
  CommitSelectedResult,
  DiffResult,
  FileChange,
  ImageDiffPreview,
  RepositorySnapshot,
  WorkingTreeMutationOutcome,
} from "../../models.ts";
import {
  includedChanges,
  reconcileExcludedChangePaths,
  type ChangeFileView,
} from "../../workbench/change-presentation.ts";
import { isImagePreviewPath } from "../../workbench/image-preview.ts";

export interface ChangesCommitState {
  selectedChange: ChangeSelection | null;
  excludedPaths: Set<string>;
  fileView: ChangeFileView;
  collapsedDirectories: Set<string>;
  commitMessage: string;
  workingPatch: DiffResult | null;
  workingImageDiff: ImageDiffPreview | null;
  workingPatchLoading: boolean;
  workingPatchError: string | null;
  workingPatchVersion: number;
  mutation: "revert" | "commit" | null;
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
  revertChanges(
    repositoryRoot: string,
    changes: FileChange[],
  ): Promise<WorkingTreeMutationOutcome>;
  commitChanges(
    repositoryRoot: string,
    message: string,
    changes: FileChange[],
  ): Promise<CommitSelectedResult>;
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

export class ChangesCommitController {
  readonly state: ChangesCommitState;

  private readonly gateway: ChangesCommitGateway;
  private readonly listeners = new Set<Listener>();
  private snapshot: RepositorySnapshot | null = null;
  private repositoryGeneration = 0;
  private diffSequence = 0;
  private mutationSequence = 0;
  private disposed = false;

  constructor(gateway: ChangesCommitGateway, initialFileView: ChangeFileView = "tree") {
    this.gateway = gateway;
    this.state = createChangesCommitState(initialFileView);
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
    const rootChanged = this.snapshot?.root !== snapshot?.root;
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
    this.clearWorkingDiff(false);
    this.emit({
      reason: "snapshot",
      navigationChanged: true,
      selectionChanged: true,
      inclusionChanged: true,
      composerChanged: true,
      diffChanged: true,
    });
  }

  selectedChange(): FileChange | null {
    const path = this.state.selectedChange?.path;
    return path
      ? this.snapshot?.changes.find((change) => change.path === path) ?? null
      : null;
  }

  includedChanges(): FileChange[] {
    return this.snapshot
      ? includedChanges(this.snapshot.changes, this.state.excludedPaths)
      : [];
  }

  selectChange(path: string): boolean {
    if (!this.snapshot?.changes.some((change) => change.path === path)) return false;
    const changed = this.state.selectedChange?.path !== path;
    this.state.selectedChange = { path, staged: false };
    this.clearWorkingDiff(false);
    this.emit({
      reason: "selection",
      selectionChanged: changed,
      navigationChanged: false,
      diffChanged: true,
    });
    return true;
  }

  selectConflict(path: string): boolean {
    if (!this.selectChange(path)) return false;
    this.state.excludedPaths.delete(path);
    this.emit({ reason: "inclusion", inclusionChanged: true, composerChanged: true });
    return true;
  }

  setPathsIncluded(paths: Iterable<string>, included: boolean): void {
    const known = new Set(this.snapshot?.changes.map((change) => change.path) ?? []);
    let changed = false;
    for (const path of paths) {
      if (!known.has(path)) continue;
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

  canCommit(): boolean {
    const snapshot = this.snapshot;
    const selected = this.includedChanges();
    return Boolean(
      snapshot &&
      this.state.commitMessage.trim() &&
      selected.length > 0 &&
      !snapshot.changes.some((change) => change.conflicted) &&
      !selected.some((change) => change.submodule) &&
      !this.state.mutation,
    );
  }

  clearWorkingDiff(emit = true): void {
    this.diffSequence += 1;
    this.state.workingPatch = null;
    this.state.workingImageDiff = null;
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
    const path = selected.path;
    const image = isImagePreviewPath(path);
    this.state.workingPatch = null;
    this.state.workingImageDiff = null;
    this.state.workingPatchLoading = true;
    this.state.workingPatchError = null;
    this.emit({ reason: "diff-start", diffChanged: true });
    try {
      const result = image
        ? await this.gateway.readLocalImageDiff(snapshot.root, selected)
        : await this.gateway.readLocalDiff(snapshot.root, selected, expandedUnchanged);
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      if (image) this.state.workingImageDiff = result as ImageDiffPreview;
      else this.state.workingPatch = result as DiffResult;
      this.state.workingPatchLoading = false;
      this.state.workingPatchVersion = sequence;
      this.emit({
        reason: "diff-complete",
        diffChanged: true,
        warning: !image && (result as DiffResult).truncated
          ? "Patch truncated at 4 MiB"
          : undefined,
      });
    } catch (error) {
      if (!this.diffRequestMatches(sequence, generation, snapshot.root, path)) return;
      this.state.workingPatchLoading = false;
      this.state.workingPatchError = toErrorMessage(error);
      this.emit({
        reason: "diff-error",
        diffChanged: true,
        error: this.state.workingPatchError,
      });
    }
  }

  async revertSelected(): Promise<ChangesMutationResult<WorkingTreeMutationOutcome>> {
    const snapshot = this.snapshot;
    const selected = this.selectedChange();
    if (!snapshot || !selected || this.state.mutation) return { status: "unavailable" };
    const sequence = ++this.mutationSequence;
    const generation = this.repositoryGeneration;
    this.state.mutation = "revert";
    this.emit({ reason: "mutation-start", composerChanged: true });
    try {
      const next = await this.gateway.revertChanges(snapshot.root, [selected]);
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
    if (current && changes.some((change) => change.path === current.path)) {
      this.state.selectedChange = { path: current.path, staged: false };
      return;
    }
    this.state.selectedChange = changes[0]
      ? { path: changes[0].path, staged: false }
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
      this.state.selectedChange?.path === path;
  }

  private mutationRequestMatches(
    sequence: number,
    generation: number,
    root: string,
    kind: "revert" | "commit",
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
    excludedPaths: new Set(),
    fileView,
    collapsedDirectories: new Set(),
    commitMessage: "",
    workingPatch: null,
    workingImageDiff: null,
    workingPatchLoading: false,
    workingPatchError: null,
    workingPatchVersion: 0,
    mutation: null,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unexpected Changes operation error";
}
