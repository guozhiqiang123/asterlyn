import { fileTypeIcon } from "../../file-icons.ts";
import { icon } from "../../icons.ts";
import { renderSelectControl } from "../../shared/select-control.ts";
import { DEFAULT_LOCALIZATION, type Localization } from "../../localization/localization.ts";
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
import type { RemoteAuthenticationState } from "./remote-authentication-controller.ts";
import type { RemotePushState } from "./remote-push-state.ts";

export interface RemotePushDialogViewModel {
  readonly snapshot: RepositorySnapshot;
  readonly state: RemotePushState;
  readonly workspaceRoot: string | null;
  readonly preferences: AppPreferences;
  readonly selectedProjectFileAvailable: boolean;
  readonly authentication?: RemoteAuthenticationState;
  readonly localization?: Localization;
}

export function renderRemoteToolbarView(
  root: ParentNode,
  snapshot: RepositorySnapshot | null,
  state: RemotePushState,
  loading: boolean,
  localization: Localization = DEFAULT_LOCALIZATION,
  menuOpen = false,
): void {
  const toolbar = query(root, "#remote-toolbar");
  const select = query<HTMLSelectElement>(root, "#topbar-remote-select");
  const cancel = query<HTMLButtonElement>(root, "#cancel-remote-operation");
  const menuToggle = query<HTMLButtonElement>(root, "#remote-toolbar-menu-toggle");
  const menu = query(root, "#remote-toolbar-menu");
  menuToggle.setAttribute("aria-expanded", String(menuOpen));
  menu.classList.toggle("hidden", !menuOpen);
  toolbar.classList.toggle("git-unavailable", !snapshot);
  if (!snapshot) {
    renderUnavailableToolbar(root, select, cancel, localization);
    return;
  }

  const copy = localization.catalog.remote;
  const policy = remotePolicy(snapshot, state.selectedRemote, localization);
  const operation = state.operation?.root === snapshot.root ? state.operation : null;
  select.innerHTML = snapshot.remotes.length
    ? snapshot.remotes.map((remote) => `<option value="${escapeAttribute(remote.name)}" ${remote.name === policy.selectedRemote?.name ? "selected" : ""}>${escapeHtml(remote.name)}${remote.fetchSupported ? "" : ` · ${escapeHtml(copy.unsupported)}`}</option>`).join("")
    : `<option>${escapeHtml(copy.noRemote)}</option>`;
  select.disabled = Boolean(operation) || loading || snapshot.remotes.length === 0;

  const branchName = snapshot.branch.head ?? copy.noBranch;
  const selectedName = policy.selectedRemote?.name ?? copy.noRemote;
  const sourceRef = snapshot.branch.head ? `refs/heads/${snapshot.branch.head}` : copy.noCheckedOutBranch;
  const destinationRef = snapshot.branch.upstreamRef ?? sourceRef;
  const remoteScope = copy.selectedRemoteScope(selectedName);
  select.title = remoteScope;
  select.setAttribute("aria-label", remoteScope);
  const tracksSelected = snapshot.branch.upstreamRemote === policy.selectedRemote?.name;
  const actions = [
    { kind: "fetch", button: "#remote-fetch", hint: null, policy: policy.fetch, iconName: "download", menuItem: true },
    { kind: "pull", button: "#remote-update", hint: "#remote-update-hint", policy: policy.pull, iconName: "download", menuItem: false },
    { kind: "push", button: "#remote-push", hint: "#remote-push-hint", policy: policy.push, iconName: "upload", menuItem: false },
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
      localization,
    );
    const transientBlock = operation
      ? copy.operationInProgress(copy.actionNames[operation.kind])
      : loading
        ? copy.workbenchBusy
        : null;
    const policyDetail = action.policy.enabled
      ? action.policy.detail
      : copy.unavailable(action.policy.detail);
    const title = `${exactScope} ${transientBlock ? copy.unavailable(transientBlock) : policyDetail}`;
    const unavailable = Boolean(operation) || loading || !action.policy.enabled;
    button.disabled = false;
    button.setAttribute("aria-disabled", String(unavailable));
    button.classList.toggle("unavailable", unavailable);
    button.title = title;
    button.setAttribute("aria-label", title);
    button.classList.toggle("running", operation?.kind === action.kind);
    const visual = operation?.kind === action.kind && !operation.cancelling
      ? '<span class="spinner" aria-hidden="true"></span>'
      : `${icon(action.iconName, action.menuItem ? 17 : 18)}${remoteCountBadge(action.kind, snapshot, tracksSelected)}`;
    button.innerHTML = action.menuItem
      ? `${visual}<span>${escapeHtml(action.policy.label)}</span>`
      : visual;
    if (action.hint) {
      const hint = query<HTMLElement>(root, action.hint);
      hint.title = title;
      hint.setAttribute("aria-label", title);
    }
  }

  cancel.classList.toggle("hidden", !operation);
  cancel.disabled = !operation || operation.cancelling;
  cancel.title = operation
    ? copy.cancelOperation(copy.actionNames[operation.kind], branchName, selectedName)
    : copy.cancelRemoteOperation;
  cancel.setAttribute("aria-label", cancel.title);
}

