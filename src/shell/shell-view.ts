import { BRAND } from "../brand.ts";
import { icon } from "../icons.ts";
import type { ActivityTool } from "../workbench/activity-order.ts";
import { showCustomWindowControls, windowChromeClass } from "../workbench/window-chrome.ts";
import type { ShellState } from "./shell-controller.ts";
import type { LocaleCatalog, ShellCopy } from "../localization/catalog.ts";
import { EN_US } from "../localization/en-US.ts";

export interface ShellViewModel {
  shell: ShellState;
  workspaceOpen: boolean;
  gitAvailable: boolean;
  demo: boolean;
  windowControlsAvailable: boolean;
  localization?: Pick<LocaleCatalog, "shell" | "common">;
}

export function renderShellView(model: ShellViewModel): string {
  const copy = model.localization?.shell ?? EN_US.shell;
  const common = model.localization?.common ?? EN_US.common;
  return `<main class="app-shell ${windowChromeClass(model.shell.windowChromeMode)}">
    <header class="topbar" data-tauri-drag-region>
      <div class="repository-switcher-anchor" id="repository-switcher-anchor">
        <button class="repository-switcher" id="repository-switcher" type="button" aria-label="${escapeHtml(copy.projectMenu)}" aria-haspopup="menu" aria-controls="repository-menu" aria-expanded="false" title="${escapeHtml(copy.openProject)}"><span class="repository-name" id="repository-name">${escapeHtml(copy.noProject)}</span>${icon("chevron-down", 13)}</button>
        <div class="repository-menu hidden" id="repository-menu" role="menu" aria-label="${escapeHtml(copy.projectMenu)}"></div>
      </div>
      <div class="topbar-actions" data-tauri-drag-region>
        <span class="demo-badge ${model.demo ? "" : "hidden"}">${escapeHtml(copy.browserDemo)}</span>
        <button class="command-center-button" id="command-center-button" type="button" aria-label="${escapeHtml(copy.searchFilesAndCommands)}" title="${escapeHtml(copy.searchFilesAndCommands)} (Ctrl/Cmd+P)">${icon("search", 18)}<span>${escapeHtml(copy.search)}</span><kbd>Ctrl P</kbd></button>
        <div class="remote-toolbar git-unavailable" id="remote-toolbar" role="group" aria-label="${escapeHtml(copy.remoteActions)}">
          <label class="topbar-remote-select" for="topbar-remote-select" title="${escapeHtml(copy.remoteForActions)}"><select id="topbar-remote-select" aria-label="${escapeHtml(copy.remoteForActions)}" disabled><option>${escapeHtml(copy.noRemote)}</option></select></label>
          <span class="topbar-remote-action" id="remote-fetch-hint" tabindex="-1"><button class="icon-button remote-action-button" id="remote-fetch" type="button" data-remote-action="fetch" aria-label="${escapeHtml(copy.fetchBranch)}" title="${escapeHtml(copy.fetchBranch)}" disabled>${icon("download", 18)}</button></span>
          <span class="topbar-remote-action" id="remote-update-hint" tabindex="-1"><button class="icon-button remote-action-button" id="remote-update" type="button" data-remote-action="pull" aria-label="${escapeHtml(copy.updateBranch)}" title="${escapeHtml(copy.updateBranch)}" disabled>${icon("sync", 18)}</button></span>
          <span class="topbar-remote-action" id="remote-push-hint" tabindex="-1"><button class="icon-button remote-action-button" id="remote-push" type="button" data-remote-action="push" aria-label="${escapeHtml(copy.pushBranch)}" title="${escapeHtml(copy.pushBranch)}" disabled>${icon("upload", 18)}</button></span>
          <button class="icon-button remote-cancel-button hidden" id="cancel-remote-operation" type="button" aria-label="${escapeHtml(copy.cancelRemote)}" title="${escapeHtml(copy.cancelRemote)}">${icon("close", 16)}</button>
        </div>
        <button class="icon-button" id="refresh-button" type="button" aria-label="${escapeHtml(copy.refreshProject)}" title="${escapeHtml(copy.refreshShortcut)}" disabled>${icon("refresh", 20)}</button>
        <button class="icon-button" id="settings-button" type="button" aria-label="${escapeHtml(copy.openSettings)}" title="${escapeHtml(copy.settings)}" aria-pressed="false">${icon("settings", 20)}</button>
        <div class="window-controls ${showCustomWindowControls(model.shell.windowChromeMode, model.windowControlsAvailable) ? "" : "hidden"}" role="group" aria-label="${escapeHtml(copy.windowControls)}">
          <button class="window-control-button" id="window-minimize" type="button" aria-label="${escapeHtml(copy.minimizeWindow)}" title="${escapeHtml(copy.minimize)}">${icon("minimize", 16)}</button>
          <button class="window-control-button" id="window-maximize" type="button" aria-label="${escapeHtml(copy.maximizeWindow)}" title="${escapeHtml(copy.maximize)}">${icon("maximize", 16)}</button>
          <button class="window-control-button close" id="window-close" type="button" aria-label="${escapeHtml(copy.closeWindow)}" title="${escapeHtml(common.close)}">${icon("close", 16)}</button>
        </div>
      </div>
    </header>
    <div class="workspace" id="workspace">
      <nav class="activity-rail" aria-label="${escapeHtml(copy.toolWindows)}">
        ${model.shell.activityOrder.map((tool) => activityButton(tool, model, copy)).join("")}
        <span class="rail-spacer"></span><span class="rail-version" aria-label="${escapeHtml(copy.version(BRAND.name, BRAND.version))}">${BRAND.version}</span>
      </nav>
      <section class="workbench" id="workbench">
        <div class="editor-row" id="editor-row">
          <aside class="navigator tool-window" id="left-tool" aria-label="${escapeHtml(copy.leftToolWindow)}">
            <div class="panel-header"><div class="navigator-title-group"><h1 id="navigator-title">${escapeHtml(copy.files)}</h1><span class="panel-count" id="navigator-count">0</span></div><div class="navigator-header-actions"><div class="navigator-context-actions" id="navigator-actions"></div><button class="compact-icon-button tool-window-hide" id="hide-left-tool" type="button" aria-label="${escapeHtml(copy.hideFiles)}" title="${escapeHtml(copy.hideFiles)}">${icon("close", 14)}</button></div></div>
            <div class="navigator-body" id="navigator-body">${loadingBlock(copy.waitingForProject)}</div>
          </aside>
          <div class="workbench-splitter vertical" id="left-splitter" aria-label="${escapeHtml(copy.resizeLeft)}"></div>
          <section class="content-panel editor-panel" id="editor-panel" aria-label="${escapeHtml(copy.editor)}">
            <div class="editor-tabbar-shell"><div class="editor-tabbar" id="editor-tabbar"><span class="editor-tab active">${escapeHtml(copy.welcome)}</span></div><div class="editor-context-actions" id="editor-context-actions"></div><div class="editor-tab-menu-anchor" id="editor-tab-menu-anchor"><button class="editor-tab-menu-toggle" id="editor-tab-menu-toggle" type="button" aria-label="${escapeHtml(copy.showOpenFiles)}" title="${escapeHtml(copy.showOpenFiles)}" aria-haspopup="menu" aria-expanded="false" disabled>${icon("chevron-down", 15)}</button><div class="editor-tab-menu hidden" id="editor-tab-menu" role="menu" aria-label="${escapeHtml(copy.openFiles)}"></div></div></div>
            <div class="content-header" id="content-header"><div class="content-title-group"><span class="content-kicker">${escapeHtml(copy.welcome)}</span><h2>${escapeHtml(copy.editorName(BRAND.name))}</h2></div></div>
            <div class="content-body" id="content-body">${emptyState(copy.openFolder, copy.openFolderDetail, "folder")}</div>
          </section>
        </div>
        <div class="workbench-splitter horizontal" id="bottom-splitter" aria-label="${escapeHtml(copy.resizeGit)}"></div>
        <section class="bottom-tool tool-window" id="bottom-tool" aria-label="${escapeHtml(copy.branchesAndLog)}">
          <div class="bottom-tool-header"><strong>Git</strong><span>${escapeHtml(copy.branchesAndLog)}</span><button class="compact-icon-button git-operation-open" id="git-operation-open" type="button" aria-label="${escapeHtml(copy.prepareGitOperation)}" title="${escapeHtml(copy.gitOperations)}">${icon("more", 15)}</button><button class="compact-icon-button" id="git-recoveries-open" type="button" aria-label="${escapeHtml(copy.recoverChanges)}" title="${escapeHtml(copy.recoverChanges)}">${icon("revert", 15)}</button><button class="bottom-tool-hide" id="hide-git-tool" type="button" aria-label="${escapeHtml(copy.hideGit)}" title="${escapeHtml(copy.hideGit)}">${icon("close", 14)}</button></div>
          <div class="git-tool-grid" id="git-tool-grid">
            <section class="git-tool-pane branch-tree-pane" aria-label="${escapeHtml(copy.branches)}"><div class="git-pane-body" id="branch-navigation-body"></div></section>
            <div class="workbench-splitter vertical" id="branch-tree-splitter" aria-label="${escapeHtml(copy.resizeBranchTree)}"></div>
            <section class="git-tool-pane commit-log-pane" aria-label="${escapeHtml(copy.commitLog)}"><div class="git-pane-body" id="history-navigation-body"></div></section>
            <div class="workbench-splitter vertical" id="branch-details-splitter" aria-label="${escapeHtml(copy.resizeGitDetails)}"></div>
            <aside class="git-tool-pane git-details-pane" aria-label="${escapeHtml(copy.gitDetails)}"><div class="git-pane-body" id="git-detail-body">${inspectorPlaceholder(copy)}</div></aside>
          </div>
        </section>
      </section>
      <section class="settings-page hidden" id="settings-page" aria-labelledby="settings-page-title">
        <header class="settings-page-header"><button class="icon-button" id="settings-back" type="button" aria-label="${escapeHtml(copy.returnToWorkbench)}" title="${escapeHtml(copy.backToWorkbench)}">${icon("back", 17)}</button><h1 id="settings-page-title">${escapeHtml(copy.settings)}</h1></header>
        <div class="settings-page-layout"><nav class="settings-navigation" id="settings-navigation" aria-label="${escapeHtml(copy.settingsGroups)}"></nav><div class="settings-content" id="settings-content"></div></div>
      </section>
    </div>
    <footer class="statusbar"><div class="status-left"><span class="status-indicator" id="status-indicator"></span><span id="status-message">${escapeHtml(common.ready)}</span></div><div class="status-right"><span class="document-encoding hidden" id="document-encoding" aria-label="${escapeHtml(copy.currentEncoding)}"></span><div class="branch-status" id="branch-status"></div></div></footer>
    <div class="toast hidden" id="toast" role="status" aria-live="polite"><span class="toast-icon">!</span><span id="toast-message"></span><button class="toast-close" id="toast-close" type="button" aria-label="${escapeHtml(copy.dismissError)}">${icon("close", 15)}</button></div>
    ${repositoryDialog(copy, common)}
    ${repositoryTargetDialog(copy, common)}
    <div class="dialog-backdrop hidden history-dialog-backdrop" id="history-dialog" role="presentation"></div>
    <div class="dialog-backdrop hidden command-surface-backdrop" id="command-surface" role="presentation"></div>
    <div class="dialog-backdrop hidden replacement-dialog-backdrop" id="workspace-replacement-dialog" role="presentation"></div>
    <div class="dialog-backdrop hidden remote-dialog-backdrop" id="remote-action-dialog" role="presentation"></div>
    <div class="dialog-backdrop hidden git-operation-dialog-backdrop" id="git-operation-dialog" role="presentation"></div>
  </main>`;
}

