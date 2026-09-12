import { icon } from "../../icons.ts";
import type { BranchSummary, RepositorySnapshot } from "../../models.ts";
import {
  branchKey,
} from "../../workbench/history-identity.ts";
import { effectiveHistoryRootIds } from "../../workbench/history-root-selection.ts";
import {
  groupRemoteBranches,
  matchingLogicalBranches,
  uniqueLogicalBranches,
} from "../../workbench/git-presentation.ts";

export interface BranchNavigationViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly query: string;
  readonly selectedRepositoryIds: ReadonlySet<string>;
  readonly selectedRefs: ReadonlyMap<string, unknown>;
  readonly collapsedGroups: ReadonlySet<BranchSummary["kind"]>;
}

export function renderBranchNavigation(model: BranchNavigationViewModel): string {
  if (model.snapshot.branches.length === 0) {
    return emptyState("No refs", "Branches and tags will appear here.");
  }
  return `<div class="branch-navigation"><label class="branch-filter" for="branch-filter">${icon("search", 14)}<input id="branch-filter" type="search" value="${escapeAttribute(model.query)}" placeholder="Branch or tag" autocomplete="off" spellcheck="false" aria-label="Filter branches and tags" /><span class="compact-count" id="branch-count">0</span></label><div class="branch-results" id="branch-results">${renderBranchGroups(model)}</div></div>`;
}

export function renderBranchGroups(model: BranchNavigationViewModel): string {
  const visible = filteredBranches(model);
  if (visible.length === 0) {
    return '<div class="branch-no-results"><strong>No matching refs</strong><span>Try another branch, remote, or tag name.</span></div>';
  }
  const groups: Array<[string, BranchSummary["kind"]]> = [
    ["Local", "local"],
    ["Remote", "remote"],
    ["Tags", "tag"],
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

function renderRemoteBranches(
  branches: BranchSummary[],
  model: BranchNavigationViewModel,
): string {
  return groupRemoteBranches(branches).map((group) => `<section class="remote-ref-group"><div class="remote-root-row">${icon("chevron", 11)}${icon("folder", 14)}<span>${escapeHtml(group.name)}</span><small>${group.branches.length}</small></div><div role="group">${group.branches.map(({ branch, displayName }) => branchRow(branch, model, displayName, true)).join("")}</div></section>`).join("");
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
  const selected = activeMatches.length > 0 && activeMatches.every((candidate) =>
    model.selectedRefs.has(branchKey(candidate)),
  );
  const exclusive = allMatches.length === model.selectedRefs.size &&
    allMatches.every((candidate) => model.selectedRefs.has(branchKey(candidate)));
  const iconName = branch.current ? "head" : branch.kind === "tag" ? "tag" : "branch";
  const title = exclusive
    ? `${branch.name} — ${branch.subject} — Activate again to show all refs`
    : `${branch.name} — ${branch.subject}`;
  const root = model.snapshot.repositoryRoots.find((item) => item.id === branch.repositoryId);
  const meta = [
    branch.current ? "HEAD" : "",
    activeMatches.length > 1
      ? `${activeMatches.length} roots`
      : model.snapshot.repositoryRoots.length > 1
        ? (root?.displayName ?? branch.repositoryId)
        : "",
  ].filter(Boolean);
  return `<button class="branch-row kind-${branch.kind} ${nested ? "nested" : ""} ${selected ? "selected" : ""}" type="button" data-branch="${escapeAttribute(branch.fullName)}" data-branch-key="${escapeAttribute(key)}" aria-pressed="${selected}" title="${escapeAttribute(title)}"><span class="branch-glyph ${branch.current ? "current" : ""}">${icon(iconName, 14)}</span><span class="branch-name">${escapeHtml(displayName)}</span>${meta.length > 0 ? `<span class="branch-row-meta">${meta.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</span>` : ""}</button>`;
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
