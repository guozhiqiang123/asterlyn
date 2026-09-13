import { icon } from "../../icons.ts";
import { DEFAULT_LOCALIZATION, type Localization } from "../../localization/localization.ts";
import type {
  BranchSummary,
  HistoryPath,
  HistoryQuery,
  HistoryRef,
  ProjectFile,
  RepositorySnapshot,
} from "../../models.ts";
import {
  groupRemoteBranches,
  uniqueLogicalBranches,
} from "../../workbench/git-presentation.ts";
import {
  branchKey,
  historyPathKey,
  historyRefKey,
} from "../../workbench/history-identity.ts";
import {
  historyAuthorChoices,
  type HistoryDatePreset,
} from "../../workbench/history-query.ts";
import {
  historyPathCandidates,
  historyPathWorkspaceLabel,
} from "../../workbench/history-path-selection.ts";
import { effectiveHistoryRootIds } from "../../workbench/history-root-selection.ts";
import { matchingBranches, type BranchNavigationViewModel } from "./branch-navigation-view.ts";
import { renderHistoryList, type HistoryListPresentation } from "./history-list-view.ts";

export type HistoryFilterMenu = "branch" | "user" | "date" | "paths" | "graph";

export interface HistoryNavigationViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly files: ProjectFile[];
  readonly filesLoading: boolean;
  readonly filesError: unknown;
  readonly filesTruncated: boolean;
  readonly presentation: HistoryListPresentation;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly regularExpression: boolean;
  readonly refs: ReadonlyMap<string, HistoryRef>;
  readonly authorEmails: ReadonlySet<string>;
  readonly currentAuthor: boolean;
  readonly datePreset: HistoryDatePreset;
  readonly paths: ReadonlyMap<string, HistoryPath>;
  readonly repositoryIds: ReadonlySet<string>;
  readonly recentPaths: readonly HistoryPath[];
  readonly order: HistoryQuery["order"];
  readonly firstParent: boolean;
  readonly excludeMerges: boolean;
  readonly collapseLinear: boolean;
  readonly filterMenu: HistoryFilterMenu | null;
  readonly branchSubmenu: string | null;
  readonly favoriteRefs: ReadonlyMap<string, HistoryRef>;
  readonly recentRefs: readonly HistoryRef[];
  readonly localization?: Localization;
}

export interface HistoryScopePresentation {
  readonly icon: "head" | "branch" | "tag";
  readonly label: string;
  readonly title: string;
}

export function renderHistoryNavigation(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const scope = historyScope(model);
  return `<div class="history-navigation"><div class="history-toolbar"><div class="history-search-control"><label class="history-filter" for="history-filter">${icon("search", 14)}<input id="history-filter" type="search" value="${escapeAttribute(model.query)}" placeholder="${escapeAttribute(copy.textOrHash)}" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(copy.filterCommitHistory)}" aria-keyshortcuts="Control+F Meta+F" /></label><button class="history-mode-button ${model.regularExpression ? "active" : ""}" type="button" data-history-text-mode="regex" aria-pressed="${model.regularExpression}" title="${escapeAttribute(copy.useRegularExpression)}">.*</button><button class="history-mode-button ${model.caseSensitive ? "active" : ""}" type="button" data-history-text-mode="case" aria-pressed="${model.caseSensitive}" title="${escapeAttribute(copy.matchCase)}">Cc</button></div><div class="history-filter-strip" aria-label="${escapeAttribute(copy.queryFilters)}">${historyFilterButton(model, "branch", scope.label, model.refs.size > 0, scope.title)}${historyFilterButton(model, "user", historyUserLabel(model), model.currentAuthor || model.authorEmails.size > 0, copy.filterByAuthor)}${historyFilterButton(model, "date", historyDateLabel(model), model.datePreset !== "all", copy.filterByDate)}${historyFilterButton(model, "paths", historyPathLabel(model), model.paths.size > 0 || model.repositoryIds.size > 0, copy.filterByPathsOrRoots)}${historyFilterButton(model, "graph", "", model.order !== "topological" || model.firstParent || model.excludeMerges, copy.graphOptions, "sort")}</div><span class="compact-count" id="history-count">0</span><span class="history-refresh-status" id="history-refresh-status" role="status"></span>${renderHistoryFilterPopover(model)}</div><div class="history-results" id="history-results" aria-live="polite">${renderHistoryList(model.presentation)}</div></div>`;
}