export function renderRemoteDialogContent(model: RemotePushDialogViewModel): string {
  const body = model.state.dialog === "update"
    ? renderUpdateDialog(model)
    : `${renderPushDialog(model)}${renderPushDiffDialog(model)}`;
  return `${body}${renderRemoteAuthenticationDialog(model)}`;
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
  localization: Localization,
): void {
  const copy = localization.catalog.remote;
  select.innerHTML = `<option>${escapeHtml(copy.noRemote)}</option>`;
  select.disabled = true;
  select.title = copy.selectionUnavailable;
  select.setAttribute("aria-label", select.title);
  cancel.classList.add("hidden");
  const unavailable = [
    ["#remote-fetch", copy.fetchUnavailable],
    ["#remote-update", copy.updateUnavailable],
    ["#remote-push", copy.pushUnavailable],
  ] as const;
  for (const [selector, description] of unavailable) {
    const button = query<HTMLButtonElement>(root, selector);
    button.disabled = false;
    button.setAttribute("aria-disabled", "true");
    button.classList.add("unavailable");
    button.title = description;
    button.setAttribute("aria-label", description);
    const hint = button.closest<HTMLElement>(".topbar-remote-action");
    hint?.setAttribute("aria-label", description);
    if (hint) {
      hint.title = description;
    }
    if (selector === "#remote-fetch") {
      button.innerHTML = `${icon("download", 17)}<span>${escapeHtml(copy.actionNames.fetch)}</span>`;
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
  localization: Localization,
): string {
  const copy = localization.catalog.remote;
  if (kind === "fetch") {
    const behind = tracksSelected ? snapshot.branch.behind : 0;
    return copy.fetchDescription(selectedName, behind);
  }
  if (kind === "pull") {
    return copy.updateDescription(sourceRef, selectedName, destinationRef);
  }
  const ahead = tracksSelected ? snapshot.branch.ahead : 0;
  return copy.pushDescription(sourceRef, selectedName, destinationRef, ahead);
}

function remoteCountBadge(
  kind: "fetch" | "pull" | "push",
  snapshot: RepositorySnapshot,
  tracksSelected: boolean,
): string {
  if (kind === "pull" && tracksSelected && snapshot.branch.behind > 0) {
    return `<span class="remote-count-badge" aria-hidden="true">${compactCount(snapshot.branch.behind)}</span>`;
  }
  if (kind === "push" && tracksSelected && snapshot.branch.ahead > 0) {
    return `<span class="remote-count-badge" aria-hidden="true">${compactCount(snapshot.branch.ahead)}</span>`;
  }
  return "";
}

function renderUpdateDialog(model: RemotePushDialogViewModel): string {
  const { snapshot, state } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  const policy = remotePolicy(snapshot, state.selectedRemote, localization);
  const remote = policy.selectedRemote?.name ?? copy.noRemote;
  const branch = snapshot.branch.head ?? copy.noBranch;
  const source = snapshot.branch.head ? `refs/heads/${snapshot.branch.head}` : copy.noBranch;
  const destination = snapshot.branch.upstreamRef ?? copy.noUpstream;
  const operation = state.operation?.kind === "pull" ? state.operation : null;
  const strategy = state.updateStrategy;
  const strategyLabel = copy.strategies[strategy];
  const busyLabel = operation?.cancelling
    ? copy.cancelling
    : operation
      ? copy.updating
      : strategy === "ffOnly"
        ? copy.update
        : copy.fetchAndReview(strategyLabel);
  const error = state.dialogError ? renderRemoteError(state.dialogError, localization) : "";
  return `<section class="dialog remote-action-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-dialog-title" aria-describedby="remote-dialog-description">
    <div class="dialog-heading"><div><span class="panel-eyebrow">${escapeHtml(copy.currentBranch)}</span><h2 id="remote-dialog-title">${escapeHtml(copy.updateBranch(branch))}</h2></div><button class="icon-button" id="remote-dialog-close" type="button" aria-label="${escapeAttribute(copy.cancelUpdateConfirmation)}" title="${escapeAttribute(localization.catalog.common.cancel)}" ${operation ? "disabled" : ""}>${icon("close", 18)}</button></div>
    <p id="remote-dialog-description">${escapeHtml(copy.updateDescriptionText)}</p>
    <div class="remote-dialog-route" aria-label="${escapeAttribute(copy.updateRoute)}"><code>${escapeHtml(source)}</code><span>←</span><code>${escapeHtml(`${remote}:${destination}`)}</code></div>
    ${error}
    <fieldset class="remote-strategy-list" ${operation ? "disabled" : ""}><legend>${escapeHtml(copy.updateMethod)}</legend><label class="remote-strategy-card ${strategy === "ffOnly" ? "selected" : ""} ${snapshot.branch.ahead > 0 && snapshot.branch.behind > 0 ? "unavailable" : ""}"><input type="radio" name="update-strategy" value="ffOnly" ${strategy === "ffOnly" ? "checked" : ""} ${snapshot.branch.ahead > 0 && snapshot.branch.behind > 0 ? "disabled" : ""}/><span><strong>${escapeHtml(copy.fastForwardOnly)}</strong><small>${escapeHtml(copy.fastForwardDetail)}</small></span></label><label class="remote-strategy-card ${strategy === "merge" ? "selected" : ""}"><input type="radio" name="update-strategy" value="merge" ${strategy === "merge" ? "checked" : ""}/><span><strong>${escapeHtml(copy.mergeIncoming)}</strong><small>${escapeHtml(copy.mergeIncomingDetail)}</small></span></label><label class="remote-strategy-card ${strategy === "rebase" ? "selected" : ""} ${snapshot.branch.ahead === 0 ? "unavailable" : ""}"><input type="radio" name="update-strategy" value="rebase" ${strategy === "rebase" ? "checked" : ""} ${snapshot.branch.ahead === 0 ? "disabled" : ""}/><span><strong>${escapeHtml(copy.rebaseCurrent)}</strong><small>${escapeHtml(copy.rebaseCurrentDetail)}</small></span></label></fieldset>
    <p class="remote-dialog-note">${escapeHtml(copy.updateSafetyNote)}</p>
    <div class="dialog-actions">${operation ? `<button class="secondary-button" id="remote-dialog-cancel-operation" type="button" ${operation.cancelling ? "disabled" : ""}>${escapeHtml(operation.cancelling ? copy.cancelling : copy.cancelUpdate)}</button>` : `<button class="secondary-button" id="remote-dialog-cancel" type="button">${escapeHtml(localization.catalog.common.cancel)}</button>`}<button class="primary-button" id="remote-dialog-confirm-update" type="button" aria-label="${escapeAttribute(strategy === "ffOnly" ? copy.updateFastForwardAria(source, remote, destination) : copy.updateReviewAria(remote, strategyLabel, destination, source))}" ${operation || !policy.pull.enabled ? "disabled" : ""}>${escapeHtml(busyLabel)}</button></div>
  </section>`;
}

function renderPushDialog(model: RemotePushDialogViewModel): string {
  const { snapshot, state } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  const preview = state.pushPreview;
  const operation = state.operation?.kind === "push" ? state.operation : null;
  const authentication = model.authentication;
  const authenticationDialogOpen = Boolean(authentication?.dialog);
  const authenticationChecking = Boolean(authentication?.checking);
  const dialogError = state.dialogError ?? (!authenticationDialogOpen ? authentication?.error : null);
  const error = dialogError ? renderRemoteError(dialogError, localization) : "";
  const body = preview
    ? renderPushPreviewBody(model, preview)
    : state.pushPreviewLoading
      ? `<div class="remote-dialog-loading" role="status"><span class="spinner"></span><span>${escapeHtml(copy.readingPushPreview)}</span></div>`
      : `<div class="remote-dialog-empty">${escapeHtml(copy.pushPreviewUnavailable)}</div>`;
  const route = preview ? copy.route(preview.sourceRef, preview.remote, preview.destinationRef) : copy.selectedRoute;
  const forceSelected = state.pushMode === "forceWithLease";
  const modeAllowed = Boolean(preview && (forceSelected ? preview.forceWithLeaseAllowed : preview.ordinaryAllowed));
  const actionable = Boolean(preview && (preview.publish || preview.totalCommits > 0 || preview.tags.length > 0 || (forceSelected && preview.comparisonBaseOid !== preview.headOid)));
  const modeBlocker = preview ? forceSelected ? preview.forceWithLeaseBlockReason : preview.ordinaryBlockReason : null;
  const actionLabel = forceSelected ? copy.forcePushWithLease : preview?.publish ? copy.publish : copy.push;
  const tagsLabel = preview?.tags.length ? copy.tags(preview.tags.length) : copy.noMatchingTags;
  const confirmation = pushConfirmationAvailability({ operationActive: Boolean(operation) || authenticationChecking, previewLoading: state.pushPreviewLoading, previewRefreshing: state.pushPreviewRefreshing, actionable, modeAllowed });
  return `<section class="dialog remote-action-dialog push-dialog" role="dialog" aria-modal="${state.pushDiff || authenticationDialogOpen ? "false" : "true"}" aria-labelledby="remote-dialog-title" aria-describedby="remote-dialog-description" ${state.pushDiff || authenticationDialogOpen ? 'aria-hidden="true" inert' : ""}>
    <div class="dialog-heading"><div><h2 id="remote-dialog-title">${escapeHtml(copy.pushCommitsTo(snapshot.branch.head ?? copy.currentBranchFallback))}</h2></div><button class="icon-button" id="remote-dialog-close" type="button" aria-label="${escapeAttribute(copy.cancelPushConfirmation)}" title="${escapeAttribute(localization.catalog.common.cancel)}" ${operation ? "disabled" : ""}>${icon("close", 18)}</button></div>
    <p id="remote-dialog-description" class="visually-hidden">${escapeHtml(copy.pushReviewDescription)}</p>${error}${renderPushRoute(model, preview)}${body}${modeBlocker ? `<div class="remote-dialog-warning" role="status">${escapeHtml(localization.catalog.errors.translate(modeBlocker))}</div>` : ""}
    <p class="remote-dialog-note">${escapeHtml(forceSelected ? copy.forcePushNote : copy.ordinaryPushNote)} ${escapeHtml(copy.tagsAndRetryNote)}</p>
    <div class="push-dialog-footer"><div class="push-tags-control"><label><input id="push-tags-enabled" type="checkbox" ${state.pushTagsEnabled ? "checked" : ""} ${operation ? "disabled" : ""}/><span>${escapeHtml(copy.pushTags)}</span></label>${renderSelectControl(`<select id="push-tag-mode" aria-label="${escapeAttribute(copy.tagScope)}" ${!state.pushTagsEnabled || operation ? "disabled" : ""}><option value="all" ${state.pushTagMode === "all" ? "selected" : ""}>${escapeHtml(copy.all)}</option><option value="currentBranch" ${state.pushTagMode === "currentBranch" ? "selected" : ""}>${escapeHtml(copy.currentBranch)}</option></select>`)}<span class="push-tag-count" aria-live="polite">${state.pushPreviewRefreshing ? `<span class="spinner" aria-hidden="true"></span> ${escapeHtml(copy.refreshingReview)}` : state.pushTagsEnabled && preview ? escapeHtml(tagsLabel) : ""}</span></div>
      <div class="push-dialog-actions">${operation ? `<button class="secondary-button" id="remote-dialog-cancel-operation" type="button" ${operation.cancelling ? "disabled" : ""}>${escapeHtml(operation.cancelling ? copy.cancelling : copy.cancelPush)}</button>` : `<button class="secondary-button" id="remote-dialog-cancel" type="button">${escapeHtml(localization.catalog.common.cancel)}</button>`}<div class="push-split-action"><button class="primary-button push-primary-action" id="remote-dialog-confirm-push" type="button" aria-label="${escapeAttribute(copy.pushConfirmationAria(actionLabel, preview?.totalCommits ?? 0, preview?.tags.length ?? 0, route))}" aria-disabled="${confirmation.ariaDisabled}" data-refreshing="${state.pushPreviewRefreshing}" ${confirmation.nativeDisabled ? "disabled" : ""}>${escapeHtml(operation?.cancelling ? copy.cancelling : operation ? copy.pushing : authenticationChecking ? copy.checkingAuthentication : actionLabel)}</button><button class="primary-button push-mode-toggle" id="push-mode-toggle" type="button" aria-label="${escapeAttribute(copy.choosePushMode)}" aria-haspopup="menu" aria-expanded="${state.pushModeMenuOpen}" ${operation || authenticationChecking || !preview ? "disabled" : ""}>${icon("chevron-down", 13)}</button><div class="push-mode-menu ${state.pushModeMenuOpen ? "" : "hidden"}" role="menu" aria-label="${escapeAttribute(copy.pushMode)}"><button type="button" role="menuitemradio" data-push-mode="ordinary" aria-checked="${!forceSelected}" ${preview?.ordinaryAllowed ? "" : "disabled"}><span><strong>${escapeHtml(copy.push)}</strong><small>${escapeHtml(copy.ordinaryNonForce)}</small></span>${!forceSelected ? icon("check", 13) : ""}</button><button type="button" role="menuitemradio" data-push-mode="forceWithLease" aria-checked="${forceSelected}" ${preview?.forceWithLeaseAllowed ? "" : "disabled"}><span><strong>${escapeHtml(copy.forcePushWithLease)}</strong><small>${escapeHtml(copy.forceLeaseDetail)}</small></span>${forceSelected ? icon("check", 13) : ""}</button></div></div></div>
    </div>
  </section>`;
}

function renderPushRoute(model: RemotePushDialogViewModel, preview: PushPreview | null): string {
  const { snapshot, state } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  const branch = snapshot.branch.head ?? "current branch";
  const selectedRemote = preview?.remote ?? state.selectedRemote ?? "";
  const destination = preview?.destinationRef ?? `refs/heads/${branch}`;
  const destinationBranch = destination.replace(/^refs\/heads\//, "");
  const outgoingCount = preview?.totalCommits ?? 0;
  const options = snapshot.remotes.map((remote) => `<option value="${escapeAttribute(remote.name)}" ${remote.name === selectedRemote ? "selected" : ""} ${remote.pushSupported ? "" : "disabled"}>${escapeHtml(remote.name)}${remote.pushSupported ? "" : ` · ${escapeHtml(copy.unsupported)}`}</option>`).join("");
  return `<div class="push-route-row" aria-label="${escapeAttribute(copy.pushRouteAria(branch, `${selectedRemote}/${destinationBranch}`))}"><button class="push-route-endpoint push-route-scope ${state.pushSelectedCommit ? "" : "selected"}" id="push-all-commits" type="button" aria-pressed="${state.pushSelectedCommit === null}" title="${escapeAttribute(copy.showAllOutgoingFiles)}"><span class="push-route-kind">${escapeHtml(copy.localBranch)}</span><span class="push-route-name">${icon("branch", 14)}<strong>${escapeHtml(branch)}</strong></span><small>${escapeHtml(copy.outgoingCommitCount(outgoingCount))} · ${escapeHtml(copy.showAllFiles)}</small></button><span class="push-route-arrow" aria-hidden="true"><small>${escapeHtml(copy.push)}</small><strong>→</strong></span><label class="push-route-endpoint push-remote-target"><span class="push-route-kind">${escapeHtml(copy.remoteBranch)}</span><span class="push-route-name push-route-destination">${icon("upload", 14)}${renderSelectControl(`<select id="push-remote-select" aria-label="${escapeAttribute(copy.pushRemote)}" ${state.pushPreviewRefreshing || state.operation ? "disabled" : ""}>${options}</select>`)}<span class="push-route-separator">/</span><strong>${escapeHtml(destinationBranch)}</strong></span><small>${escapeHtml(copy.selectedDestination)}</small></label></div>`;
}

function renderPushPreviewBody(model: RemotePushDialogViewModel, preview: PushPreview): string {
  const { state } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  const commits = preview.commits.length
    ? preview.commits.map((commit) => { const selected = state.pushSelectedCommit === commit.oid; return `<button class="push-commit-row ${selected ? "selected" : ""}" type="button" role="option" data-push-commit="${escapeAttribute(commit.oid)}" aria-selected="${selected}" aria-pressed="${selected}" title="${escapeAttribute(commit.oid)}"><span>${escapeHtml(commit.subject)}</span><small>${escapeHtml(commit.authorName)} · ${escapeHtml(localization.dateTime.format(new Date(commit.authoredAt * 1000)))}</small></button>`; }).join("")
    : `<div class="remote-dialog-empty">${escapeHtml(copy.noNewCommitObjects)}${preview.publish ? ` ${escapeHtml(copy.publishCreatesDestination)}` : ""}</div>`;
  const reviewFiles = pushReviewFiles(preview, state);
  const files = renderPushFiles(model, preview, reviewFiles);
  const fileScope = state.pushSelectedCommit ? copy.filesInSelectedCommit : copy.filesInAllCommits;
  return `<div class="push-preview-grid"><section class="push-preview-commits" aria-labelledby="push-commits-title"><div class="push-preview-pane-heading"><h3 id="push-commits-title">${escapeHtml(copy.outgoingCommits)}</h3><span>${localization.number.format(preview.commits.length)}/${localization.number.format(preview.totalCommits)}</span></div><div class="push-commit-list" role="listbox" aria-label="${escapeAttribute(copy.outgoingListAria)}">${commits}</div>${preview.hasMore ? `<button class="secondary-button push-load-more" id="push-load-more" type="button" ${state.pushPreviewLoadingMore ? "disabled" : ""}>${escapeHtml(state.pushPreviewLoadingMore ? copy.loading : copy.showMore)}</button>` : preview.truncated ? `<p class="push-preview-limit">${escapeHtml(copy.truncatedCommits(localization.number.format(preview.totalCommits)))}</p>` : ""}</section><section class="push-preview-files" aria-labelledby="push-files-title"><div class="push-preview-pane-heading push-files-heading"><h3 id="push-files-title">${escapeHtml(fileScope)}</h3><span>${localization.number.format(reviewFiles.length)}${preview.filesTruncated && !state.pushSelectedCommit ? "+" : ""}</span>${pushFileToolbar(model, Boolean(state.pushSelectedFile))}</div><div class="push-file-list" role="tree">${files}</div></section></div>`;
}

function renderPushFiles(model: RemotePushDialogViewModel, preview: PushPreview, reviewFiles: CommitFileChange[]): string {
  const { state } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  if (state.pushCommitDetailsLoading) return `<div class="remote-dialog-loading compact" role="status"><span class="spinner"></span><span>${escapeHtml(copy.readingSelectedFiles)}</span></div>`;
  if (state.pushCommitDetailsError) return renderRemoteError(state.pushCommitDetailsError, localization, "remote-dialog-empty error");
  if (!reviewFiles.length) return `<div class="remote-dialog-empty">${escapeHtml(preview.filesTruncated && !state.pushSelectedCommit ? copy.pushedRangeExceeded : state.pushSelectedCommit ? copy.noSelectedCommitFiles : copy.noNetFileChanges)}</div>`;
  if (state.pushFileView === "flat") return reviewFiles.map((file) => pushFileRow(file, file.path === state.pushSelectedFile, null, localization)).join("");
  const rootExpanded = !state.pushCollapsedFileDirectories.has(".");
  return `<details class="push-file-directory push-file-root" data-push-directory="." ${rootExpanded ? "open" : ""}><summary style="--tree-depth:0"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<strong>${escapeHtml(basename(model.workspaceRoot ?? preview.branch))}</strong><small>${escapeHtml(localization.catalog.history.fileCount(reviewFiles.length))}</small></summary><div role="group">${rootExpanded ? buildCommitFileTree(reviewFiles).map((node) => renderPushFileTreeNode(node, 1, model)).join("") : ""}</div></details>`;
}

function pushFileToolbar(model: RemotePushDialogViewModel, selected: boolean): string {
  const { state } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  const nextView = state.pushFileView === "tree" ? copy.flatList : copy.folderTree;
  return `<div class="push-file-toolbar" role="toolbar" aria-label="${escapeAttribute(copy.pushedFileToolbar)}"><button class="compact-icon-button" type="button" data-push-file-action="diff" title="${escapeAttribute(copy.openOutgoingDiff)}" aria-label="${escapeAttribute(copy.openOutgoingDiff)}" ${selected && !state.pushFileActionLoading ? "" : "disabled"}>${state.pushFileActionLoading ? '<span class="spinner"></span>' : icon("diff", 14)}</button><button class="compact-icon-button" type="button" data-push-file-action="open" title="${escapeAttribute(localization.catalog.editor.openSource)}" aria-label="${escapeAttribute(localization.catalog.editor.openSource)}" ${selected && model.selectedProjectFileAvailable ? "" : "disabled"}>${icon("locate", 14)}</button><button class="compact-icon-button ${state.pushFileView === "tree" ? "active" : ""}" type="button" data-push-file-action="view" title="${escapeAttribute(copy.showPushedFilesAs(nextView))}" aria-label="${escapeAttribute(copy.showPushedFilesAs(nextView))}" aria-pressed="${state.pushFileView === "tree"}">${icon("eye", 14)}</button><button class="compact-icon-button" type="button" data-push-file-action="expand" title="${escapeAttribute(copy.expandPushedFolders)}" aria-label="${escapeAttribute(copy.expandPushedFolders)}" ${state.pushFileView === "flat" ? "disabled" : ""}>${icon("expand", 14)}</button><button class="compact-icon-button" type="button" data-push-file-action="collapse" title="${escapeAttribute(copy.collapsePushedFolders)}" aria-label="${escapeAttribute(copy.collapsePushedFolders)}" ${state.pushFileView === "flat" ? "disabled" : ""}>${icon("collapse", 14)}</button></div>`;
}

function renderPushFileTreeNode(node: CommitFileTreeNode, depth: number, model: RemotePushDialogViewModel): string {
  const { state } = model;
  if (node.kind === "directory") {
    const expanded = !state.pushCollapsedFileDirectories.has(node.path);
    return `<details class="push-file-directory" data-push-directory="${escapeAttribute(node.path)}" ${expanded ? "open" : ""}><summary style="--tree-depth:${depth}"><span class="tree-chevron">${icon("chevron", 11)}</span>${icon("folder", 14)}<span>${escapeHtml(node.name)}</span><small>${(model.localization ?? DEFAULT_LOCALIZATION).number.format(countCommitTreeFiles(node))}</small></summary><div role="group">${expanded ? node.children.map((child) => renderPushFileTreeNode(child, depth + 1, model)).join("") : ""}</div></details>`;
  }
  const file = node.file!;
  return pushFileRow(file, file.path === state.pushSelectedFile, depth, model.localization ?? DEFAULT_LOCALIZATION);
}

function pushFileRow(file: CommitFileChange, selected: boolean, depth: number | null, localization: Localization): string {
  return `<button class="push-file-row file-status-${file.status} ${selected ? "selected" : ""}" type="button" role="treeitem" ${depth === null ? "" : `style="--tree-depth:${depth}"`} data-push-file="${escapeAttribute(file.path)}" aria-selected="${selected}" title="${escapeAttribute(file.path)}"><span class="change-status status-${file.status}" title="${escapeAttribute(localization.catalog.changes.changeLabels[file.status])}">${changeCode(file.status)}</span><span class="commit-file-glyph">${fileTypeIcon(file.path)}</span><span>${escapeHtml(basename(file.path))}</span>${depth === null ? `<small>${escapeHtml(dirname(file.path))}</small>` : ""}</button>`;
}

function renderRemoteAuthenticationDialog(model: RemotePushDialogViewModel): string {
  const authentication = model.authentication;
  const entry = authentication?.dialog;
  if (!entry || model.state.dialog !== "push") return "";
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  const { status } = entry;
  const host = status.host ?? status.remote;
  const busy = authentication.checking || authentication.saving !== null;
  const error = authentication.error
    ? renderRemoteError(authentication.error, localization, "remote-authentication-error")
    : "";
  const helperWarning = status.transport === "https" && !status.credentialHelperConfigured
    ? `<div class="remote-dialog-warning" role="status">${escapeHtml(copy.credentialHelperMissing)}</div>`
    : "";
  const https = status.transport === "https"
    ? `<form id="remote-https-auth-form" class="remote-authentication-method">
        <div><h3>${escapeHtml(copy.httpsCredentialTitle)}</h3><p>${escapeHtml(copy.passwordUnsupported)}</p></div>
        ${helperWarning}
        <label><span>${escapeHtml(copy.username)}</span><input id="remote-auth-username" type="text" autocomplete="username" placeholder="${escapeAttribute(copy.usernamePlaceholder)}" ${busy ? "disabled" : ""}/></label>
        <label><span>${escapeHtml(copy.personalAccessToken)}</span><input id="remote-auth-token" type="password" autocomplete="off" spellcheck="false" placeholder="${escapeAttribute(copy.tokenPlaceholder)}" ${busy ? "disabled" : ""}/></label>
        <p class="remote-authentication-notice">${escapeHtml(copy.credentialStorageNotice)}</p>
        <button class="primary-button" type="submit" ${busy ? "disabled" : ""}>${escapeHtml(authentication.saving === "https" ? copy.savingCredential : copy.saveCredentialAndPush)}</button>
      </form>`
    : "";
  const sshUrl = status.suggestedSshUrl ?? "";
  const sshWarning = status.transport === "ssh" && !status.credentialAvailable
    ? `<div class="remote-dialog-warning" role="status">${escapeHtml(copy.sshIdentityMissing)}</div>`
    : "";
  const ssh = `<form id="remote-ssh-auth-form" class="remote-authentication-method">
      <div><h3>${escapeHtml(copy.sshCredentialTitle)}</h3><p>${escapeHtml(copy.sshCredentialDescription)}</p></div>
      ${sshWarning}
      <label><span>${escapeHtml(copy.sshUrl)}</span><input id="remote-auth-ssh-url" type="text" autocomplete="off" spellcheck="false" value="${escapeAttribute(sshUrl)}" placeholder="${escapeAttribute(copy.sshUrlPlaceholder)}" ${busy ? "disabled" : ""}/></label>
      <button class="secondary-button" type="submit" ${busy ? "disabled" : ""}>${escapeHtml(authentication.saving === "ssh" ? copy.configuringSsh : copy.configureSshAndPush)}</button>
    </form>`;
  return `<div class="remote-authentication-backdrop" role="presentation"><section class="dialog remote-authentication-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-authentication-title" aria-describedby="remote-authentication-description">
    <div class="dialog-heading"><div><h2 id="remote-authentication-title">${escapeHtml(copy.authenticationTitle(host))}</h2></div><button class="icon-button" id="remote-authentication-close" type="button" aria-label="${escapeAttribute(localization.catalog.common.cancel)}" title="${escapeAttribute(localization.catalog.common.cancel)}" ${busy ? "disabled" : ""}>${icon("close", 18)}</button></div>
    <p id="remote-authentication-description">${escapeHtml(copy.authenticationDescription(status.remote))}</p>
    ${error}<div class="remote-authentication-methods">${https}${ssh}</div>
    <div class="dialog-actions"><button class="secondary-button" id="remote-authentication-recheck" type="button" ${busy ? "disabled" : ""}>${escapeHtml(authentication.checking ? copy.checkingAuthentication : copy.recheckAuthentication)}</button><button class="secondary-button" id="remote-authentication-cancel" type="button" ${busy ? "disabled" : ""}>${escapeHtml(localization.catalog.common.cancel)}</button></div>
  </section></div>`;
}

function renderPushDiffDialog(model: RemotePushDialogViewModel): string {
  const { state, preferences } = model;
  const localization = model.localization ?? DEFAULT_LOCALIZATION;
  const copy = localization.catalog.remote;
  const editor = localization.catalog.editor;
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
    ? loadingBlock(copy.loadingPushedDiff)
    : diff.error
      ? renderRemoteError(diff.error, localization, "remote-dialog-empty error")
      : diff.image
        ? `<section class="image-diff-surface" aria-label="${escapeAttribute(editor.imageDiff)}">${diff.image.before ? imagePreviewCard(diff.image.before, editor.before, localization) : emptyImageSide(editor.before, editor.fileDidNotExist)}${diff.image.after ? imagePreviewCard(diff.image.after, editor.after, localization) : emptyImageSide(editor.after, editor.fileRemoved)}</section>`
        : '<div class="push-diff-editor-host" id="push-diff-editor-host"></div>';
  const unchanged = diff.expandedUnchanged ? editor.collapseUnchanged : editor.expandUnchanged;
  return `<div class="push-diff-backdrop" id="push-diff-backdrop" role="presentation"><section class="dialog push-diff-dialog" role="dialog" aria-modal="true" aria-labelledby="push-diff-title"><div class="dialog-heading push-diff-heading"><div><h2 id="push-diff-title">${escapeHtml(basename(diff.file.path))}</h2><small>${escapeHtml(diff.file.path)}${diff.oid ? ` · ${escapeHtml(diff.oid.slice(0, 8))}` : ""}</small></div><button class="icon-button" id="push-diff-close" type="button" aria-label="${escapeAttribute(copy.closePushedDiff)}" title="${escapeAttribute(localization.catalog.common.close)}">${icon("close", 18)}</button></div><div class="diff-toolbar push-diff-toolbar" aria-label="${escapeAttribute(copy.pushedDiffToolbar)}"><div class="diff-navigation-controls" role="group" aria-label="${escapeAttribute(editor.diffNavigation)}"><button class="compact-icon-button" type="button" data-push-diff-action="previous-change" aria-label="${escapeAttribute(editor.previousChange)}" title="${escapeAttribute(editor.previousChange)}" ${!diff.patch ? "disabled" : ""}>${icon("up", 15)}</button><button class="compact-icon-button" type="button" data-push-diff-action="next-change" aria-label="${escapeAttribute(editor.nextChange)}" title="${escapeAttribute(editor.nextChange)}" ${!diff.patch ? "disabled" : ""}>${icon("down", 15)}</button><span class="diff-control-separator" aria-hidden="true"></span><button class="compact-icon-button" type="button" data-push-diff-action="previous-file" aria-label="${escapeAttribute(copy.previousPushedFile)}" title="${escapeAttribute(copy.previousPushedFile)}" ${hasPrevious ? "" : "disabled"}>${icon("back", 15)}</button><button class="compact-icon-button" type="button" data-push-diff-action="next-file" aria-label="${escapeAttribute(copy.nextPushedFile)}" title="${escapeAttribute(copy.nextPushedFile)}" ${hasNext ? "" : "disabled"}>${icon("forward", 15)}</button><button class="compact-icon-button" type="button" data-push-diff-action="open-source" aria-label="${escapeAttribute(editor.openSource)}" title="${escapeAttribute(editor.openSource)}" ${model.selectedProjectFileAvailable ? "" : "disabled"}>${icon("locate", 15)}</button><button class="compact-icon-button ${diff.expandedUnchanged ? "active" : ""}" type="button" data-push-diff-action="toggle-unchanged" aria-label="${escapeAttribute(unchanged)}" title="${escapeAttribute(unchanged)}" aria-pressed="${diff.expandedUnchanged}" ${!diff.patch ? "disabled" : ""}>${icon(diff.expandedUnchanged ? "collapse" : "expand", 15)}</button></div>${image ? "" : `<div class="diff-controls" role="group" aria-label="${escapeAttribute(editor.diffPresentation)}"><button type="button" data-push-diff-layout="unified" aria-pressed="${preferences.diffLayout === "unified"}" title="${escapeAttribute(editor.unifiedTitle)}">${escapeHtml(editor.unified)}</button><button type="button" data-push-diff-layout="split" aria-pressed="${preferences.diffLayout === "split"}" title="${escapeAttribute(editor.sideBySideTitle)}">${escapeHtml(editor.sideBySide)}</button><button type="button" data-push-diff-whitespace aria-pressed="${preferences.showWhitespace}" title="${escapeAttribute(editor.whitespaceTitle)}">${escapeHtml(editor.whitespace)}</button></div>`}</div><div class="push-diff-body ${image ? "image-surface" : "diff-surface"}" id="push-diff-body">${body}</div></section></div>`;
}

function imagePreviewCard(image: ImagePreview, label: string, localization: Localization): string {
  return `<figure class="image-preview-card"><figcaption><strong>${escapeHtml(label)}</strong><span>${escapeHtml(image.mediaType)} · ${formatBytes(image.byteLength, localization)}${image.width && image.height ? ` · ${localization.number.format(image.width)}×${localization.number.format(image.height)}` : ""}</span></figcaption><div class="image-preview-stage"><img src="${escapeAttribute(image.dataUrl)}" alt="${escapeAttribute(localization.catalog.remote.imagePreviewAlt(label))}" /></div></figure>`;
}

function renderRemoteError(
  message: string,
  localization: Localization,
  className = "remote-dialog-error",
): string {
  const detail = localization.catalog.errors.translate(message);
  const summary = localization.catalog.remote.unexpectedError;
  return `<div class="${className}" role="alert"><strong>${escapeHtml(summary)}</strong>${detail === summary ? "" : `<span>${escapeHtml(detail)}</span>`}</div>`;
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

function formatBytes(bytes: number, localization: Localization): string {
  if (bytes < 1024) return `${localization.number.format(bytes)} B`;
  if (bytes < 1024 * 1024) return `${localization.number.format(bytes / 1024)} KB`;
  return `${localization.number.format(bytes / (1024 * 1024))} MB`;
}

function compactCount(count: number): string {
  return count > 99 ? "99+" : String(count);
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
