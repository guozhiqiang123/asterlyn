import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import { DEFAULT_LOCALIZATION, type Localization } from "../../localization/localization.ts";
import type {
  BranchSummary,
  ChangeKind,
  CommitComparisonDetails,
  CommitDetails,
  CommitFileChange,
  CommitSummary,
  RepositorySnapshot,
} from "../../models.ts";
import {
  buildCommitFileTree,
  commitReferences,
  type CommitFileTreeNode,
  type CommitFileView,
} from "../../presentation/git-presentation.ts";
import type { CommitDetailDirectoryContextTarget } from "./commit-detail-context-binding.ts";
import { formatPresentationDateTime } from "../../presentation/date-time.ts";

export interface CommitDetailViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly commit: CommitSummary;
  readonly details: CommitDetails | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedFile: string | null;
  readonly fileView: CommitFileView;
  readonly collapsedDirectories: ReadonlySet<string>;
  readonly localization?: Localization;
}

export interface CommitComparisonDetailViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly repositoryId: string;
  readonly beforeOid: string;
  readonly afterOid: string;
  readonly details: CommitComparisonDetails | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedFile: string | null;
  readonly fileView: CommitFileView;
  readonly collapsedDirectories: ReadonlySet<string>;
  readonly localization?: Localization;
}

export interface CommitFolderDetailViewModel {
  readonly target: CommitDetailDirectoryContextTarget;
  readonly selectedFile: string | null;
  readonly fileView: CommitFileView;
  readonly collapsedDirectories: ReadonlySet<string>;
  readonly localization?: Localization;
}

export interface BranchSafetyPresentation {
  readonly ready: boolean;
  readonly message: string;
  readonly blockers: string[];
}

export interface BranchDetailViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly branch: BranchSummary;
  readonly safety: BranchSafetyPresentation;
  readonly loading: boolean;
  readonly newBranchName: string;
  readonly localization?: Localization;
}

export function renderCommitDetail(model: CommitDetailViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  const fileCount = model.loading ? "…" : model.error ? "!" : (model.details ? localization.number.format(model.details.files.length) : "…");
  const fileRows = commitFileRows(model);
  const nextView = model.fileView === "tree" ? copy.flatList : copy.directoryTree;
  return `<div class="commit-detail-layout"><section class="git-detail-files" aria-label="${escapeAttribute(copy.changedFiles)}"><div class="commit-files-toolbar"><span class="commit-files-label">${icon("folder", 13)}<span>${escapeHtml(copy.files)}</span><b>${fileCount}</b></span><button class="compact-icon-button" id="commit-file-view-toggle" type="button" aria-label="${escapeAttribute(copy.showChangedFilesAs(nextView))}" aria-pressed="${model.fileView === "tree"}" title="${escapeAttribute(copy.showChangedFilesAs(nextView))}">${icon("eye", 14)}</button><button class="compact-icon-button" id="commit-file-expand-all" type="button" aria-label="${escapeAttribute(copy.expandChangedFolders)}" title="${escapeAttribute(copy.expandChangedFolders)}" ${model.fileView === "flat" || !model.details?.files.length ? "disabled" : ""}>${icon("expand", 14)}</button><button class="compact-icon-button" id="commit-file-collapse-all" type="button" aria-label="${escapeAttribute(copy.collapseChangedFolders)}" title="${escapeAttribute(copy.collapseChangedFolders)}" ${model.fileView === "flat" || !model.details?.files.length ? "disabled" : ""}>${icon("collapse", 14)}</button></div><div class="commit-file-list ${model.fileView}">${fileRows}</div></section><div class="workbench-splitter horizontal commit-summary-splitter" id="commit-summary-splitter" aria-label="${escapeAttribute(copy.resizeCommitDetails)}"></div>${commitInspector(model)}</div>`;
}