export function historyScope(model: HistoryNavigationViewModel): HistoryScopePresentation {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  let refs = Array.from(model.refs.values());
  if (refs.length === 0) {
    return { icon: "branch", label: copy.allRefs, title: copy.allRefsTitle };
  }
  const selectedRootIds = effectiveHistoryRootIds(
    model.snapshot.repositoryRoots.map((root) => root.id),
    model.repositoryIds,
  );
  const activeRefs = refs.filter((reference) => selectedRootIds.has(reference.repositoryId));
  if (activeRefs.length > 0) refs = activeRefs;
  const fullNames = new Set(refs.map((reference) => reference.fullName));
  if (fullNames.size === 1) {
    const reference = refs[0]!;
    const branch = model.snapshot.branches.find((candidate) => branchKey(candidate) === historyRefKey(reference));
    return {
      icon: branch?.kind === "tag" ? "tag" : "branch",
      label: branch?.name ?? reference.fullName,
      title: refs.length === 1 ? `${reference.fullName} — ${reference.repositoryId}` : `${reference.fullName} — ${copy.roots(refs.length)}`,
    };
  }
  return {
    icon: "branch",
    label: copy.branchCount(refs.length),
    title: refs.map((reference) => `${reference.fullName} — ${reference.repositoryId}`).join(", "),
  };
}

function historyFilterButton(
  model: HistoryNavigationViewModel,
  menu: HistoryFilterMenu,
  label: string,
  active: boolean,
  title: string,
  iconName?: "sort",
): string {
  const open = model.filterMenu === menu;
  const menuIcon = iconName ?? (menu === "branch" ? "branch" : menu === "user" ? "user" : menu === "date" ? "calendar" : "folder");
  return `<button class="history-filter-button ${active ? "active" : ""} ${open ? "open" : ""}" type="button" data-history-menu="${menu}" aria-expanded="${open}" aria-label="${escapeAttribute(title)}" title="${escapeAttribute(title)}">${icon(menuIcon, 13)}${iconName ? "" : `<span>${escapeHtml(label)}</span><span class="history-filter-chevron">${icon("chevron-down", 10)}</span>`}</button>`;
}

function renderHistoryFilterPopover(model: HistoryNavigationViewModel): string {
  if (!model.filterMenu) return "";
  const body = model.filterMenu === "branch"
    ? renderBranchMenu(model)
    : model.filterMenu === "user"
      ? renderUserMenu(model)
      : model.filterMenu === "date"
        ? renderDateMenu(model)
        : model.filterMenu === "paths"
          ? renderPathMenu(model)
          : renderGraphMenu(model);
  return `<div class="history-filter-popover history-filter-popover-${model.filterMenu}" role="menu">${body}</div>`;
}

function renderBranchMenu(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const selectedRootIds = effectiveHistoryRootIds(model.snapshot.repositoryRoots.map((root) => root.id), model.repositoryIds);
  const active = model.snapshot.branches.filter((branch) => selectedRootIds.has(branch.repositoryId));
  const available = new Map(model.snapshot.branches.map((branch) => [branchKey(branch), branch]));
  const favorites = uniqueLogicalBranches(Array.from(model.favoriteRefs.keys()).flatMap((key) => {
    const branch = available.get(key);
    return branch && selectedRootIds.has(branch.repositoryId) ? [branch] : [];
  }));
  const recent = uniqueLogicalBranches(model.recentRefs.flatMap((reference) => {
    const branch = available.get(historyRefKey(reference));
    return branch && selectedRootIds.has(branch.repositoryId) ? [branch] : [];
  }));
  const local = uniqueLogicalBranches(active.filter((branch) => branch.kind === "local"));
  const tags = uniqueLogicalBranches(active.filter((branch) => branch.kind === "tag"));
  const remotes = groupRemoteBranches(uniqueLogicalBranches(active.filter((branch) => branch.kind === "remote")));
  const submenu = renderBranchSubmenu(model, recent, local, tags, remotes);
  return `<button class="history-menu-option" type="button" data-history-open-dialog="branches"><span>${escapeHtml(copy.select)}</span></button>${recent.length > 0 ? submenuLauncher(model, "recent", copy.recent) : ""}${favorites.length > 0 ? `<div class="history-menu-heading">${escapeHtml(copy.favorites)}</div>${favorites.map((branch) => renderQuickRef(branch, model)).join("")}` : ""}${local.length > 0 ? submenuLauncher(model, "local", copy.groups.local) : ""}${remotes.map((remote) => submenuLauncher(model, `remote:${remote.name}`, `${remote.name}/…`)).join("")}${tags.length > 0 ? submenuLauncher(model, "tags", copy.groups.tag) : ""}${submenu}`;
}

