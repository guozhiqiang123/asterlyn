import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type {
  BranchSummary,
  ChangeKind,
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
} from "../../workbench/git-presentation.ts";

export interface CommitDetailViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly commit: CommitSummary;
  readonly details: CommitDetails | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedFile: string | null;
  readonly fileView: CommitFileView;
  readonly collapsedDirectories: ReadonlySet<string>;
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
}

export function renderCommitDetail(model: CommitDetailViewModel): string {
  const fileCount = model.loading ? "…" : model.error ? "!" : (model.details?.files.length.toString() ?? "…");
  const fileRows = commitFileRows(model);
  const nextView = model.fileView === "tree" ? "flat list" : "directory tree";
  return `<div class="commit-detail-layout"><section class="git-detail-files" aria-label="Changed files"><div class="commit-files-toolbar"><span class="commit-files-label">${icon("folder", 13)}<span>Files</span><b>${fileCount}</b></span><button class="compact-icon-button" id="commit-file-view-toggle" type="button" aria-label="Show changed files as a ${nextView}" aria-pressed="${model.fileView === "tree"}" title="Show as ${nextView}">${icon("eye", 14)}</button><button class="compact-icon-button" id="commit-file-expand-all" type="button" aria-label="Expand all changed-file folders" title="Expand all folders" ${model.fileView === "flat" || !model.details?.files.length ? "disabled" : ""}>${icon("expand", 14)}</button><button class="compact-icon-button" id="commit-file-collapse-all" type="button" aria-label="Collapse all changed-file folders" title="Collapse all folders" ${model.fileView === "flat" || !model.details?.files.length ? "disabled" : ""}>${icon("collapse", 14)}</button></div><div class="commit-file-list ${model.fileView}">${fileRows}</div></section><div class="workbench-splitter horizontal commit-summary-splitter" id="commit-summary-splitter" aria-label="Resize commit message and details"></div>${commitInspector(model)}</div>`;
}

export function renderBranchDetail(model: BranchDetailViewModel): string {
  const { branch, safety } = model;
  const mainRoot = branch.repositoryId === ".";
  const localTarget = branch.kind === "local" && mainRoot;
  const canCheckout = localTarget && !branch.current && safety.ready && !model.loading;
  const checkoutLabel = branch.current ? "Current branch" : localTarget ? safety.ready ? `Checkout ${branch.name}` : "Checkout blocked" : mainRoot ? "Local branches only" : "Submodule history only";
  const blockers = safety.blockers.length
    ? `<ul class="branch-blockers">${safety.blockers.slice(0, 5).map((path) => `<li>${escapeHtml(path)}</li>`).join("")}</ul>${safety.blockers.length > 5 ? `<small>and ${safety.blockers.length - 5} more</small>` : ""}`
    : "";
  return `<div class="inspector-header"><span class="panel-eyebrow">${escapeHtml(branch.kind)}</span><h2>${escapeHtml(branch.name)}</h2></div><dl class="metadata-list"><div><dt>State</dt><dd>${branch.current ? "Checked out" : "Available"}</dd></div><div><dt>Upstream</dt><dd>${escapeHtml(branch.upstream ?? "None")}</dd></div><div><dt>Tracking</dt><dd>${escapeHtml(branch.tracking ?? "No divergence")}</dd></div><div><dt>Updated</dt><dd>${formatRelative(branch.committedAt)}</dd></div></dl><section class="branch-action-card ${safety.ready ? "ready" : "blocked"}"><div class="branch-action-heading"><span>${icon("branch", 15)}</span><strong>Checkout</strong></div><p>${localTarget ? escapeHtml(safety.message) : mainRoot ? "Select a local branch to check it out. Remote and tag checkout remain deferred." : "This initialized submodule is available for history inspection only; branch mutations remain scoped to the main repository."}</p>${localTarget ? blockers : ""}<button class="primary-button" id="checkout-branch" type="button" ${canCheckout ? "" : "disabled"}>${escapeHtml(checkoutLabel)}</button></section>${mainRoot ? `<section class="branch-action-card create-branch-card ${safety.ready ? "ready" : "blocked"}"><div class="branch-action-heading"><span>${icon("plus", 15)}</span><strong>New local branch</strong></div><p>Create from the current <code>HEAD</code>. The same clean-worktree gate applies.</p><form id="create-branch-form"><label for="new-branch-name">Branch name</label><input id="new-branch-name" type="text" value="${escapeAttribute(model.newBranchName)}" placeholder="feature/name" autocomplete="off" spellcheck="false" /><button class="secondary-button" id="create-branch-button" type="submit" ${safety.ready && model.newBranchName.trim() && !model.loading ? "" : "disabled"}>Create and checkout</button></form></section>` : ""}`;
}