export function renderCommitComparisonDetail(model: CommitComparisonDetailViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  const fileCount = model.loading
    ? "…"
    : model.error
      ? "!"
      : model.details
        ? localization.number.format(model.details.files.length)
        : "…";
  const nextView = model.fileView === "tree" ? copy.flatList : copy.directoryTree;
  const before = (model.details?.beforeOid ?? model.beforeOid).slice(0, 10);
  const after = (model.details?.afterOid ?? model.afterOid).slice(0, 10);
  const relation = !model.details
    ? ""
    : model.details.relation === "divergent"
      ? copy.comparisonDivergent
      : model.details.relation === "afterIsAncestor"
        ? copy.comparisonReversed
        : copy.comparisonRelated;
  return `<div class="commit-detail-layout comparison-detail-layout"><section class="git-detail-files" aria-label="${escapeAttribute(copy.comparisonFileRange)}"><div class="commit-files-toolbar"><span class="commit-files-label">${icon("folder", 13)}<span>${escapeHtml(copy.comparisonFileRange)}</span><b>${fileCount}</b></span><button class="compact-icon-button" id="comparison-file-view-toggle" type="button" aria-label="${escapeAttribute(copy.showChangedFilesAs(nextView))}" aria-pressed="${model.fileView === "tree"}" title="${escapeAttribute(copy.showChangedFilesAs(nextView))}">${icon("eye", 14)}</button><button class="compact-icon-button" id="comparison-file-expand-all" type="button" aria-label="${escapeAttribute(copy.expandChangedFolders)}" title="${escapeAttribute(copy.expandChangedFolders)}" ${model.fileView === "flat" || !model.details?.files.length ? "disabled" : ""}>${icon("expand", 14)}</button><button class="compact-icon-button" id="comparison-file-collapse-all" type="button" aria-label="${escapeAttribute(copy.collapseChangedFolders)}" title="${escapeAttribute(copy.collapseChangedFolders)}" ${model.fileView === "flat" || !model.details?.files.length ? "disabled" : ""}>${icon("collapse", 14)}</button></div><div class="commit-file-list ${model.fileView}">${comparisonFileRows(model)}</div></section><div class="workbench-splitter horizontal commit-summary-splitter" id="commit-summary-splitter" aria-label="${escapeAttribute(copy.resizeCommitDetails)}"></div><section class="commit-information comparison-information" aria-label="${escapeAttribute(copy.comparisonAria(before, after))}"><span class="panel-eyebrow">${escapeHtml(copy.comparisonTitle)}</span><h2><code>${escapeHtml(before)}</code><span aria-hidden="true"> → </span><code>${escapeHtml(after)}</code></h2><p class="muted-copy">${escapeHtml(relation)}</p><dl class="metadata-list"><div><dt>${escapeHtml(copy.comparisonBefore)}</dt><dd><code title="${escapeAttribute(model.details?.beforeOid ?? model.beforeOid)}">${escapeHtml(before)}</code></dd></div><div><dt>${escapeHtml(copy.comparisonAfter)}</dt><dd><code title="${escapeAttribute(model.details?.afterOid ?? model.afterOid)}">${escapeHtml(after)}</code></dd></div></dl><button class="secondary-button" id="swap-comparison-sides" type="button" ${model.loading || !model.details ? "disabled" : ""}>${escapeHtml(copy.swapComparisonSides)}</button></section></div>`;
}