function submenuLauncher(model: HistoryNavigationViewModel, id: string, label: string): string {
  const open = model.branchSubmenu === id;
  return `<button class="history-menu-option history-submenu-launcher" type="button" data-history-branch-submenu="${escapeAttribute(id)}" aria-expanded="${open}"><span>${escapeHtml(label)}</span>${icon("chevron", 12)}</button>`;
}

function renderBranchSubmenu(
  model: HistoryNavigationViewModel,
  recent: BranchSummary[],
  local: BranchSummary[],
  tags: BranchSummary[],
  remotes: ReturnType<typeof groupRemoteBranches>,
): string {
  const id = model.branchSubmenu;
  if (!id) return "";
  const branches = id === "recent" ? recent : id === "local" ? local : id === "tags" ? tags : remotes.find((remote) => `remote:${remote.name}` === id)?.branches.map(({ branch }) => branch) ?? [];
  return branches.length > 0 ? `<div class="history-branch-submenu" role="menu" aria-label="${escapeAttribute(id)}">${branches.map((branch) => renderQuickRef(branch, model)).join("")}</div>` : "";
}

function renderQuickRef(branch: BranchSummary, model: HistoryNavigationViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const matches = matchingBranches(branch, branchModel(model));
  const selected = matches.length > 0 && matches.every((candidate) => model.refs.has(branchKey(candidate)));
  const glyph = branch.current ? "head" : branch.kind === "tag" ? "tag" : "branch";
  const root = model.snapshot.repositoryRoots.find((item) => item.id === branch.repositoryId);
  const suffix = matches.length > 1 ? `<small>${escapeHtml(localization.catalog.history.roots(matches.length))}</small>` : model.snapshot.repositoryRoots.length > 1 ? `<small>${escapeHtml(root?.displayName ?? branch.repositoryId)}</small>` : "";
  return `<button class="history-menu-option two-line" type="button" data-history-quick-ref="${escapeAttribute(branchKey(branch))}" aria-pressed="${selected}" title="${escapeAttribute(branch.fullName)}"><span><strong>${icon(glyph, 13)}${escapeHtml(branch.name)}</strong>${suffix}</span>${selected ? icon("check", 13) : ""}</button>`;
}

function renderUserMenu(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const choices = historyAuthorChoices(model.snapshot.commits);
  const allSelected = !model.currentAuthor && model.authorEmails.size === 0;
  return `<button class="history-menu-option" type="button" data-history-clear-users aria-pressed="${allSelected}"><span>${escapeHtml(copy.allUsers)}</span>${allSelected ? icon("check", 13) : ""}</button><div class="history-menu-heading">${escapeHtml(copy.identity)}</div><button class="history-menu-option" type="button" data-history-me aria-pressed="${model.currentAuthor}"><span>${escapeHtml(copy.me)}</span>${model.currentAuthor ? icon("check", 13) : ""}</button><div class="history-menu-heading">${escapeHtml(copy.loadedAuthors)}</div>${choices.map((choice) => { const selected = model.authorEmails.has(choice.email); return `<button class="history-menu-option two-line" type="button" data-history-author="${escapeAttribute(choice.email)}" aria-pressed="${selected}"><span><strong>${escapeHtml(choice.name)}</strong><small>${escapeHtml(choice.email)}</small></span><em>${(model.localization ?? DEFAULT_LOCALIZATION).number.format(choice.count)}</em>${selected ? icon("check", 13) : ""}</button>`; }).join("")}`;
}

function renderDateMenu(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const options: Array<[HistoryDatePreset, string]> = [["all", copy.allDates], ["day", copy.last24Hours], ["week", copy.last7Days]];
  return options.map(([preset, label]) => { const selected = model.datePreset === preset; return `<button class="history-menu-option" type="button" data-history-date="${preset}" aria-pressed="${selected}"><span>${label}</span>${selected ? icon("check", 13) : ""}</button>`; }).join("");
}