export function inspectorPlaceholder(): string {
  return '<div class="inspector-header"><span class="panel-eyebrow">Details</span><h2>Nothing selected</h2></div><p class="muted-copy inspector-copy">Select an item to inspect its metadata and available actions.</p>';
}

function commitFileRows(model: CommitDetailViewModel): string {
  if (model.loading) return loadingBlock("Loading changed files…");
  if (model.error) return retryState("Could not load commit", model.error);
  if (!model.details) return loadingBlock("Loading changed files…");
  if (model.details.files.length === 0) return '<div class="group-empty">No first-parent changes</div>';
  if (model.fileView === "flat") {
    return [...model.details.files].sort((left, right) => left.path.localeCompare(right.path)).map((file) => commitFileRow(file, file.path === model.selectedFile)).join("");
  }
  const rootExpanded = !model.collapsedDirectories.has(".");
  const rootName = model.snapshot.repositoryRoots.find((root) => root.id === model.commit.repositoryId)?.displayName ?? basename(model.snapshot.root);
  return `<div class="commit-file-tree" role="tree" aria-label="Changed files by directory"><details class="commit-file-directory commit-file-root" data-commit-file-directory="." data-commit-file-rendered-expanded="${rootExpanded}" ${rootExpanded ? "open" : ""}><summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(rootName)}</span><small>${model.details.files.length} ${model.details.files.length === 1 ? "file" : "files"}</small></summary><div role="group">${rootExpanded ? buildCommitFileTree(model.details.files).map((node) => commitFileTreeNode(node, 1, model)).join("") : ""}</div></details></div>`;
}

function commitFileTreeNode(node: CommitFileTreeNode, depth: number, model: CommitDetailViewModel): string {
  if (node.kind === "directory") {
    const expanded = !model.collapsedDirectories.has(node.path);
    return `<details class="commit-file-directory" data-commit-file-directory="${escapeAttribute(node.path)}" data-commit-file-rendered-expanded="${expanded}" ${expanded ? "open" : ""}><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(node.name)}</span><small>${countFiles(node)}</small></summary><div role="group">${expanded ? node.children.map((child) => commitFileTreeNode(child, depth + 1, model)).join("") : ""}</div></details>`;
  }
  return commitFileRow(node.file!, node.file!.path === model.selectedFile, depth);
}

function commitFileRow(file: CommitFileChange, selected: boolean, depth: number | null = null): string {
  const previous = file.originalPath ? `<span class="commit-file-origin">${escapeHtml(file.originalPath)} →</span>` : "";
  const tree = depth !== null;
  return `<button class="commit-file-row file-status-${file.status} ${tree ? "tree-row" : "flat-row"} ${selected ? "selected" : ""}" type="button" ${tree ? `style="--tree-depth:${depth}"` : ""} data-commit-file="${escapeAttribute(file.path)}" aria-pressed="${selected}" title="${escapeAttribute(file.path)}"><span class="change-status status-${file.status}" title="${escapeAttribute(changeLabel(file.status))}">${changeCode(file.status)}</span><span class="commit-file-glyph">${fileTypeIcon(file.path)}</span><span class="change-path">${previous}<span class="file-name">${escapeHtml(basename(file.path))}</span>${tree ? "" : `<span class="file-directory">${escapeHtml(dirname(file.path))}</span>`}</span></button>`;
}

