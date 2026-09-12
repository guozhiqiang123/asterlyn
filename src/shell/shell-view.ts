import { BRAND } from "../brand.ts";
import { icon } from "../icons.ts";
import type { ActivityTool } from "../workbench/activity-order.ts";
import { showCustomWindowControls, windowChromeClass } from "../workbench/window-chrome.ts";
import type { ShellState } from "./shell-controller.ts";

export interface ShellViewModel {
  shell: ShellState;
  workspaceOpen: boolean;
  gitAvailable: boolean;
  demo: boolean;
  windowControlsAvailable: boolean;
}

export function renderShellView(model: ShellViewModel): string {
  return `<main class="app-shell ${windowChromeClass(model.shell.windowChromeMode)}">
    <header class="topbar" data-tauri-drag-region>
      <div class="repository-switcher-anchor" id="repository-switcher-anchor">
        <button class="repository-switcher" id="repository-switcher" type="button" aria-label="Project menu" aria-haspopup="menu" aria-controls="repository-menu" aria-expanded="false" title="Open a project"><span class="repository-name" id="repository-name">No project</span>${icon("chevron-down", 13)}</button>
        <div class="repository-menu hidden" id="repository-menu" role="menu" aria-label="Project menu"></div>
      </div>
      <div class="topbar-actions" data-tauri-drag-region>
        <span class="demo-badge ${model.demo ? "" : "hidden"}">Browser demo</span>
        <button class="command-center-button" id="command-center-button" type="button" aria-label="Search files and commands" title="Search files and commands (Ctrl/Cmd+P)">${icon("search", 18)}<span>Search</span><kbd>Ctrl P</kbd></button>
        <div class="remote-toolbar git-unavailable" id="remote-toolbar" role="group" aria-label="Current branch remote actions">
          <label class="topbar-remote-select" for="topbar-remote-select" title="Remote used by current branch actions"><select id="topbar-remote-select" aria-label="Remote for current branch actions" disabled><option>No remote</option></select></label>
          <span class="topbar-remote-action" id="remote-fetch-hint" tabindex="-1"><button class="icon-button remote-action-button" id="remote-fetch" type="button" data-remote-action="fetch" aria-label="Fetch current branch" title="Fetch current branch" disabled>${icon("download", 18)}</button></span>
          <span class="topbar-remote-action" id="remote-update-hint" tabindex="-1"><button class="icon-button remote-action-button" id="remote-update" type="button" data-remote-action="pull" aria-label="Update current branch" title="Update current branch" disabled>${icon("sync", 18)}</button></span>
          <span class="topbar-remote-action" id="remote-push-hint" tabindex="-1"><button class="icon-button remote-action-button" id="remote-push" type="button" data-remote-action="push" aria-label="Push current branch" title="Push current branch" disabled>${icon("upload", 18)}</button></span>
          <button class="icon-button remote-cancel-button hidden" id="cancel-remote-operation" type="button" aria-label="Cancel remote operation" title="Cancel remote operation">${icon("close", 16)}</button>
        </div>
        <button class="icon-button" id="refresh-button" type="button" aria-label="Refresh project" title="Refresh (Ctrl/Cmd+R)" disabled>${icon("refresh", 20)}</button>
        <button class="icon-button" id="settings-button" type="button" aria-label="Open settings" title="Settings" aria-pressed="false">${icon("settings", 20)}</button>
        <div class="window-controls ${showCustomWindowControls(model.shell.windowChromeMode, model.windowControlsAvailable) ? "" : "hidden"}" role="group" aria-label="Window controls">
          <button class="window-control-button" id="window-minimize" type="button" aria-label="Minimize window" title="Minimize">${icon("minimize", 16)}</button>
          <button class="window-control-button" id="window-maximize" type="button" aria-label="Maximize window" title="Maximize">${icon("maximize", 16)}</button>
          <button class="window-control-button close" id="window-close" type="button" aria-label="Close window" title="Close">${icon("close", 16)}</button>
        </div>
      </div>
    </header>
    <div class="workspace" id="workspace">
      <nav class="activity-rail" aria-label="Tool windows">
        ${model.shell.activityOrder.map((tool) => activityButton(tool, model)).join("")}
        <span class="rail-spacer"></span><span class="rail-version" aria-label="${BRAND.name} version ${BRAND.version}">${BRAND.version}</span>
      </nav>
      <section class="workbench" id="workbench">
        <div class="editor-row" id="editor-row">
          <aside class="navigator tool-window" id="left-tool" aria-label="Left tool window">
            <div class="panel-header"><div class="navigator-title-group"><h1 id="navigator-title">Files</h1><span class="panel-count" id="navigator-count">0</span></div><div class="navigator-header-actions"><div class="navigator-context-actions" id="navigator-actions"></div><button class="compact-icon-button tool-window-hide" id="hide-left-tool" type="button" aria-label="Hide Files tool window" title="Hide Files tool window">${icon("close", 14)}</button></div></div>
            <div class="navigator-body" id="navigator-body">${loadingBlock("Waiting for a project")}</div>
          </aside>
          <div class="workbench-splitter vertical" id="left-splitter" aria-label="Resize left tool window"></div>
          <section class="content-panel editor-panel" id="editor-panel" aria-label="Editor">
            <div class="editor-tabbar-shell"><div class="editor-tabbar" id="editor-tabbar"><span class="editor-tab active">Welcome</span></div><div class="editor-context-actions" id="editor-context-actions"></div><div class="editor-tab-menu-anchor" id="editor-tab-menu-anchor"><button class="editor-tab-menu-toggle" id="editor-tab-menu-toggle" type="button" aria-label="Show open files" title="Show open files" aria-haspopup="menu" aria-expanded="false" disabled>${icon("chevron-down", 15)}</button><div class="editor-tab-menu hidden" id="editor-tab-menu" role="menu" aria-label="Open files"></div></div></div>
            <div class="content-header" id="content-header"><div class="content-title-group"><span class="content-kicker">Welcome</span><h2>${BRAND.name} Editor</h2></div></div>
            <div class="content-body" id="content-body">${emptyState("Open a project folder", "Browse ordinary folders, or use Git tools when the selected folder is a repository root.", "folder")}</div>
          </section>
        </div>
        <div class="workbench-splitter horizontal" id="bottom-splitter" aria-label="Resize Git tool window"></div>
        <section class="bottom-tool tool-window" id="bottom-tool" aria-label="Branches and Git log">
          <div class="bottom-tool-header"><strong>Git</strong><span>Branches and Log</span><button class="compact-icon-button git-operation-open" id="git-operation-open" type="button" aria-label="Prepare a Merge, Cherry-pick, Rebase, or Squash operation" title="Git operations…">${icon("more", 15)}</button><button class="bottom-tool-hide" id="hide-git-tool" type="button" aria-label="Hide Git tool window" title="Hide Git tool window">${icon("close", 14)}</button></div>
          <div class="git-tool-grid" id="git-tool-grid">
            <section class="git-tool-pane branch-tree-pane" aria-label="Branches"><div class="git-pane-body" id="branch-navigation-body"></div></section>
            <div class="workbench-splitter vertical" id="branch-tree-splitter" aria-label="Resize branch tree"></div>
            <section class="git-tool-pane commit-log-pane" aria-label="Commit log"><div class="git-pane-body" id="history-navigation-body"></div></section>
            <div class="workbench-splitter vertical" id="branch-details-splitter" aria-label="Resize Git details"></div>
            <aside class="git-tool-pane git-details-pane" aria-label="Git details"><div class="git-pane-body" id="git-detail-body">${inspectorPlaceholder()}</div></aside>
          </div>
        </section>
      </section>
      <section class="settings-page hidden" id="settings-page" aria-labelledby="settings-page-title">
        <header class="settings-page-header"><button class="icon-button" id="settings-back" type="button" aria-label="Return to workbench" title="Back to workbench">${icon("back", 17)}</button><h1 id="settings-page-title">Settings</h1></header>
        <div class="settings-page-layout"><nav class="settings-navigation" id="settings-navigation" aria-label="Settings groups"></nav><div class="settings-content" id="settings-content"></div></div>
      </section>
    </div>
    <footer class="statusbar"><div class="status-left"><span class="status-indicator" id="status-indicator"></span><span id="status-message">Ready</span></div><div class="status-right"><span class="document-encoding hidden" id="document-encoding" aria-label="Current file encoding"></span><div class="branch-status" id="branch-status"></div></div></footer>
    <div class="toast hidden" id="toast" role="status" aria-live="polite"><span class="toast-icon">!</span><span id="toast-message"></span><button class="toast-close" id="toast-close" type="button" aria-label="Dismiss error">${icon("close", 15)}</button></div>
    ${repositoryDialog()}
    ${repositoryTargetDialog()}
    <div class="dialog-backdrop hidden history-dialog-backdrop" id="history-dialog" role="presentation"></div>
    <div class="dialog-backdrop hidden command-surface-backdrop" id="command-surface" role="presentation"></div>
    <div class="dialog-backdrop hidden replacement-dialog-backdrop" id="workspace-replacement-dialog" role="presentation"></div>
    <div class="dialog-backdrop hidden remote-dialog-backdrop" id="remote-action-dialog" role="presentation"></div>
    <div class="dialog-backdrop hidden git-operation-dialog-backdrop" id="git-operation-dialog" role="presentation"></div>
  </main>`;
}

