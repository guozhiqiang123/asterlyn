import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import type {
  ChangeKind,
  CommitFileChange,
  ImagePreview,
  PushPreview,
  RepositorySnapshot,
} from "../../models.ts";
import { remotePolicy } from "../../remote-policy.ts";
import {
  buildCommitFileTree,
  type CommitFileTreeNode,
} from "../../workbench/git-presentation.ts";
import { isImagePreviewPath } from "../../workbench/image-preview.ts";
import type { AppPreferences } from "../../workbench/preferences.ts";
import {
  filesForPushReview,
  pushConfirmationAvailability,
} from "../../workbench/push-review.ts";
import type { RemotePushState } from "./remote-push-state.ts";

export interface RemotePushDialogViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly state: RemotePushState;
  readonly workspaceRoot: string | null;
  readonly preferences: AppPreferences;
  readonly selectedProjectFileAvailable: boolean;
}

export function renderRemoteToolbarView(
  root: ParentNode,
  snapshot: RepositorySnapshot | null,
  state: RemotePushState,
  loading: boolean,
): void {
  const toolbar = query(root, "#remote-toolbar");
  const select = query<HTMLSelectElement>(root, "#topbar-remote-select");
  const cancel = query<HTMLButtonElement>(root, "#cancel-remote-operation");
  toolbar.classList.toggle("git-unavailable", !snapshot);
  if (!snapshot) {
    renderUnavailableToolbar(root, select, cancel);
    return;
  }

  const policy = remotePolicy(snapshot, state.selectedRemote);
  const operation = state.operation?.root === snapshot.root ? state.operation : null;
  select.innerHTML = snapshot.remotes.length
    ? snapshot.remotes.map((remote) => `<option value="${escapeAttribute(remote.name)}" ${remote.name === policy.selectedRemote?.name ? "selected" : ""}>${escapeHtml(remote.name)}${remote.fetchSupported ? "" : " · unsupported"}</option>`).join("")
    : "<option>No remote</option>";
  select.disabled = Boolean(operation) || loading || snapshot.remotes.length === 0;

  const branchName = snapshot.branch.head ?? "No branch";
  const selectedName = policy.selectedRemote?.name ?? "No remote";
  const sourceRef = snapshot.branch.head ? `refs/heads/${snapshot.branch.head}` : "no checked-out branch";
  const destinationRef = snapshot.branch.upstreamRef ?? sourceRef;
  const remoteScope = `Selected remote: ${selectedName}. Fetch refreshes all standard branch-tracking refs from this remote. Update and Push apply only to the checked-out branch.`;
  select.title = remoteScope;
  select.setAttribute("aria-label", remoteScope);
  const tracksSelected = snapshot.branch.upstreamRemote === policy.selectedRemote?.name;
  const actions = [
    { kind: "fetch", button: "#remote-fetch", hint: "#remote-fetch-hint", policy: policy.fetch, iconName: "download" },
    { kind: "pull", button: "#remote-update", hint: "#remote-update-hint", policy: policy.pull, iconName: "sync" },
    { kind: "push", button: "#remote-push", hint: "#remote-push-hint", policy: policy.push, iconName: "upload" },
  ] as const;
  for (const action of actions) {
    const button = query<HTMLButtonElement>(root, action.button);
    const exactScope = remoteActionDescription(
      action.kind,
      snapshot,
      selectedName,
      sourceRef,
      destinationRef,
      tracksSelected,
    );
    const title = `${exactScope} ${action.policy.enabled ? action.policy.detail : `Unavailable: ${action.policy.detail}`}`;
    button.disabled = Boolean(operation) || loading || !action.policy.enabled;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.classList.toggle("running", operation?.kind === action.kind);
    button.innerHTML = operation?.kind === action.kind && !operation.cancelling
      ? '<span class="spinner" aria-hidden="true"></span>'
      : `${icon(action.iconName, 18)}${remoteCountBadge(action.kind, snapshot, tracksSelected)}`;
    const hint = query<HTMLElement>(root, action.hint);
    hint.title = title;
    hint.setAttribute("aria-label", title);
    hint.tabIndex = button.disabled ? 0 : -1;
  }

  cancel.classList.toggle("hidden", !operation);
  cancel.disabled = !operation || operation.cancelling;
  cancel.title = operation
    ? `Cancel ${remoteActionLabel(operation.kind).toLowerCase()} for ${branchName} using ${selectedName}. Git may already have changed local or remote state, so Asterlyn will refresh before another action.`
    : "Cancel remote operation";
  cancel.setAttribute("aria-label", cancel.title);
}

