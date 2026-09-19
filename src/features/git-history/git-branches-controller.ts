import type { BranchSummary, RepositorySnapshot } from "../../models.ts";
import { branchKey } from "../../workbench/history-identity.ts";
import { matchingLogicalBranches } from "../../presentation/git-presentation.ts";

export interface GitBranchesState {
  query: string;
  collapsedGroups: Set<BranchSummary["kind"]>;
  selectedBranch: string | null;
  newBranchName: string;
}

export type BranchHistoryScopeIntent =
  | { readonly kind: "clear" }
  | { readonly kind: "select"; readonly branches: readonly BranchSummary[] };

export type BranchMutationActivation = "accepted" | "blocked" | "stale";

export interface BranchMutationContext {
  readonly snapshot: RepositorySnapshot;
  readonly loading: boolean;
  readonly safe: boolean;
}

export interface GitBranchesActions {
  current(): BranchMutationContext | null;
  checkout(branch: BranchSummary): Promise<void>;
  create(name: string): Promise<void>;
}

export class GitBranchesController {
  readonly state: GitBranchesState = {
    query: "",
    collapsedGroups: new Set(),
    selectedBranch: null,
    newBranchName: "",
  };
  private readonly actions: GitBranchesActions;

  constructor(actions: GitBranchesActions) {
    this.actions = actions;
  }

  setQuery(query: string): void {
    this.state.query = query;
  }

  toggleGroup(kind: BranchSummary["kind"]): boolean {
    if (this.state.collapsedGroups.has(kind)) {
      this.state.collapsedGroups.delete(kind);
      return false;
    }
    this.state.collapsedGroups.add(kind);
    return true;
  }

  setNewBranchName(name: string): void {
    this.state.newBranchName = name;
  }

  setSelectedBranch(key: string | null): void {
    this.state.selectedBranch = key;
  }

  selected(snapshot: RepositorySnapshot): BranchSummary | null {
    const selected = this.state.selectedBranch;
    return selected
      ? snapshot.branches.find((branch) => branchKey(branch) === selected) ?? null
      : null;
  }

  reconcile(snapshot: RepositorySnapshot): boolean {
    if (!this.state.selectedBranch || this.selected(snapshot)) return false;
    this.state.selectedBranch = null;
    return true;
  }

  toggleHistoryScope(
    snapshot: RepositorySnapshot,
    key: string,
    selectedRefs: ReadonlyMap<string, unknown>,
  ): BranchHistoryScopeIntent | null {
    const branches = this.resolveHistoryScope(snapshot, key);
    if (!branches) return null;
    const selectedExclusively = branches.length === selectedRefs.size &&
      branches.every((candidate) => selectedRefs.has(branchKey(candidate)));
    if (selectedExclusively) {
      this.state.selectedBranch = null;
      return { kind: "clear" };
    }
    this.state.selectedBranch = branches.length === 1 ? branchKey(branches[0]!) : null;
    return { kind: "select", branches };
  }

  selectHistoryScope(
    snapshot: RepositorySnapshot,
    key: string,
  ): readonly BranchSummary[] | null {
    const branches = this.resolveHistoryScope(snapshot, key);
    if (!branches) return null;
    this.state.selectedBranch = branches.length === 1 ? branchKey(branches[0]!) : null;
    return branches;
  }

  async checkout(key: string): Promise<BranchMutationActivation> {
    const context = this.actions.current();
    if (!context) return "stale";
    const branch = context.snapshot.branches.find((candidate) => branchKey(candidate) === key);
    if (
      !branch ||
      branch.repositoryId !== "." ||
      branch.kind !== "local" ||
      branch.current ||
      context.loading ||
      !context.safe
    ) return "blocked";
    await this.actions.checkout(branch);
    return "accepted";
  }

  async create(): Promise<BranchMutationActivation> {
    const context = this.actions.current();
    if (!context) return "stale";
    const name = this.state.newBranchName.trim();
    if (!name || context.loading || !context.safe) return "blocked";
    await this.actions.create(name);
    const current = this.actions.current();
    if (current?.snapshot.branch.head === name) this.state.newBranchName = "";
    return "accepted";
  }

  private resolveHistoryScope(
    snapshot: RepositorySnapshot,
    key: string,
  ): readonly BranchSummary[] | null {
    const branch = snapshot.branches.find((candidate) => branchKey(candidate) === key);
    if (!branch) return null;
    return matchingLogicalBranches(
      snapshot.branches,
      branch,
      new Set(snapshot.repositoryRoots.map((root) => root.id)),
    );
  }
}
