import { icon } from "../../icons.ts";
import { DEFAULT_LOCALIZATION, type Localization } from "../../localization/localization.ts";
import type { HistoryPath, HistoryRef, ProjectFile, RepositorySnapshot } from "../../models.ts";
import { branchKey, historyPathKey } from "./history-identity.ts";
import {
  historyPathChildren,
  historyPathRootChildren,
  type HistoryPathCandidate,
} from "./history-path-selection.ts";

export type HistoryDialogKind = "branches" | "paths-text" | "paths-tree";

export interface HistoryDialogViewModel {
  readonly kind: HistoryDialogKind;
  readonly snapshot: RepositorySnapshot;
  readonly files: ProjectFile[];
  readonly query: string;
  readonly error: string | null;
  readonly refDraft: ReadonlyMap<string, HistoryRef>;
  readonly favoriteRefs: ReadonlyMap<string, HistoryRef>;
  readonly pathDraft: ReadonlyMap<string, HistoryPath>;
  readonly pathText: string;
  readonly expandedTreePaths: ReadonlySet<string>;
  readonly localization?: Localization;
}

export function renderHistoryDialogView(model: HistoryDialogViewModel): string {
  if (model.kind === "branches") return renderBranchDialog(model);
  if (model.kind === "paths-text") return renderPathTextDialog(model);
  return renderPathTreeDialog(model);
}