function commitInspector(model: CommitDetailViewModel): string {
  const { commit, details, snapshot } = model;
  const comparison = details ? details.parentOid?.slice(0, 10) ?? "Empty tree" : commit.parents[0]?.slice(0, 10) ?? "Empty tree";
  const references = commitReferences(commit.decorations, snapshot.branches.filter((branch) => branch.repositoryId === commit.repositoryId));
  const rows = references.map((reference) => {
    const iconName = reference.kind === "head" ? "head" : reference.kind === "tag" || reference.kind === "other" ? "tag" : "branch";
    return `<span class="commit-reference ${reference.kind}" title="${escapeAttribute(capitalize(reference.kind))}: ${escapeAttribute(reference.label)}">${icon(iconName, 12)}<span>${escapeHtml(reference.label)}</span></span>`;
  }).join("");
  const summary = references.slice(0, 3).map((reference) => reference.label).join(", ");
  return `<section class="commit-information" aria-label="Commit message and details"><h2>${escapeHtml(commit.subject)}</h2><p class="commit-authorship"><code title="${escapeAttribute(commit.oid)}">${escapeHtml(commit.shortOid)}</code><span>${escapeHtml(commit.authorName)}</span><span class="commit-email">&lt;${escapeHtml(commit.authorEmail)}&gt;</span><span>on</span><time datetime="${new Date(commit.authoredAt * 1000).toISOString()}">${escapeHtml(formatAbsolute(commit.authoredAt))}</time></p>${snapshot.repositoryRoots.length > 1 ? `<span class="commit-comparison">Git root: ${escapeHtml(snapshot.repositoryRoots.find((root) => root.id === commit.repositoryId)?.relativePath ?? commit.repositoryId)}</span>` : ""}${references.length === 0 ? '<span class="commit-no-references">No named refs point to this commit</span>' : references.length <= 3 ? `<div class="commit-reference-list">${rows}</div>` : `<details class="commit-reference-overflow"><summary><span>In ${references.length} refs: ${escapeHtml(summary)}…</span><b>Show all</b></summary><div class="commit-reference-list">${rows}</div></details>`}<span class="commit-comparison" title="First-parent comparison">Compared with ${escapeHtml(comparison)}</span></section>`;
}

function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

function retryState(title: string, detail: string): string {
  return `<div class="empty-state"><span class="empty-icon">${icon("history", 24)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><button class="secondary-button retry-button" id="retry-commit-details" type="button">Try again</button></div>`;
}

function countFiles(node: CommitFileTreeNode): number {
  return node.kind === "file" ? 1 : node.children.reduce((count, child) => count + countFiles(child), 0);
}

function changeCode(kind: ChangeKind): string {
  const values: Record<ChangeKind, string> = { unmodified: "·", added: "A", modified: "M", deleted: "D", renamed: "R", copied: "C", typeChanged: "T", unmerged: "U", untracked: "?", ignored: "!", unknown: "·" };
  return values[kind];
}

function changeLabel(kind: ChangeKind): string {
  const values: Record<ChangeKind, string> = { unmodified: "Unmodified", added: "Added", modified: "Modified", deleted: "Deleted", renamed: "Renamed", copied: "Copied", typeChanged: "Type changed", unmerged: "Unmerged", untracked: "Untracked", ignored: "Ignored", unknown: "Unknown" };
  return values[kind];
}

function basename(path: string): string { return path.split("/").filter(Boolean).at(-1) ?? path; }
function dirname(path: string): string { const parts = path.split("/").filter(Boolean); parts.pop(); return parts.join("/"); }
function capitalize(value: string): string { return value.charAt(0).toLocaleUpperCase() + value.slice(1); }
function formatRelative(epochSeconds: number): string { if (!epochSeconds) return "Unknown time"; const difference = epochSeconds * 1000 - Date.now(); const absolute = Math.abs(difference); const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }); if (absolute < 60_000) return formatter.format(Math.round(difference / 1000), "second"); if (absolute < 3_600_000) return formatter.format(Math.round(difference / 60_000), "minute"); if (absolute < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), "hour"); if (absolute < 2_592_000_000) return formatter.format(Math.round(difference / 86_400_000), "day"); return new Date(epochSeconds * 1000).toLocaleDateString(); }
function formatAbsolute(epochSeconds: number): string { if (!epochSeconds) return "Unknown time"; return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(epochSeconds * 1000)); }
function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function escapeAttribute(value: string): string { return escapeHtml(value); }