export function renderRemoteDialogContent(model: RemotePushDialogViewModel): string {
  const body = model.state.dialog === "update"
    ? renderUpdateDialog(model.snapshot, model.state)
    : `${renderPushDialog(model)}${renderPushDiffDialog(model)}`;
  return body;
}

export function pushReviewFiles(
  preview: PushPreview,
  state: RemotePushState,
): CommitFileChange[] {
  return filesForPushReview(preview.files, state.pushSelectedCommit, state.pushCommitDetails);
}

function renderUnavailableToolbar(
  root: ParentNode,
  select: HTMLSelectElement,
  cancel: HTMLButtonElement,
): void {
  select.innerHTML = "<option>No remote</option>";
  select.disabled = true;
  select.title = "Remote selection is unavailable because this project is not an active Git repository.";
  select.setAttribute("aria-label", select.title);
  cancel.classList.add("hidden");
  const unavailable = [
    ["#remote-fetch", "Fetch is unavailable because this project is not an active Git repository. Fetch would refresh the selected remote's standard branch-tracking refs without changing working files."],
    ["#remote-update", "Update is unavailable because this project is not an active Git repository. Update would affect only the checked-out branch and would require a confirmed fast-forward."],
    ["#remote-push", "Push is unavailable because this project is not an active Git repository. Push would open a current-branch review before any remote write."],
  ] as const;
  for (const [selector, description] of unavailable) {
    const button = query<HTMLButtonElement>(root, selector);
    button.disabled = true;
    button.title = description;
    button.setAttribute("aria-label", description);
    const hint = button.closest<HTMLElement>(".topbar-remote-action");
    hint?.setAttribute("aria-label", description);
    if (hint) {
      hint.title = description;
      hint.tabIndex = 0;
    }
  }
}

function remoteActionDescription(
  kind: "fetch" | "pull" | "push",
  snapshot: RepositorySnapshot,
  selectedName: string,
  sourceRef: string,
  destinationRef: string,
  tracksSelected: boolean,
): string {
  if (kind === "fetch") {
    const behind = tracksSelected ? snapshot.branch.behind : 0;
    return `Fetch from ${selectedName}. Refresh all standard branch-tracking refs for this remote without changing the checked-out branch or working files. The badge shows ${behind} incoming commit${behind === 1 ? "" : "s"} known after the last Fetch.`;
  }
  if (kind === "pull") {
    return `Update ${sourceRef} from ${selectedName}:${destinationRef}. Opens a confirmation and performs fast-forward only; it never creates a merge commit or starts a rebase.`;
  }
  const ahead = tracksSelected ? snapshot.branch.ahead : 0;
  return `Review Push from ${sourceRef} to ${selectedName}:${destinationRef}. The badge shows ${ahead} outgoing commit${ahead === 1 ? "" : "s"} known from the last Fetch. Review can explicitly include tags or choose Force Push with an exact lease; it never retries automatically.`;
}

function remoteCountBadge(
  kind: "fetch" | "pull" | "push",
  snapshot: RepositorySnapshot,
  tracksSelected: boolean,
): string {
  if (kind === "fetch" && tracksSelected && snapshot.branch.behind > 0) {
    return `<span class="remote-count-badge" aria-hidden="true">${compactCount(snapshot.branch.behind)}</span>`;
  }
  if (kind === "push" && tracksSelected && snapshot.branch.ahead > 0) {
    return `<span class="remote-count-badge" aria-hidden="true">${compactCount(snapshot.branch.ahead)}</span>`;
  }
  return "";
}

