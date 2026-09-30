import { icon } from "../../icons.ts";
import { DEFAULT_LOCALIZATION, type Localization } from "../../localization/localization.ts";
import type { BranchSummary, RepositorySnapshot } from "../../models.ts";
import {
  branchKey,
} from "./history-identity.ts";
import { effectiveHistoryRootIds } from "./history-root-selection.ts";
import {
  groupRemoteBranches,
  matchingLogicalBranches,
  uniqueLogicalBranches,
} from "../../presentation/git-presentation.ts";

export interface BranchNavigationViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly query: string;
  readonly selectedRepositoryIds: ReadonlySet<string>;
  readonly selectedRefs: ReadonlyMap<string, unknown>;
  readonly collapsedGroups: ReadonlySet<BranchSummary["kind"]>;
  readonly collapsedRemoteGroups: ReadonlySet<string>;
  readonly localization?: Localization;
}

export function renderBranchNavigation(model: BranchNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  if (model.snapshot.branches.length === 0) {
    return emptyState(copy.noRefs, copy.refsAppearHere);
  }
  return `<div class="branch-navigation"><label class="branch-filter" for="branch-filter">${icon("search", 14)}<input id="branch-filter" type="search" value="${escapeAttribute(model.query)}" placeholder="${escapeAttribute(copy.branchOrTag)}" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(copy.filterBranchesAndTags)}" /><span class="compact-count" id="branch-count">0</span></label><div class="branch-results" id="branch-results">${renderBranchGroups(model)}</div></div>`;
}

export function renderBranchGroups(model: BranchNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const visible = filteredBranches(model);
  if (visible.length === 0) {
    return `<div class="branch-no-results"><strong>${escapeHtml(copy.noMatchingRefs)}</strong><span>${escapeHtml(copy.tryAnotherRef)}</span></div>`;
  }
  const groups: Array<[string, BranchSummary["kind"]]> = [
    [copy.groups.local, "local"],
    [copy.groups.remote, "remote"],
    [copy.groups.tag, "tag"],
  ];
  return groups.map(([label, kind]) => {
    const branches = visible.filter((branch) => branch.kind === kind);
    if (branches.length === 0) return "";
    const collapsed = model.collapsedGroups.has(kind);
    const groupId = `branch-group-${kind}`;
    const rows = kind === "remote"
      ? renderRemoteBranches(branches, model)
      : branches.map((branch) => branchRow(branch, model)).join("");
    return `<section class="branch-group"><button class="group-header branch-group-toggle" type="button" data-branch-group-toggle="${kind}" aria-expanded="${!collapsed}" aria-controls="${groupId}"><span><span class="branch-group-chevron">${icon("chevron", 12)}</span>${label}<b>${branches.length}</b></span></button><div id="${groupId}" role="group" ${collapsed ? "hidden" : ""}>${rows}</div></section>`;
  }).join("");
}

export function activeBranches(model: BranchNavigationViewModel): BranchSummary[] {
  const rootIds = effectiveHistoryRootIds(
    model.snapshot.repositoryRoots.map((root) => root.id),
    model.selectedRepositoryIds,
  );
  return model.snapshot.branches.filter((branch) => rootIds.has(branch.repositoryId));
}

export function logicalBranches(model: BranchNavigationViewModel): BranchSummary[] {
  return uniqueLogicalBranches(activeBranches(model));
}

export function filteredBranches(model: BranchNavigationViewModel): BranchSummary[] {
  const query = model.query.trim().toLocaleLowerCase();
  if (!query) return logicalBranches(model);
  return uniqueLogicalBranches(activeBranches(model).filter((branch) =>
    [branch.name, branch.fullName, branch.subject].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  ));
}

export function matchingBranches(
  branch: BranchSummary,
  model: BranchNavigationViewModel,
  allRoots = false,
): BranchSummary[] {
  const selectedRootIds = allRoots
    ? new Set(model.snapshot.repositoryRoots.map((root) => root.id))
    : effectiveHistoryRootIds(
        model.snapshot.repositoryRoots.map((root) => root.id),
        model.selectedRepositoryIds,
      );
  return matchingLogicalBranches(model.snapshot.branches, branch, selectedRootIds);
}

export function branchIsSelected(
  branch: BranchSummary,
  model: BranchNavigationViewModel,
): boolean {
  const activeMatches = matchingBranches(branch, model);
  return activeMatches.length > 0 && activeMatches.every((candidate) =>
    model.selectedRefs.has(branchKey(candidate))
  );
}