function activityButton(tool: ActivityTool, model: ShellViewModel, copy: ShellCopy): string {
  const labels = { files: copy.files, branches: copy.branches, changes: copy.changes } as const;
  const icons = { files: "folder", branches: "branch", changes: "changes" } as const;
  const active = tool === "branches"
    ? model.shell.layout.bottomTool === tool
    : model.shell.layout.leftTool === tool;
  const enabled = model.workspaceOpen && (tool === "files" || model.gitAvailable);
  const label = labels[tool];
  const title = enabled
    ? copy.toolReorder(label)
    : tool === "files"
      ? copy.openFolderFirst
      : copy.gitUnavailableReorder;
  return `<button class="activity-button ${active ? "active" : ""} ${enabled ? "" : "unavailable"}" data-tool="${tool}" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(title)}" aria-pressed="${active}" aria-disabled="${!enabled}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">${icon(icons[tool], 20)}<span>${escapeHtml(label)}</span></button>`;
}

function repositoryDialog(copy: ShellCopy, common: LocaleCatalog["common"]): string {
  return `<div class="dialog-backdrop hidden" id="repository-dialog" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-heading"><div><span class="panel-eyebrow">${escapeHtml(copy.browserDemo)}</span><h2 id="dialog-title">${escapeHtml(copy.simulateOpenFolder)}</h2></div><button class="icon-button" id="dialog-close" type="button" aria-label="${escapeHtml(common.close)}">${icon("close", 17)}</button></div><p>${escapeHtml(copy.demoFolderDetail)}</p><form id="repository-form"><label for="repository-input">${escapeHtml(copy.projectFolderPath)}</label><input id="repository-input" name="path" type="text" spellcheck="false" autocomplete="off" placeholder="/path/to/project" /><div class="dialog-actions"><button class="secondary-button" id="dialog-cancel" type="button">${escapeHtml(common.cancel)}</button><button class="primary-button" type="submit">${escapeHtml(copy.openProjectAction)}</button></div></form></section></div>`;
}