function renderUpdateDialog(snapshot: RepositorySnapshot, state: RemotePushState): string {
  const policy = remotePolicy(snapshot, state.selectedRemote);
  const remote = policy.selectedRemote?.name ?? "No remote";
  const branch = snapshot.branch.head ?? "No branch";
  const source = snapshot.branch.head ? `refs/heads/${snapshot.branch.head}` : "No branch";
  const destination = snapshot.branch.upstreamRef ?? "No upstream";
  const operation = state.operation?.kind === "pull" ? state.operation : null;
  const busyLabel = operation?.cancelling ? "Cancelling…" : operation ? "Updating…" : "Update";
  const error = state.dialogError ? `<div class="remote-dialog-error" role="alert">${escapeHtml(state.dialogError)}</div>` : "";
  return `<section class="dialog remote-action-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-dialog-title" aria-describedby="remote-dialog-description">
    <div class="dialog-heading"><div><span class="panel-eyebrow">Current branch</span><h2 id="remote-dialog-title">Update ${escapeHtml(branch)}</h2></div><button class="icon-button" id="remote-dialog-close" type="button" aria-label="Cancel Update confirmation" title="Cancel" ${operation ? "disabled" : ""}>${icon("close", 18)}</button></div>
    <p id="remote-dialog-description">Fetch the configured upstream and integrate it into the checked-out branch. Only a clean fast-forward is executable in this version.</p>
    <div class="remote-dialog-route" aria-label="Update route"><code>${escapeHtml(source)}</code><span>←</span><code>${escapeHtml(`${remote}:${destination}`)}</code></div>
    ${error}
    <fieldset class="remote-strategy-list" ${operation ? "disabled" : ""}><legend>Update method</legend><label class="remote-strategy-card selected"><input type="radio" name="update-strategy" value="ff-only" checked /><span><strong>Fast-forward only</strong><small>Fetch the configured upstream, then move the current branch only when no merge or rebase is required.</small></span></label><label class="remote-strategy-card unavailable"><input type="radio" name="update-strategy" value="merge" disabled /><span><strong>Merge incoming changes <b>Unavailable</b></strong><small>Requires editable conflict Diff plus Continue and Abort lifecycle support.</small></span></label><label class="remote-strategy-card unavailable"><input type="radio" name="update-strategy" value="rebase" disabled /><span><strong>Rebase current branch <b>Unavailable</b></strong><small>Requires editable conflict Diff plus Continue, Skip, and Abort lifecycle support.</small></span></label></fieldset>
    <p class="remote-dialog-note">No merge commit, rebase, reset, stash, or force operation will be started. Git credentials come from your configured credential helper or SSH agent.</p>
    <div class="dialog-actions">${operation ? `<button class="secondary-button" id="remote-dialog-cancel-operation" type="button" ${operation.cancelling ? "disabled" : ""}>${operation.cancelling ? "Cancelling…" : "Cancel update"}</button>` : '<button class="secondary-button" id="remote-dialog-cancel" type="button">Cancel</button>'}<button class="primary-button" id="remote-dialog-confirm-update" type="button" aria-label="Update ${escapeAttribute(source)} from ${escapeAttribute(`${remote}:${destination}`)} using fast-forward only" ${operation || !policy.pull.enabled ? "disabled" : ""}>${busyLabel}</button></div>
  </section>`;
}