export function renderCommitFolderDetail(model: CommitFolderDetailViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  const labels = copy.commitFolderContextMenu;
  const count = localization.number.format(model.target.descendants.length);
  const nextView = model.fileView === "tree" ? copy.flatList : copy.directoryTree;
  const commit = model.target.oid.slice(0, 10);
  const parent = model.target.parentOid?.slice(0, 10) ?? copy.emptyTree;
  return `<div class="commit-detail-layout commit-folder-detail-layout"><section class="git-detail-files" aria-label="${escapeAttribute(labels.folderChanges)}"><div class="commit-files-toolbar"><span class="commit-files-label">${icon("folder", 13)}<span>${escapeHtml(labels.folderChanges)}</span><b>${count}</b></span><button class="compact-icon-button" id="commit-folder-file-view-toggle" type="button" aria-label="${escapeAttribute(copy.showChangedFilesAs(nextView))}" aria-pressed="${model.fileView === "tree"}" title="${escapeAttribute(copy.showChangedFilesAs(nextView))}">${icon("eye", 14)}</button><button class="compact-icon-button" id="commit-folder-expand-all" type="button" aria-label="${escapeAttribute(copy.expandChangedFolders)}" title="${escapeAttribute(copy.expandChangedFolders)}" ${model.fileView === "flat" ? "disabled" : ""}>${icon("expand", 14)}</button><button class="compact-icon-button" id="commit-folder-collapse-all" type="button" aria-label="${escapeAttribute(copy.collapseChangedFolders)}" title="${escapeAttribute(copy.collapseChangedFolders)}" ${model.fileView === "flat" ? "disabled" : ""}>${icon("collapse", 14)}</button></div><div class="commit-file-list ${model.fileView}">${commitFolderFileRows(model)}</div></section><div class="workbench-splitter horizontal commit-summary-splitter" id="commit-summary-splitter" aria-label="${escapeAttribute(copy.resizeCommitDetails)}"></div><section class="commit-information comparison-information" aria-label="${escapeAttribute(labels.ariaLabel(model.target.path))}"><span class="panel-eyebrow">${escapeHtml(labels.folderChanges)}</span><h2 title="${escapeAttribute(model.target.path)}">${escapeHtml(model.target.path)}</h2><p class="muted-copy">${escapeHtml(labels.projectedRangeDescription(model.target.descendants.length, count))}</p><dl class="metadata-list"><div><dt>${escapeHtml(labels.commit)}</dt><dd><code title="${escapeAttribute(model.target.oid)}">${escapeHtml(commit)}</code></dd></div><div><dt>${escapeHtml(labels.comparisonBase)}</dt><dd><code title="${escapeAttribute(model.target.parentOid ?? copy.emptyTree)}">${escapeHtml(parent)}</code></dd></div></dl></section></div>`;
}

export function renderBranchDetail(model: BranchDetailViewModel): string {
  const { branch, safety } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  const mainRoot = branch.repositoryId === ".";
  const localTarget = branch.kind === "local" && mainRoot;
  const canCheckout = localTarget && !branch.current && safety.ready && !model.loading;
  const checkoutLabel = branch.current ? copy.currentBranch : localTarget ? safety.ready ? copy.checkoutBranch(branch.name) : copy.checkoutBlocked : mainRoot ? copy.localBranchesOnly : copy.submoduleHistoryOnly;
  const blockers = safety.blockers.length
    ? `<ul class="branch-blockers">${safety.blockers.slice(0, 5).map((path) => `<li>${escapeHtml(path)}</li>`).join("")}</ul>${safety.blockers.length > 5 ? `<small>${escapeHtml(copy.moreBlockers(safety.blockers.length - 5))}</small>` : ""}`
    : "";
  const branchKind = copy.referenceKinds[branch.kind];
  return `<div class="inspector-header"><span class="panel-eyebrow">${escapeHtml(branchKind)}</span><h2>${escapeHtml(branch.name)}</h2></div><dl class="metadata-list"><div><dt>${escapeHtml(copy.state)}</dt><dd>${escapeHtml(branch.current ? copy.checkedOut : localization.catalog.common.available)}</dd></div><div><dt>${escapeHtml(copy.upstream)}</dt><dd>${escapeHtml(branch.upstream ?? copy.none)}</dd></div><div><dt>${escapeHtml(copy.tracking)}</dt><dd>${escapeHtml(branch.tracking ?? copy.noDivergence)}</dd></div><div><dt>${escapeHtml(copy.updated)}</dt><dd>${escapeHtml(branch.committedAt ? formatPresentationDateTime(branch.committedAt, localization) : copy.unknownTime)}</dd></div></dl>${mainRoot && !branch.current ? `<div class="git-detail-operation-actions" role="group" aria-label="${escapeAttribute(copy.operationsUsing(branch.name))}"><button class="secondary-button" type="button" data-start-git-operation="merge" data-operation-target="${escapeAttribute(branch.fullName)}">${escapeHtml(copy.mergeIntoCurrent)}</button><button class="secondary-button" type="button" data-start-git-operation="rebase" data-operation-target="${escapeAttribute(branch.fullName)}">${escapeHtml(copy.rebaseCurrentOnto)}</button></div>` : ""}<section class="branch-action-card ${safety.ready ? "ready" : "blocked"}"><div class="branch-action-heading"><span>${icon("branch", 15)}</span><strong>${escapeHtml(copy.checkout)}</strong></div><p>${localTarget ? escapeHtml(safety.message) : escapeHtml(mainRoot ? copy.selectLocalBranch : copy.submoduleReadOnly)}</p>${localTarget ? blockers : ""}<button class="primary-button" id="checkout-branch" type="button" ${canCheckout ? "" : "disabled"}>${escapeHtml(checkoutLabel)}</button></section>${mainRoot ? `<section class="branch-action-card create-branch-card ${safety.ready ? "ready" : "blocked"}"><div class="branch-action-heading"><span>${icon("plus", 15)}</span><strong>${escapeHtml(copy.newLocalBranch)}</strong></div><p>${escapeHtml(copy.createFromHead).replace("HEAD", "<code>HEAD</code>")}</p><form id="create-branch-form"><label for="new-branch-name">${escapeHtml(copy.branchName)}</label><input id="new-branch-name" type="text" value="${escapeAttribute(model.newBranchName)}" placeholder="feature/name" autocomplete="off" spellcheck="false" /><button class="secondary-button" id="create-branch-button" type="submit" ${safety.ready && model.newBranchName.trim() && !model.loading ? "" : "disabled"}>${escapeHtml(copy.createAndCheckout)}</button></form></section>` : ""}`;
}