function renderPathMenu(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const selectedRoots = effectiveHistoryRootIds(model.snapshot.repositoryRoots.map((root) => root.id), model.repositoryIds);
  const candidates = historyPathCandidates(model.files);
  const recent = model.recentPaths.flatMap((path) => {
    const candidate = candidates.find((item) => historyPathKey(item) === historyPathKey(path));
    return candidate ? [candidate] : [];
  });
  return `<button class="history-menu-option" type="button" data-history-open-dialog="paths-text"><span>${escapeHtml(copy.select)}</span></button><button class="history-menu-option" type="button" data-history-open-dialog="paths-tree"><span>${escapeHtml(copy.selectInTree)}</span></button>${model.snapshot.repositoryRoots.length > 1 ? `<div class="history-menu-heading">${escapeHtml(copy.rootsLabel)}</div>${model.snapshot.repositoryRoots.map((root) => renderRootOption(root.id, root.displayName, root.relativePath, selectedRoots, model)).join("")}` : ""}${recent.length > 0 ? `<div class="history-menu-heading">${escapeHtml(copy.recent)}</div>${recent.map((path) => renderQuickPath(path, model)).join("")}` : ""}${model.filesLoading ? `<div class="history-menu-note">${escapeHtml(copy.loadingTrackedPaths)}</div>` : ""}${model.filesError ? `<div class="history-menu-note warning">${escapeHtml(copy.trackedPathsFailed)}</div>` : ""}${model.filesTruncated ? `<div class="history-menu-note">${escapeHtml(copy.boundedTree)}</div>` : ""}`;
}

function renderRootOption(id: string, name: string, path: string, selectedRoots: ReadonlySet<string>, model: HistoryNavigationViewModel): string {
  const selected = selectedRoots.has(id);
  const lastSelected = selected && selectedRoots.size === 1;
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  return `<label class="history-menu-option history-root-option two-line" title="${escapeAttribute(lastSelected ? copy.keepOneRoot : copy.includeRootHistory(name))}"><input type="checkbox" data-history-root="${escapeAttribute(id)}" ${selected ? "checked" : ""} ${lastSelected ? "disabled" : ""} /><span><strong>${icon("folder", 13)}${escapeHtml(name)}</strong><small>${escapeHtml(path)}</small></span></label>`;
}

function renderQuickPath(path: HistoryPath, model: HistoryNavigationViewModel): string {
  const label = historyPathWorkspaceLabel(path, model.files);
  const selected = model.paths.has(historyPathKey(path));
  return `<button class="history-menu-option" type="button" data-history-quick-path="${escapeAttribute(historyPathKey(path))}" aria-pressed="${selected}" title="${escapeAttribute(label)}"><span>${icon("file", 13)}${escapeHtml(label)}</span>${selected ? icon("check", 13) : ""}</button>`;
}

function renderGraphMenu(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  return `<div class="history-menu-heading">${escapeHtml(copy.sort)}</div><button class="history-menu-option" type="button" data-history-order="date" aria-pressed="${model.order === "date"}"><span>${escapeHtml(copy.byCommitDate)}</span>${model.order === "date" ? icon("check", 13) : ""}</button><button class="history-menu-option" type="button" data-history-order="topological" aria-pressed="${model.order === "topological"}"><span>${escapeHtml(copy.topologically)}</span>${model.order === "topological" ? icon("check", 13) : ""}</button><div class="history-menu-heading">${escapeHtml(copy.options)}</div><button class="history-menu-option" type="button" data-history-graph-option="first-parent" aria-pressed="${model.firstParent}"><span>${escapeHtml(copy.firstParent)}</span>${model.firstParent ? icon("check", 13) : ""}</button><button class="history-menu-option" type="button" data-history-graph-option="no-merges" aria-pressed="${model.excludeMerges}"><span>${escapeHtml(copy.noMerges)}</span>${model.excludeMerges ? icon("check", 13) : ""}</button><div class="history-menu-heading">${escapeHtml(copy.branchActions)}</div><button class="history-menu-option" type="button" data-history-collapse-linear aria-pressed="${model.collapseLinear}"><span>${escapeHtml(model.collapseLinear ? copy.expandLinearBranches : copy.collapseLinearBranches)}</span>${model.collapseLinear ? icon("check", 13) : ""}</button>`;
}

function historyPathLabel(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  if (model.paths.size > 1) return copy.pathsCount(model.paths.size);
  if (model.paths.size === 1) return basename(historyPathWorkspaceLabel(Array.from(model.paths.values())[0]!, model.files));
  return model.repositoryIds.size > 0 ? copy.rootsCount(model.repositoryIds.size) : copy.paths;
}

function historyUserLabel(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const count = model.authorEmails.size + (model.currentAuthor ? 1 : 0);
  return count === 0 ? copy.user : count === 1 && model.currentAuthor ? copy.me : copy.userCount(count);
}

function historyDateLabel(model: HistoryNavigationViewModel): string {
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  return model.datePreset === "day" ? copy.hours24 : model.datePreset === "week" ? copy.days7 : copy.date;
}

function branchModel(model: HistoryNavigationViewModel): BranchNavigationViewModel {
  return {
    snapshot: model.snapshot,
    query: "",
    selectedRepositoryIds: model.repositoryIds,
    selectedRefs: model.refs,
    collapsedGroups: new Set(),
    localization: model.localization,
  };
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
