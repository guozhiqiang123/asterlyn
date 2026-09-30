import type {
  BranchSummary,
  WorktreeCreationPlan,
  WorktreeCreationRequest,
} from "../../models.ts";
import type { DirectoryChoice } from "../../protocol/desktop-bridge.ts";

export interface WorktreeCreationDialog {
  readonly repositoryRoot: string;
  readonly branches: readonly BranchSummary[];
  sourceFullName: string;
  sourceOid: string;
  newBranchEnabled: boolean;
  newBranch: string;
  projectName: string;
  parentDirectory: string;
  busy: boolean;
  error: string | null;
}

export interface WorktreeCreationState {
  readonly dialog: WorktreeCreationDialog | null;
}

export interface WorktreeCreationGateway {
  chooseDirectory(defaultPath: string | null): Promise<DirectoryChoice>;
  prepare(repositoryRoot: string, request: WorktreeCreationRequest): Promise<WorktreeCreationPlan>;
  execute(plan: WorktreeCreationPlan): Promise<boolean>;
  errorMessage(error: unknown): string;
}

type Listener = () => void;
const DEFAULT_PROJECT_NAME_LIMIT = 64;

export class WorktreeCreationController {
  private readonly gateway: WorktreeCreationGateway;
  private value: WorktreeCreationState = { dialog: null };
  private readonly listeners = new Set<Listener>();
  private disposed = false;

  constructor(gateway: WorktreeCreationGateway) {
    this.gateway = gateway;
  }

  get state(): WorktreeCreationState { return this.value; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(repositoryRoot: string, branches: readonly BranchSummary[], source: BranchSummary): void {
    const local = branches.filter((branch) => branch.repositoryId === "." && branch.kind === "local");
    if (!local.some((branch) => branch.fullName === source.fullName && branch.oid === source.oid)) return;
    this.value = { dialog: {
      repositoryRoot,
      branches: local.map((branch) => ({ ...branch })),
      sourceFullName: source.fullName,
      sourceOid: source.oid,
      newBranchEnabled: false,
      newBranch: "",
      projectName: suggestedProjectName(repositoryRoot, source.name, local),
      parentDirectory: parentPath(repositoryRoot),
      busy: false,
      error: null,
    } };
    this.emit();
  }

  updateSource(fullName: string): void {
    const dialog = this.editable();
    const source = dialog?.branches.find((branch) => branch.fullName === fullName);
    if (!dialog || !source) return;
    dialog.sourceFullName = source.fullName;
    dialog.sourceOid = source.oid;
    dialog.projectName = suggestedProjectName(dialog.repositoryRoot, source.name, dialog.branches);
    dialog.error = null;
    this.emit();
  }

  updateNewBranchEnabled(enabled: boolean): void {
    const dialog = this.editable();
    if (!dialog) return;
    dialog.newBranchEnabled = enabled;
    dialog.error = null;
    this.emit();
  }

  updateNewBranch(value: string): void { this.update("newBranch", value); }
  updateProjectName(value: string): void { this.update("projectName", value); }
  updateParentDirectory(value: string): void { this.update("parentDirectory", value); }

  async chooseDirectory(): Promise<void> {
    const dialog = this.editable();
    if (!dialog) return;
    dialog.busy = true;
    dialog.error = null;
    this.emit();
    try {
      const choice = await this.gateway.chooseDirectory(dialog.parentDirectory || null);
      if (this.value.dialog !== dialog) return;
      if (choice.kind === "selected") dialog.parentDirectory = choice.path;
      else if (choice.kind === "unsupported") dialog.error = "chooser-unavailable";
    } catch (error) {
      if (this.value.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.value.dialog === dialog) dialog.busy = false;
      this.emit();
    }
  }

  async submit(): Promise<void> {
    const dialog = this.editable();
    if (!dialog) return;
    if (!dialog.sourceFullName || !dialog.sourceOid) return this.fail(dialog, "source-required");
    if (!dialog.projectName.trim()) return this.fail(dialog, "project-name-required");
    if (!dialog.parentDirectory.trim()) return this.fail(dialog, "location-required");
    if (dialog.newBranchEnabled && !dialog.newBranch.trim()) {
      return this.fail(dialog, "branch-name-required");
    }
    dialog.busy = true;
    dialog.error = null;
    this.emit();
    try {
      const plan = await this.gateway.prepare(dialog.repositoryRoot, {
        sourceFullName: dialog.sourceFullName,
        sourceOid: dialog.sourceOid,
        parentDirectory: dialog.parentDirectory.trim(),
        projectName: dialog.projectName.trim(),
        newBranch: dialog.newBranchEnabled ? dialog.newBranch.trim() : null,
      });
      if (this.value.dialog !== dialog) return;
      if (await this.gateway.execute(plan) && this.value.dialog === dialog) {
        this.value = { dialog: null };
      } else if (this.value.dialog === dialog) {
        dialog.error = "creation-failed";
      }
    } catch (error) {
      if (this.value.dialog === dialog) dialog.error = this.gateway.errorMessage(error);
    } finally {
      if (this.value.dialog === dialog) dialog.busy = false;
      this.emit();
    }
  }

  close(): boolean {
    const dialog = this.value.dialog;
    if (!dialog || dialog.busy) return false;
    this.value = { dialog: null };
    this.emit();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.value = { dialog: null };
  }

  private editable(): WorktreeCreationDialog | null {
    const dialog = this.value.dialog;
    return dialog && !dialog.busy ? dialog : null;
  }

  private update(field: "newBranch" | "projectName" | "parentDirectory", value: string): void {
    const dialog = this.editable();
    if (!dialog) return;
    dialog[field] = value;
    dialog.error = null;
  }

  private fail(dialog: WorktreeCreationDialog, error: string): void {
    dialog.error = error;
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}

export function worktreeDestination(parent: string, projectName: string): string {
  const trimmed = parent.replace(/[\\/]+$/u, "");
  if (!trimmed || !projectName.trim()) return trimmed;
  const separator = trimmed.includes("\\") && !trimmed.includes("/") ? "\\" : "/";
  return `${trimmed}${separator}${projectName.trim()}`;
}

function suggestedProjectName(
  root: string,
  branch: string,
  branches: readonly BranchSummary[],
): string {
  const primaryRoot = branches.find((candidate) =>
    candidate.repositoryId === "." && candidate.primaryWorktreePath
  )?.primaryWorktreePath ?? root;
  const repository = primaryRoot.replace(/[\\/]+$/u, "").split(/[\\/]/u).at(-1) || "project";
  const leaf = branch.split("/").at(-1) || "worktree";
  const candidate = `${repository}-${leaf}`;
  if (codePointLength(candidate) <= DEFAULT_PROJECT_NAME_LIMIT) return candidate;

  const branchReserve = Math.min(40, codePointLength(leaf));
  const repositoryPart = takeCodePoints(
    repository,
    Math.max(1, DEFAULT_PROJECT_NAME_LIMIT - branchReserve - 1),
  );
  const branchPart = takeCodePoints(
    leaf,
    Math.max(1, DEFAULT_PROJECT_NAME_LIMIT - codePointLength(repositoryPart) - 1),
  );
  return `${repositoryPart}-${branchPart}`;
}

function codePointLength(value: string): number { return Array.from(value).length; }

function takeCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index > 0 ? trimmed.slice(0, index) : trimmed;
}