export function inspectorPlaceholder(localization: Localization = DEFAULT_LOCALIZATION): string {
  const copy = localization.catalog.history;
  return `<div class="inspector-header"><span class="panel-eyebrow">${escapeHtml(copy.details)}</span><h2>${escapeHtml(copy.nothingSelected)}</h2></div><p class="muted-copy inspector-copy">${escapeHtml(copy.selectToInspect)}</p>`;
}

function commitFileRows(model: CommitDetailViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  if (model.loading) return loadingBlock(copy.loadingChangedFiles);
  if (model.error) return retryState(copy.couldNotLoadCommit, localization.catalog.errors.translate(model.error), localization);
  if (!model.details) return loadingBlock(copy.loadingChangedFiles);
  if (model.details.files.length === 0) return `<div class="group-empty">${escapeHtml(copy.noFirstParentChanges)}</div>`;
  if (model.fileView === "flat") {
    return [...model.details.files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => commitFileRow(file, file.path === model.selectedFile, null, localization)).join("");
  }
  const rootExpanded = !model.collapsedDirectories.has(".");
  const rootName = model.snapshot.repositoryRoots.find((root) => root.id === model.commit.repositoryId)?.displayName ?? basename(model.snapshot.root);
  return `<div class="commit-file-tree" role="tree" aria-label="${escapeAttribute(copy.changedFilesByDirectory)}"><details class="commit-file-directory commit-file-root" data-commit-file-directory="." data-commit-file-rendered-expanded="${rootExpanded}" ${rootExpanded ? "open" : ""}><summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(rootName)}</span><small>${escapeHtml(copy.fileCount(model.details.files.length))}</small></summary><div role="group">${rootExpanded ? buildCommitFileTree(model.details.files).map((node) => commitFileTreeNode(node, 1, model)).join("") : ""}</div></details></div>`;
}