function activityButton(tool: ActivityTool, model: ShellViewModel): string {
  const labels = { files: "Files", branches: "Branches", changes: "Changes" } as const;
  const icons = { files: "folder", branches: "branch", changes: "changes" } as const;
  const active = tool === "branches"
    ? model.shell.layout.bottomTool === tool
    : model.shell.layout.leftTool === tool;
  const enabled = model.workspaceOpen && (tool === "files" || model.gitAvailable);
  const label = labels[tool];
  const title = enabled
    ? `${label} — drag to reorder`
    : tool === "files"
      ? "Open a project folder first — drag to reorder"
      : "Git is unavailable for this folder — drag to reorder";
  return `<button class="activity-button ${active ? "active" : ""} ${enabled ? "" : "unavailable"}" data-tool="${tool}" type="button" aria-label="${label}" title="${title}" aria-pressed="${active}" aria-disabled="${!enabled}" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">${icon(icons[tool], 20)}<span>${label}</span></button>`;
}

function repositoryDialog(): string {
  return `<div class="dialog-backdrop hidden" id="repository-dialog" role="presentation"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-heading"><div><span class="panel-eyebrow">Browser demo</span><h2 id="dialog-title">Simulate opening a project folder</h2></div><button class="icon-button" id="dialog-close" type="button" aria-label="Close">${icon("close", 17)}</button></div><p>Enter a sample path for browser-only interaction testing. This demo does not read that folder from your computer.</p><form id="repository-form"><label for="repository-input">Project folder path</label><input id="repository-input" name="path" type="text" spellcheck="false" autocomplete="off" placeholder="/path/to/project" /><div class="dialog-actions"><button class="secondary-button" id="dialog-cancel" type="button">Cancel</button><button class="primary-button" type="submit">Open project</button></div></form></section></div>`;
}

function repositoryTargetDialog(): string {
  return `<div class="dialog-backdrop hidden" id="repository-target-dialog" role="presentation"><section class="dialog repository-target-dialog" role="dialog" aria-modal="true" aria-labelledby="repository-target-title"><div class="dialog-heading"><div><span class="panel-eyebrow">Open project</span><h2 id="repository-target-title">Where should this project open?</h2></div><button class="icon-button" id="repository-target-close" type="button" aria-label="Cancel opening project">${icon("close", 18)}</button></div><p>The current window already contains a project. Open the selected folder here or keep this workspace and open another window.</p><code class="repository-target-path" id="repository-target-path"></code><div class="dialog-actions"><button class="secondary-button" id="repository-target-cancel" type="button">Cancel</button><button class="secondary-button" id="repository-target-current" type="button">Current window</button><button class="primary-button" id="repository-target-new" type="button">New window</button></div></section></div>`;
}

function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

function emptyState(title: string, detail: string, iconName: string): string {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName, 28)}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

function inspectorPlaceholder(): string {
  return '<div class="detail-placeholder"><strong>Select a commit or branch</strong><p>Commit files and message details share this compact inspector.</p></div>';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