function repositoryTargetDialog(copy: ShellCopy, common: LocaleCatalog["common"]): string {
  return `<div class="dialog-backdrop hidden" id="repository-target-dialog" role="presentation"><section class="dialog repository-target-dialog" role="dialog" aria-modal="true" aria-labelledby="repository-target-title"><div class="dialog-heading"><div><span class="panel-eyebrow">${escapeHtml(copy.openProjectAction)}</span><h2 id="repository-target-title">${escapeHtml(copy.whereOpenProject)}</h2></div><button class="icon-button" id="repository-target-close" type="button" aria-label="${escapeHtml(copy.cancelOpeningProject)}">${icon("close", 18)}</button></div><p>${escapeHtml(copy.targetWindowDetail)}</p><code class="repository-target-path" id="repository-target-path"></code><div class="dialog-actions"><button class="secondary-button" id="repository-target-cancel" type="button">${escapeHtml(common.cancel)}</button><button class="secondary-button" id="repository-target-current" type="button">${escapeHtml(copy.currentWindow)}</button><button class="primary-button" id="repository-target-new" type="button">${escapeHtml(copy.newWindow)}</button></div></section></div>`;
}

function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

function emptyState(title: string, detail: string, iconName: string): string {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 28)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function inspectorPlaceholder(copy: ShellCopy): string {
  return `<div class="detail-placeholder"><strong>${escapeHtml(copy.selectCommitOrBranch)}</strong><p>${escapeHtml(copy.inspectorDetail)}</p></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