function comparisonFileRows(model: CommitComparisonDetailViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  if (model.loading) return loadingBlock(copy.loadingChangedFiles);
  if (model.error) {
    return `<div class="empty-state"><span class="empty-icon">${icon("history", 24)}</span><strong>${escapeHtml(copy.couldNotLoadComparison)}</strong><p>${escapeHtml(localization.catalog.errors.translate(model.error))}</p><button class="secondary-button retry-button" id="retry-commit-comparison" type="button">${escapeHtml(localization.catalog.common.retry)}</button></div>`;
  }
  if (!model.details) return loadingBlock(copy.loadingChangedFiles);
  if (model.details.files.length === 0) {
    return `<div class="group-empty">${escapeHtml(copy.noComparisonChanges)}</div>`;
  }
  if (model.fileView === "flat") {
    return [...model.details.files]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => comparisonFileRow(file, file.path === model.selectedFile, null, localization))
      .join("");
  }
  const rootExpanded = !model.collapsedDirectories.has(".");
  const rootName = model.snapshot.repositoryRoots.find(
    (root) => root.id === model.repositoryId,
  )?.displayName ?? basename(model.snapshot.root);
  return `<div class="commit-file-tree" role="tree" aria-label="${escapeAttribute(copy.changedFilesByDirectory)}"><details class="commit-file-directory commit-file-root" data-comparison-file-directory="." data-comparison-file-rendered-expanded="${rootExpanded}" ${rootExpanded ? "open" : ""}><summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(rootName)}</span><small>${escapeHtml(copy.fileCount(model.details.files.length))}</small></summary><div role="group">${rootExpanded ? buildCommitFileTree(model.details.files).map((node) => comparisonFileTreeNode(node, 1, model)).join("") : ""}</div></details></div>`;
}

function commitFolderFileRows(model: CommitFolderDetailViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  if (model.fileView === "flat") {
    return [...model.target.descendants]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((file) => commitFolderFileRow(
        file,
        file.path === model.selectedFile,
        null,
        localization,
      ))
      .join("");
  }
  const projected = findCommitDirectory(
    buildCommitFileTree([...model.target.descendants]),
    model.target.path,
  );
  const rootExpanded = !model.collapsedDirectories.has(model.target.path);
  const children = projected?.children ?? [];
  return `<div class="commit-file-tree" role="tree" aria-label="${escapeAttribute(localization.catalog.history.changedFilesByDirectory)}"><details class="commit-file-directory commit-file-root" data-commit-folder-file-directory="${escapeAttribute(model.target.path)}" data-commit-folder-file-rendered-expanded="${rootExpanded}" ${rootExpanded ? "open" : ""}><summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(basename(model.target.path))}</span><small>${escapeHtml(localization.catalog.history.fileCount(model.target.descendants.length))}</small></summary><div role="group">${rootExpanded ? children.map((node) => commitFolderFileTreeNode(node, 1, model)).join("") : ""}</div></details></div>`;
}

function commitFolderFileTreeNode(
  node: CommitFileTreeNode,
  depth: number,
  model: CommitFolderDetailViewModel,
): string {
  if (node.kind === "directory") {
    const expanded = !model.collapsedDirectories.has(node.path);
    return `<details class="commit-file-directory" data-commit-folder-file-directory="${escapeAttribute(node.path)}" data-commit-folder-file-rendered-expanded="${expanded}" ${expanded ? "open" : ""}><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(node.name)}</span><small>${countFiles(node)}</small></summary><div role="group">${expanded ? node.children.map((child) => commitFolderFileTreeNode(child, depth + 1, model)).join("") : ""}</div></details>`;
  }
  return commitFolderFileRow(
    node.file!,
    node.file!.path === model.selectedFile,
    depth,
    model.localization ?? DEFAULT_LOCALIZATION,
  );
}