function renderPushDialog(model: RemotePushDialogViewModel): string {
  const { snapshot, state } = model;
  const preview = state.pushPreview;
  const operation = state.operation?.kind === "push" ? state.operation : null;
  const error = state.dialogError ? `<div class="remote-dialog-error" role="alert">${escapeHtml(state.dialogError)}</div>` : "";
  const body = preview
    ? renderPushPreviewBody(model, preview)
    : state.pushPreviewLoading
      ? '<div class="remote-dialog-loading" role="status"><span class="spinner"></span><span>Reading outgoing commits, tags, and files from the last-fetched refs…</span></div>'
      : '<div class="remote-dialog-empty">Push preview is unavailable. Close this window and refresh before retrying.</div>';
  const route = preview ? `${preview.sourceRef} to ${preview.remote}:${preview.destinationRef}` : "the selected current-branch route";
  const forceSelected = state.pushMode === "forceWithLease";
  const modeAllowed = Boolean(preview && (forceSelected ? preview.forceWithLeaseAllowed : preview.ordinaryAllowed));
  const actionable = Boolean(preview && (preview.publish || preview.totalCommits > 0 || preview.tags.length > 0 || (forceSelected && preview.comparisonBaseOid !== preview.headOid)));
  const modeBlocker = preview ? forceSelected ? preview.forceWithLeaseBlockReason : preview.ordinaryBlockReason : null;
  const actionLabel = forceSelected ? "Force Push with Lease" : preview?.publish ? "Publish" : "Push";
  const tagsLabel = preview?.tags.length ? `${preview.tags.length} tag${preview.tags.length === 1 ? "" : "s"}` : "No matching tags";
  const confirmation = pushConfirmationAvailability({ operationActive: Boolean(operation), previewLoading: state.pushPreviewLoading, previewRefreshing: state.pushPreviewRefreshing, actionable, modeAllowed });
  return `<section class="dialog remote-action-dialog push-dialog" role="dialog" aria-modal="${state.pushDiff ? "false" : "true"}" aria-labelledby="remote-dialog-title" aria-describedby="remote-dialog-description" ${state.pushDiff ? 'aria-hidden="true" inert' : ""}>
    <div class="dialog-heading"><div><h2 id="remote-dialog-title">Push Commits to ${escapeHtml(snapshot.branch.head ?? "current branch")}</h2></div><button class="icon-button" id="remote-dialog-close" type="button" aria-label="Cancel Push confirmation" title="Cancel" ${operation ? "disabled" : ""}>${icon("close", 18)}</button></div>
    <p id="remote-dialog-description" class="visually-hidden">Review the exact current-branch route, outgoing commits, aggregate changed files, optional tags, and push mode before writing to the selected remote.</p>${error}${renderPushRoute(snapshot, state, preview)}${body}${modeBlocker ? `<div class="remote-dialog-warning" role="status">${escapeHtml(modeBlocker)}</div>` : ""}
    <p class="remote-dialog-note">${forceSelected ? "Force Push uses an exact --force-with-lease bound to the last-fetched destination object. If the remote changed, Git rejects the push." : "Ordinary Push never rewrites the destination."} Tags are sent only when the checkbox is enabled. A rejection ends the operation; Asterlyn never retries automatically.</p>
    <div class="push-dialog-footer"><div class="push-tags-control"><label><input id="push-tags-enabled" type="checkbox" ${state.pushTagsEnabled ? "checked" : ""} ${operation ? "disabled" : ""}/><span>Push tags:</span></label><select id="push-tag-mode" aria-label="Tag scope" ${!state.pushTagsEnabled || operation ? "disabled" : ""}><option value="all" ${state.pushTagMode === "all" ? "selected" : ""}>All</option><option value="currentBranch" ${state.pushTagMode === "currentBranch" ? "selected" : ""}>Current Branch</option></select><span class="push-tag-count" aria-live="polite">${state.pushPreviewRefreshing ? '<span class="spinner" aria-hidden="true"></span> Refreshing review…' : state.pushTagsEnabled && preview ? escapeHtml(tagsLabel) : ""}</span></div>
      <div class="push-dialog-actions">${operation ? `<button class="secondary-button" id="remote-dialog-cancel-operation" type="button" ${operation.cancelling ? "disabled" : ""}>${operation.cancelling ? "Cancelling…" : "Cancel push"}</button>` : '<button class="secondary-button" id="remote-dialog-cancel" type="button">Cancel</button>'}<div class="push-split-action"><button class="primary-button push-primary-action" id="remote-dialog-confirm-push" type="button" aria-label="${escapeAttribute(actionLabel)} ${preview?.totalCommits ?? 0} outgoing commits and ${preview?.tags.length ?? 0} selected tags over ${escapeAttribute(route)}" aria-disabled="${confirmation.ariaDisabled}" data-refreshing="${state.pushPreviewRefreshing}" ${confirmation.nativeDisabled ? "disabled" : ""}>${operation?.cancelling ? "Cancelling…" : operation ? "Pushing…" : actionLabel}</button><button class="primary-button push-mode-toggle" id="push-mode-toggle" type="button" aria-label="Choose Push mode" aria-haspopup="menu" aria-expanded="${state.pushModeMenuOpen}" ${operation || !preview ? "disabled" : ""}>${icon("chevron-down", 13)}</button><div class="push-mode-menu ${state.pushModeMenuOpen ? "" : "hidden"}" role="menu" aria-label="Push mode"><button type="button" role="menuitemradio" data-push-mode="ordinary" aria-checked="${!forceSelected}" ${preview?.ordinaryAllowed ? "" : "disabled"}><span><strong>Push</strong><small>Ordinary non-force update</small></span>${!forceSelected ? icon("check", 13) : ""}</button><button type="button" role="menuitemradio" data-push-mode="forceWithLease" aria-checked="${forceSelected}" ${preview?.forceWithLeaseAllowed ? "" : "disabled"}><span><strong>Force Push with Lease</strong><small>Rewrite only if the remote still matches the reviewed object</small></span>${forceSelected ? icon("check", 13) : ""}</button></div></div></div>
    </div>
  </section>`;
}