function renderBranchDialog(model: HistoryDialogViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  const query = model.query.trim().toLocaleLowerCase();
  const branches = model.snapshot.branches.filter((branch) => {
    const root = model.snapshot.repositoryRoots.find((item) => item.id === branch.repositoryId);
    return !query || [branch.name, branch.fullName, branch.subject, root?.displayName ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
  const groups = model.snapshot.repositoryRoots.map((root) => ({
    root,
    branches: branches.filter((branch) => branch.repositoryId === root.id),
  })).filter(({ branches: items }) => items.length > 0);
  const rows = groups.length === 0
    ? `<div class="history-dialog-empty">${escapeHtml(copy.noMatchingBranchesOrTags)}</div>`
    : groups.map(({ root, branches: items }) => `<section class="history-dialog-group"><h3>${escapeHtml(root.displayName)}<small>${escapeHtml(root.relativePath)}</small></h3>${items.map((branch) => {
        const key = branchKey(branch);
        const selected = model.refDraft.has(key);
        const favorite = model.favoriteRefs.has(key);
        const glyph = branch.current ? "head" : branch.kind === "tag" ? "tag" : "branch";
        return `<div class="history-dialog-ref"><label><input type="checkbox" data-history-dialog-ref="${escapeAttribute(key)}" ${selected ? "checked" : ""} /><span>${icon(glyph, 13)}<strong>${escapeHtml(branch.name)}</strong><small>${escapeHtml(branch.subject)}</small></span></label><button class="history-favorite-button ${favorite ? "active" : ""}" type="button" data-history-dialog-favorite="${escapeAttribute(key)}" aria-pressed="${favorite}" aria-label="${escapeAttribute(favorite ? copy.removeFromFavorites : copy.addToFavorites)}">${icon("star", 13)}</button></div>`;
      }).join("")}</section>`).join("");
  const count = model.refDraft.size ? localization.number.format(model.refDraft.size) : copy.all;
  return `<section class="dialog history-selection-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">${heading(copy.selectBranchesOrTags, localization)}<label class="history-dialog-search" for="history-dialog-search">${icon("search", 14)}<input id="history-dialog-search" type="search" value="${escapeAttribute(model.query)}" placeholder="${escapeAttribute(copy.branchOrTag)}" autocomplete="off" spellcheck="false" /></label><div class="history-dialog-list" role="group" aria-label="${escapeAttribute(copy.availableBranchesAndTags)}">${rows}</div><div class="dialog-actions"><button class="secondary-button" type="button" data-history-dialog-clear>${escapeHtml(copy.clear)}</button><span class="dialog-spacer"></span><button class="secondary-button" type="button" data-history-dialog-cancel>${escapeHtml(localization.catalog.common.cancel)}</button><button class="primary-button" type="button" data-history-dialog-apply>${escapeHtml(copy.applyCount(count))}</button></div></section>`;
}

function renderPathTextDialog(model: HistoryDialogViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  return `<section class="dialog history-selection-dialog history-path-text-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">${heading(copy.selectPathsToFilter, localization)}<textarea id="history-path-text" spellcheck="false" autocomplete="off" aria-describedby="history-path-text-help">${escapeHtml(model.pathText)}</textarea>${model.error ? `<div class="history-dialog-error" role="alert">${escapeHtml(localization.catalog.errors.translate(model.error))}</div>` : ""}<p id="history-path-text-help">${escapeHtml(copy.pathTextHelp)}</p><div class="dialog-actions"><button class="secondary-button" type="button" data-history-dialog-cancel>${escapeHtml(localization.catalog.common.cancel)}</button><button class="primary-button" type="button" data-history-dialog-apply>${escapeHtml(copy.apply)}</button></div></section>`;
}

function renderPathTreeDialog(model: HistoryDialogViewModel): string {
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.history;
  const rootChildren = historyPathRootChildren(model.files);
  const roots = model.snapshot.repositoryRoots.map((root) => {
    const children = rootChildren.get(root.id) ?? [];
    return `<section class="history-path-tree-root"><h3>${icon("folder", 14)}${escapeHtml(root.displayName)}<small>${escapeHtml(root.relativePath)}</small></h3>${children.length > 0 ? children.map((node) => renderPathTreeNode(node, 0, model)).join("") : `<div class="history-dialog-empty">${escapeHtml(copy.noTrackedPaths)}</div>`}</section>`;
  }).join("");
  return `<section class="dialog history-selection-dialog history-path-tree-dialog" role="dialog" aria-modal="true" aria-labelledby="history-dialog-title">${heading(copy.selectPathsToFilter, localization)}<div class="history-path-tree" role="tree" aria-label="${escapeAttribute(copy.trackedRepositoryPaths)}">${roots}</div><div class="dialog-actions"><button class="secondary-button" type="button" data-history-dialog-clear>${escapeHtml(copy.clear)}</button><span class="dialog-spacer"></span><button class="secondary-button" type="button" data-history-dialog-cancel>${escapeHtml(localization.catalog.common.cancel)}</button><button class="primary-button" type="button" data-history-dialog-apply>${escapeHtml(copy.applyCount(localization.number.format(model.pathDraft.size)))}</button></div></section>`;
}

function renderPathTreeNode(
  node: HistoryPathCandidate,
  depth: number,
  model: HistoryDialogViewModel,
): string {
  const key = historyPathKey(node);
  const selected = model.pathDraft.has(key);
  const name = node.path.split("/").at(-1) ?? node.path;
  if (!node.directory) {
    return `<label class="history-path-tree-row file" role="treeitem" style="--tree-depth:${depth}"><span class="tree-chevron"></span><input type="checkbox" data-history-dialog-path="${escapeAttribute(key)}" data-history-repository="${escapeAttribute(node.repositoryId)}" data-history-path="${escapeAttribute(node.path)}" ${selected ? "checked" : ""} />${icon("file", 13)}<span>${escapeHtml(name)}</span></label>`;
  }
  const expanded = model.expandedTreePaths.has(key);
  const copy = (model.localization ?? DEFAULT_LOCALIZATION).catalog.history;
  const children = expanded
    ? historyPathChildren(model.files, node.repositoryId, node.path)
        .map((child) => renderPathTreeNode(child, depth + 1, model)).join("")
    : "";
  return `<div class="history-path-tree-node" role="treeitem" aria-expanded="${expanded}"><div class="history-path-tree-row directory" style="--tree-depth:${depth}"><button type="button" data-history-tree-toggle="${escapeAttribute(key)}" aria-label="${escapeAttribute(expanded ? copy.collapsePath(node.path) : copy.expandPath(node.path))}">${icon("chevron", 11)}</button><input type="checkbox" data-history-dialog-path="${escapeAttribute(key)}" data-history-repository="${escapeAttribute(node.repositoryId)}" data-history-path="${escapeAttribute(node.path)}" ${selected ? "checked" : ""} />${icon("folder", 13)}<span>${escapeHtml(name)}</span></div>${expanded ? `<div role="group">${children}</div>` : ""}</div>`;
}

function heading(title: string, localization: Localization): string {
  return `<div class="dialog-heading"><h2 id="history-dialog-title">${escapeHtml(title)}</h2><button class="icon-button" type="button" data-history-dialog-cancel aria-label="${escapeAttribute(localization.catalog.common.close)}">${icon("close", 16)}</button></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