function commitFolderFileRow(
  file: CommitFileChange,
  selected: boolean,
  depth: number | null,
  localization: Localization,
): string {
  const previous = file.originalPath
    ? `<span class="commit-file-origin">${escapeHtml(file.originalPath)} →</span>`
    : "";
  const tree = depth !== null;
  return `<button class="commit-file-row file-status-${file.status} ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" ${tree ? `style="--tree-depth:${depth}"` : ""} data-commit-folder-file="${escapeAttribute(file.path)}" aria-pressed="${selected}" title="${escapeAttribute(file.path)}"><span class="change-status status-${file.status}" title="${escapeAttribute(localization.catalog.changes.changeLabels[file.status])}">${changeCode(file.status)}</span><span class="commit-file-glyph">${fileTypeIcon(file.path)}</span><span class="change-path">${previous}<span class="file-name">${escapeHtml(basename(file.path))}</span>${tree ? "" : `<span class="file-directory">${escapeHtml(dirname(file.path))}</span>`}</span></button>`;
}

function findCommitDirectory(
  nodes: readonly CommitFileTreeNode[],
  path: string,
): CommitFileTreeNode | null {
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    if (node.path === path) return node;
    const nested = findCommitDirectory(node.children, path);
    if (nested) return nested;
  }
  return null;
}

function comparisonFileTreeNode(
  node: CommitFileTreeNode,
  depth: number,
  model: CommitComparisonDetailViewModel,
): string {
  if (node.kind === "directory") {
    const expanded = !model.collapsedDirectories.has(node.path);
    return `<details class="commit-file-directory" data-comparison-file-directory="${escapeAttribute(node.path)}" data-comparison-file-rendered-expanded="${expanded}" ${expanded ? "open" : ""}><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(node.name)}</span><small>${countFiles(node)}</small></summary><div role="group">${expanded ? node.children.map((child) => comparisonFileTreeNode(child, depth + 1, model)).join("") : ""}</div></details>`;
  }
  return comparisonFileRow(
    node.file!,
    node.file!.path === model.selectedFile,
    depth,
    model.localization ?? DEFAULT_LOCALIZATION,
  );
}

function comparisonFileRow(
  file: CommitFileChange,
  selected: boolean,
  depth: number | null,
  localization: Localization,
): string {
  const previous = file.originalPath
    ? `<span class="commit-file-origin">${escapeHtml(file.originalPath)} →</span>`
    : "";
  const tree = depth !== null;
  return `<button class="commit-file-row file-status-${file.status} ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" ${tree ? `style="--tree-depth:${depth}"` : ""} data-comparison-file="${escapeAttribute(file.path)}" aria-pressed="${selected}" title="${escapeAttribute(file.path)}"><span class="change-status status-${file.status}" title="${escapeAttribute(localization.catalog.changes.changeLabels[file.status])}">${changeCode(file.status)}</span><span class="commit-file-glyph">${fileTypeIcon(file.path)}</span><span class="change-path">${previous}<span class="file-name">${escapeHtml(basename(file.path))}</span>${tree ? "" : `<span class="file-directory">${escapeHtml(dirname(file.path))}</span>`}</span></button>`;
}

function commitFileTreeNode(node: CommitFileTreeNode, depth: number, model: CommitDetailViewModel): string {
  if (node.kind === "directory") {
    const expanded = !model.collapsedDirectories.has(node.path);
    return `<details class="commit-file-directory" data-commit-file-directory="${escapeAttribute(node.path)}" data-commit-file-rendered-expanded="${expanded}" ${expanded ? "open" : ""}><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(node.name)}</span><small>${countFiles(node)}</small></summary><div role="group">${expanded ? node.children.map((child) => commitFileTreeNode(child, depth + 1, model)).join("") : ""}</div></details>`;
  }
  return commitFileRow(node.file!, node.file!.path === model.selectedFile, depth, model.localization ?? DEFAULT_LOCALIZATION);
}

function commitFileRow(file: CommitFileChange, selected: boolean, depth: number | null = null, localization: Localization = DEFAULT_LOCALIZATION): string {
  const previous = file.originalPath ? `<span class="commit-file-origin">${escapeHtml(file.originalPath)} →</span>` : "";
  const tree = depth !== null;
  return `<button class="commit-file-row file-status-${file.status} ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" ${tree ? `style="--tree-depth:${depth}"` : ""} data-commit-file="${escapeAttribute(file.path)}" aria-pressed="${selected}" title="${escapeAttribute(file.path)}"><span class="change-status status-${file.status}" title="${escapeAttribute(localization.catalog.changes.changeLabels[file.status])}">${changeCode(file.status)}</span><span class="commit-file-glyph">${fileTypeIcon(file.path)}</span><span class="change-path">${previous}<span class="file-name">${escapeHtml(basename(file.path))}</span>${tree ? "" : `<span class="file-directory">${escapeHtml(dirname(file.path))}</span>`}</span></button>`;
}