function renderPushRoute(snapshot: RepositorySnapshot, state: RemotePushState, preview: PushPreview | null): string {
  const branch = snapshot.branch.head ?? "current branch";
  const selectedRemote = preview?.remote ?? state.selectedRemote ?? "";
  const destination = preview?.destinationRef ?? `refs/heads/${branch}`;
  const destinationBranch = destination.replace(/^refs\/heads\//, "");
  const outgoingCount = preview?.totalCommits ?? 0;
  const options = snapshot.remotes.map((remote) => `<option value="${escapeAttribute(remote.name)}" ${remote.name === selectedRemote ? "selected" : ""} ${remote.pushSupported ? "" : "disabled"}>${escapeHtml(remote.name)}${remote.pushSupported ? "" : " · unsupported"}</option>`).join("");
  return `<div class="push-route-row" aria-label="Push route from local branch ${escapeAttribute(branch)} to remote branch ${escapeAttribute(`${selectedRemote}/${destinationBranch}`)}"><button class="push-route-endpoint push-route-scope ${state.pushSelectedCommit ? "" : "selected"}" id="push-all-commits" type="button" aria-pressed="${state.pushSelectedCommit === null}" title="Show files changed by all outgoing commits"><span class="push-route-kind">Local branch</span><span class="push-route-name">${icon("branch", 14)}<strong>${escapeHtml(branch)}</strong></span><small>${outgoingCount} outgoing commit${outgoingCount === 1 ? "" : "s"} · show all files</small></button><span class="push-route-arrow" aria-hidden="true"><small>Push</small><strong>→</strong></span><label class="push-route-endpoint push-remote-target"><span class="push-route-kind">Remote branch</span><span class="push-route-name push-route-destination">${icon("upload", 14)}<select id="push-remote-select" aria-label="Push remote" ${state.pushPreviewRefreshing || state.operation ? "disabled" : ""}>${options}</select><span class="push-route-separator">/</span><strong>${escapeHtml(destinationBranch)}</strong></span><small>Selected destination for this push</small></label></div>`;
}

function renderPushPreviewBody(model: RemotePushDialogViewModel, preview: PushPreview): string {
  const { state } = model;
  const commits = preview.commits.length
    ? preview.commits.map((commit) => { const selected = state.pushSelectedCommit === commit.oid; return `<button class="push-commit-row ${selected ? "selected" : ""}" type="button" role="option" data-push-commit="${escapeAttribute(commit.oid)}" aria-selected="${selected}" aria-pressed="${selected}" title="${escapeAttribute(commit.oid)}"><span>${escapeHtml(commit.subject)}</span><small>${escapeHtml(commit.authorName)} · ${escapeHtml(formatAbsolute(commit.authoredAt))}</small></button>`; }).join("")
    : `<div class="remote-dialog-empty">No new commit objects are visible against the selected remote's last-fetched refs.${preview.publish ? " Publishing will still create the destination branch." : ""}</div>`;
  const reviewFiles = pushReviewFiles(preview, state);
  const files = renderPushFiles(model, preview, reviewFiles);
  const fileScope = state.pushSelectedCommit ? "Files in selected commit" : "Files in all outgoing commits";
  return `<div class="push-preview-grid"><section class="push-preview-commits" aria-labelledby="push-commits-title"><div class="push-preview-pane-heading"><h3 id="push-commits-title">Outgoing commits</h3><span>${preview.commits.length}/${preview.totalCommits}</span></div><div class="push-commit-list" role="listbox" aria-label="Outgoing commits; activate the selected commit again to show all outgoing files">${commits}</div>${preview.hasMore ? `<button class="secondary-button push-load-more" id="push-load-more" type="button" ${state.pushPreviewLoadingMore ? "disabled" : ""}>${state.pushPreviewLoadingMore ? "Loading…" : "Show more"}</button>` : preview.truncated ? `<p class="push-preview-limit">Showing the first 1,000 of ${preview.totalCommits} commits. Push includes all ${preview.totalCommits}.</p>` : ""}</section><section class="push-preview-files" aria-labelledby="push-files-title"><div class="push-preview-pane-heading push-files-heading"><h3 id="push-files-title">${fileScope}</h3><span>${reviewFiles.length}${preview.filesTruncated && !state.pushSelectedCommit ? "+" : ""}</span>${pushFileToolbar(model, Boolean(state.pushSelectedFile))}</div><div class="push-file-list" role="tree">${files}</div></section></div>`;
}

function renderPushFiles(model: RemotePushDialogViewModel, preview: PushPreview, reviewFiles: CommitFileChange[]): string {
  const { state } = model;
  if (state.pushCommitDetailsLoading) return '<div class="remote-dialog-loading compact" role="status"><span class="spinner"></span><span>Reading files in the selected commit…</span></div>';
  if (state.pushCommitDetailsError) return `<div class="remote-dialog-empty error">${escapeHtml(state.pushCommitDetailsError)}</div>`;
  if (!reviewFiles.length) return `<div class="remote-dialog-empty">${preview.filesTruncated && !state.pushSelectedCommit ? "The pushed file range exceeded the bounded review limit." : state.pushSelectedCommit ? "No files are reported for the selected commit." : "No net file changes are present in the reviewed range."}</div>`;
  if (state.pushFileView === "flat") return reviewFiles.map((file) => pushFileRow(file, file.path === state.pushSelectedFile, null)).join("");
  const rootExpanded = !state.pushCollapsedFileDirectories.has(".");
  return `<details class="push-file-directory push-file-root" data-push-directory="." ${rootExpanded ? "open" : ""}><summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<strong>${escapeHtml(basename(model.workspaceRoot ?? preview.branch))}</strong><small>${reviewFiles.length} file${reviewFiles.length === 1 ? "" : "s"}</small></summary><div role="group">${rootExpanded ? buildCommitFileTree(reviewFiles).map((node) => renderPushFileTreeNode(node, 1, state)).join("") : ""}</div></details>`;
}

function pushFileToolbar(model: RemotePushDialogViewModel, selected: boolean): string {
  const { state } = model;
  return `<div class="push-file-toolbar" role="toolbar" aria-label="Pushed file presentation and navigation"><button class="compact-icon-button" type="button" data-push-file-action="diff" title="Open the latest outgoing commit Diff for the selected file" aria-label="Open the latest outgoing commit Diff for the selected file" ${selected && !state.pushFileActionLoading ? "" : "disabled"}>${state.pushFileActionLoading ? '<span class="spinner"></span>' : icon("diff", 14)}</button><button class="compact-icon-button" type="button" data-push-file-action="open" title="Open selected file and reveal it in Project" aria-label="Open selected file and reveal it in Project" ${selected && model.selectedProjectFileAvailable ? "" : "disabled"}>${icon("locate", 14)}</button><button class="compact-icon-button ${state.pushFileView === "tree" ? "active" : ""}" type="button" data-push-file-action="view" title="Show pushed files as ${state.pushFileView === "tree" ? "a flat list" : "a folder tree"}" aria-label="Show pushed files as ${state.pushFileView === "tree" ? "a flat list" : "a folder tree"}" aria-pressed="${state.pushFileView === "tree"}">${icon("eye", 14)}</button><button class="compact-icon-button" type="button" data-push-file-action="expand" title="Expand all pushed file folders" aria-label="Expand all pushed file folders" ${state.pushFileView === "flat" ? "disabled" : ""}>${icon("expand", 14)}</button><button class="compact-icon-button" type="button" data-push-file-action="collapse" title="Collapse all pushed file folders" aria-label="Collapse all pushed file folders" ${state.pushFileView === "flat" ? "disabled" : ""}>${icon("collapse", 14)}</button></div>`;
}

function renderPushFileTreeNode(node: CommitFileTreeNode, depth: number, state: RemotePushState): string {
  if (node.kind === "directory") {
    const expanded = !state.pushCollapsedFileDirectories.has(node.path);
    return `<details class="push-file-directory" data-push-directory="${escapeAttribute(node.path)}" ${expanded ? "open" : ""}><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(node.name)}</span><small>${countCommitTreeFiles(node)}</small></summary><div role="group">${expanded ? node.children.map((child) => renderPushFileTreeNode(child, depth + 1, state)).join("") : ""}</div></details>`;
  }
  const file = node.file!;
  return pushFileRow(file, file.path === state.pushSelectedFile, depth);
}

function pushFileRow(file: CommitFileChange, selected: boolean, depth: number | null): string {
  return `<button class="push-file-row file-status-${file.status} ${selected ? "selected" : ""}" type="button" role="treeitem" ${depth === null ? "" : `style="--tree-depth:${depth}"`} data-push-file="${escapeAttribute(file.path)}" aria-selected="${selected}" title="${escapeAttribute(file.path)}"><span class="change-status status-${file.status}">${changeCode(file.status)}</span><span class="commit-file-glyph">${fileTypeIcon(file.path)}</span><span>${escapeHtml(basename(file.path))}</span>${depth === null ? `<small>${escapeHtml(dirname(file.path))}</small>` : ""}</button>`;
}

function renderPushDiffDialog(model: RemotePushDialogViewModel): string {
  const { state, preferences } = model;
  const diff = state.pushDiff;
  if (!diff) return "";
  const paths = state.pushPreview
    ? pushReviewFiles(state.pushPreview, state).map((file) => file.path)
    : [];
  const index = paths.indexOf(diff.file.path);
  const hasPrevious = index > 0;
  const hasNext = index >= 0 && index < paths.length - 1;
  const image = isImagePreviewPath(diff.file.path);
  const body = diff.loading
    ? loadingBlock("Loading pushed file Diff…")
    : diff.error
      ? `<div class="remote-dialog-empty error" role="alert">${escapeHtml(diff.error)}</div>`
      : diff.image
        ? `<section class="image-diff-surface" aria-label="Image Diff">${diff.image.before ? imagePreviewCard(diff.image.before, "Before") : emptyImageSide("Before", "File did not exist")}${diff.image.after ? imagePreviewCard(diff.image.after, "After") : emptyImageSide("After", "File was removed")}</section>`
        : '<div class="push-diff-editor-host" id="push-diff-editor-host"></div>';
  return `<div class="push-diff-backdrop" id="push-diff-backdrop" role="presentation"><section class="dialog push-diff-dialog" role="dialog" aria-modal="true" aria-labelledby="push-diff-title"><div class="dialog-heading push-diff-heading"><div><h2 id="push-diff-title">${escapeHtml(basename(diff.file.path))}</h2><small>${escapeHtml(diff.file.path)}${diff.oid ? ` · ${escapeHtml(diff.oid.slice(0, 8))}` : ""}</small></div><button class="icon-button" id="push-diff-close" type="button" aria-label="Close pushed file Diff" title="Close">${icon("close", 18)}</button></div><div class="diff-toolbar push-diff-toolbar" aria-label="Pushed file Diff navigation and presentation"><div class="diff-navigation-controls" role="group" aria-label="Diff navigation"><button class="compact-icon-button" type="button" data-push-diff-action="previous-change" aria-label="Previous change in file" title="Previous change in file" ${!diff.patch ? "disabled" : ""}>${icon("up", 15)}</button><button class="compact-icon-button" type="button" data-push-diff-action="next-change" aria-label="Next change in file" title="Next change in file" ${!diff.patch ? "disabled" : ""}>${icon("down", 15)}</button><span class="diff-control-separator" aria-hidden="true"></span><button class="compact-icon-button" type="button" data-push-diff-action="previous-file" aria-label="Previous pushed file" title="Previous pushed file" ${hasPrevious ? "" : "disabled"}>${icon("back", 15)}</button><button class="compact-icon-button" type="button" data-push-diff-action="next-file" aria-label="Next pushed file" title="Next pushed file" ${hasNext ? "" : "disabled"}>${icon("forward", 15)}</button><button class="compact-icon-button" type="button" data-push-diff-action="open-source" aria-label="Open file and reveal in Project" title="Open file and reveal in Project" ${model.selectedProjectFileAvailable ? "" : "disabled"}>${icon("locate", 15)}</button><button class="compact-icon-button ${diff.expandedUnchanged ? "active" : ""}" type="button" data-push-diff-action="toggle-unchanged" aria-label="${diff.expandedUnchanged ? "Collapse" : "Expand"} unchanged lines" title="${diff.expandedUnchanged ? "Collapse" : "Expand"} unchanged lines" aria-pressed="${diff.expandedUnchanged}" ${!diff.patch ? "disabled" : ""}>${icon(diff.expandedUnchanged ? "collapse" : "expand", 15)}</button></div>${image ? "" : `<div class="diff-controls" role="group" aria-label="Diff presentation"><button type="button" data-push-diff-layout="unified" aria-pressed="${preferences.diffLayout === "unified"}" title="Unified diff">Unified</button><button type="button" data-push-diff-layout="split" aria-pressed="${preferences.diffLayout === "split"}" title="Side-by-side diff">Split</button><button type="button" data-push-diff-whitespace aria-pressed="${preferences.showWhitespace}" title="Show whitespace characters">Whitespace</button></div>`}</div><div class="push-diff-body ${image ? "image-surface" : "diff-surface"}" id="push-diff-body">${body}</div></section></div>`;
}

function imagePreviewCard(image: ImagePreview, label: string): string {
  return `<figure class="image-preview-card"><figcaption><strong>${label}</strong><span>${escapeHtml(image.mediaType)} · ${formatBytes(image.byteLength)}${image.width && image.height ? ` · ${image.width}×${image.height}` : ""}</span></figcaption><div class="image-preview-stage"><img src="${escapeAttribute(image.dataUrl)}" alt="${escapeAttribute(label)} image preview" /></div></figure>`;
}

function emptyImageSide(label: string, message: string): string {
  return `<figure class="image-preview-card empty"><figcaption><strong>${escapeHtml(label)}</strong></figcaption><div class="image-preview-stage"><span>${escapeHtml(message)}</span></div></figure>`;
}

function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

function countCommitTreeFiles(node: CommitFileTreeNode): number {
  return node.kind === "file" ? 1 : node.children.reduce((count, child) => count + countCommitTreeFiles(child), 0);
}

function changeCode(kind: ChangeKind): string {
  const codes: Record<ChangeKind, string> = {
    unmodified: "·",
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    copied: "C",
    typeChanged: "T",
    unmerged: "U",
    untracked: "?",
    ignored: "!",
    unknown: "·",
  };
  return codes[kind];
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function formatAbsolute(epochSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(epochSeconds * 1000));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function compactCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function remoteActionLabel(kind: "fetch" | "pull" | "push"): string {
  return kind === "fetch" ? "Fetch" : kind === "pull" ? "Update" : "Push";
}

function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required remote UI element: ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