export function updateBranchSelection(
  root: ParentNode,
  model: BranchNavigationViewModel,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-branch-key]").forEach((row) => {
    const key = row.dataset.branchKey;
    const branch = key
      ? model.snapshot.branches.find((candidate) => branchKey(candidate) === key)
      : null;
    const selected = Boolean(branch && branchIsSelected(branch, model));
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-pressed", String(selected));
  });
}

function renderRemoteBranches(
  branches: BranchSummary[],
  model: BranchNavigationViewModel,
): string {
  return groupRemoteBranches(branches).map((group) => {
    const collapsed = model.collapsedRemoteGroups.has(group.name);
    return `<section class="remote-ref-group"><button class="remote-root-row" type="button" data-remote-group-toggle="${escapeAttribute(group.name)}" aria-expanded="${!collapsed}">${icon("chevron", 11)}${icon("folder", 14)}<span>${escapeHtml(group.name)}</span><small>${group.branches.length}</small></button><div role="group" ${collapsed ? "hidden" : ""}>${group.branches.map(({ branch, displayName }) => branchRow(branch, model, displayName, true)).join("")}</div></section>`;
  }).join("");
}

function branchRow(
  branch: BranchSummary,
  model: BranchNavigationViewModel,
  displayName = branch.name,
  nested = false,
): string {
  const key = branchKey(branch);
  const activeMatches = matchingBranches(branch, model);
  const allMatches = matchingBranches(branch, model, true);
  const selected = branchIsSelected(branch, model);
  const historyCopy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const exclusive = allMatches.length === model.selectedRefs.size &&
    allMatches.every((candidate) => model.selectedRefs.has(branchKey(candidate)));
  const iconName = branch.current ? "head" : branch.kind === "tag" ? "tag" : "branch";
  const checkoutTitle = branch.kind !== "local"
    ? []
    : [
        branch.primaryWorktreePath ? `${historyCopy.primaryWorktreeBadge}: ${branch.primaryWorktreePath}` : "",
        branch.linkedWorktreePath ? `${historyCopy.worktreeBadge}: ${branch.linkedWorktreePath}` : "",
        !branch.primaryWorktreePath && !branch.linkedWorktreePath ? historyCopy.availableBranchBadge : "",
      ].filter(Boolean);
  const title = [
    `${branch.name} — ${branch.subject}`,
    exclusive ? historyCopy.activateAgainForAllRefs : "",
    ...checkoutTitle,
  ].filter(Boolean).join(" — ");
  const root = model.snapshot.repositoryRoots.find((item) => item.id === branch.repositoryId);
  const meta = [
    branch.current ? "HEAD" : "",
    activeMatches.length > 1
      ? (model.localization ?? DEFAULT_LOCALIZATION).catalog.history.roots(activeMatches.length)
      : model.snapshot.repositoryRoots.length > 1
        ? (root?.displayName ?? branch.repositoryId)
        : "",
  ].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`);
  if (branch.primaryWorktreePath) {
    meta.push(`<span class="branch-primary-worktree-badge">${escapeHtml(historyCopy.primaryWorktreeBadge)}</span>`);
  }
  if (branch.linkedWorktreePath) {
    meta.push(`<span class="branch-worktree-badge">${escapeHtml(historyCopy.worktreeBadge)}</span>`);
  } else if (branch.kind === "local" && !branch.primaryWorktreePath) {
    meta.push(`<span class="branch-available-badge">${escapeHtml(historyCopy.availableBranchBadge)}</span>`);
  }
  return `<button class="branch-row kind-${branch.kind} ${branch.primaryWorktreePath ? "has-primary-worktree" : ""} ${branch.linkedWorktreePath ? "has-linked-worktree" : ""} ${nested ? "nested" : ""} ${selected ? "selected" : ""}" type="button" data-branch="${escapeAttribute(branch.fullName)}" data-branch-key="${escapeAttribute(key)}" aria-pressed="${selected}" title="${escapeAttribute(title)}"><span class="branch-glyph ${branch.current ? "current" : ""}">${icon(iconName, 14)}</span><span class="branch-name">${escapeHtml(displayName)}</span>${meta.length > 0 ? `<span class="branch-row-meta">${meta.join("")}</span>` : ""}</button>`;
}

function emptyState(title: string, detail: string): string {
  return `<div class="empty-state compact"><span class="empty-icon">${icon("branch", 18)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