function commitInspector(model: CommitDetailViewModel): string {
  const { commit, details, snapshot } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  const comparison = details ? details.parentOid?.slice(0, 10) ?? copy.emptyTree : commit.parents[0]?.slice(0, 10) ?? copy.emptyTree;
  const references = commitReferences(commit.decorations, snapshot.branches.filter((branch) => branch.repositoryId === commit.repositoryId));
  const rows = references.map((reference) => {
    const iconName = reference.kind === "head" ? "head" : reference.kind === "tag" || reference.kind === "other" ? "tag" : "branch";
    return `<span class="commit-reference ${reference.kind}" title="${escapeAttribute(copy.referenceKinds[reference.kind])}: ${escapeAttribute(reference.label)}">${icon(iconName, 12)}<span>${escapeHtml(reference.label)}</span></span>`;
  }).join("");
  const summary = references.slice(0, 3).map((reference) => reference.label).join(", ");
  const authoredAt = commit.authoredAt ? formatPresentationDateTime(commit.authoredAt, localization) : copy.unknownTime;
  return `<section class="commit-information" aria-label="${escapeAttribute(copy.commitMessageAndDetails)}"><h2>${escapeHtml(commit.subject)}</h2><p class="commit-authorship"><code title="${escapeAttribute(commit.oid)}">${escapeHtml(commit.shortOid)}</code><span>${escapeHtml(commit.authorName)}</span><span class="commit-email">&lt;${escapeHtml(commit.authorEmail)}&gt;</span><span>${escapeHtml(copy.authoredOn)}</span><time datetime="${new Date(commit.authoredAt * 1000).toISOString()}">${escapeHtml(authoredAt)}</time></p>${snapshot.repositoryRoots.length > 1 ? `<span class="commit-comparison">${escapeHtml(copy.gitRoot(snapshot.repositoryRoots.find((root) => root.id === commit.repositoryId)?.relativePath ?? commit.repositoryId))}</span>` : ""}${references.length === 0 ? `<span class="commit-no-references">${escapeHtml(copy.noNamedRefs)}</span>` : references.length <= 3 ? `<div class="commit-reference-list">${rows}</div>` : `<details class="commit-reference-overflow"><summary><span>${escapeHtml(copy.refsSummary(references.length, summary))}</span><b>${escapeHtml(copy.showAll)}</b></summary><div class="commit-reference-list">${rows}</div></details>`}<span class="commit-comparison" title="${escapeAttribute(copy.firstParentComparison)}">${escapeHtml(copy.comparedWith(comparison))}</span></section>`;
}

function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

function retryState(title: string, detail: string, localization: Localization): string {
  return `<div class="empty-state"><span class="empty-icon">${icon("history", 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><button class="secondary-button retry-button" id="retry-commit-details" type="button">${escapeHtml(localization.catalog.common.retry)}</button></div>`;
}

function countFiles(node: CommitFileTreeNode): number {
  return node.kind === "file" ? 1 : node.children.reduce((count, child) => count + countFiles(child), 0);
}

function changeCode(kind: ChangeKind): string {
  const values: Record<ChangeKind, string> = { unmodified: "·", added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C", typeChanged: "T", unmerged: "U", untracked: "?", ignored: "!", unknown: "·" };
  return values[kind];
}

function basename(path: string): string { return path.split("/").filter(Boolean).at(-1) ?? path; }
function dirname(path: string): string { const parts = path.split("/").filter(Boolean); parts.pop(); return parts.join("/"); }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function escapeAttribute(value: string): string { return escapeHtml(value); }
