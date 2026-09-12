import { icon } from "../../icons.ts";
import type { ProjectFile, WorkspaceTextSearchMatch } from "../../models.ts";
import type {
  CommandSurfaceState,
  NavigationCommand,
  NavigationMode,
} from "../../workbench/navigation.ts";
import {
  formatWorkspaceSearchCoverage,
  type WorkspaceSearchControls,
  type WorkspaceSearchState,
} from "../../workbench/workspace-search.ts";
import type { WorkspaceReplacementState } from "../../workbench/workspace-replacement.ts";

export interface CommandSurfaceViewModel {
  readonly commandSurface: CommandSurfaceState;
  readonly workspaceOpen: boolean;
  readonly filesLoading: boolean;
  readonly files: readonly ProjectFile[];
  readonly commands: readonly NavigationCommand[];
  readonly workspaceSearch: WorkspaceSearchState;
  readonly workspaceSearchControls: WorkspaceSearchControls;
  readonly searchRequestIsCurrent: boolean;
  readonly replacementText: string;
  readonly replacementRecoveryCount: number;
}

export interface WorkspaceReplacementViewModel {
  readonly dialog: "preview" | "recovery" | null;
  readonly replacement: WorkspaceReplacementState;
  readonly recoveryBusy: { id: string; action: "keep" | "rollback" } | null;
  readonly blockedOpenPaths: ReadonlySet<string>;
}

export function commandSurfaceResultCount(model: CommandSurfaceViewModel): number {
  const mode = model.commandSurface.mode;
  if (mode === "files" || mode === "recent") return model.files.length;
  if (mode === "commands") return model.commands.length;
  if (mode === "workspace" && workspaceSearchHasCurrentResults(model)) {
    return model.workspaceSearch.report?.matches.length ?? 0;
  }
  return 0;
}

export function renderCommandSurface(model: CommandSurfaceViewModel): string {
  const mode = model.commandSurface.mode;
  if (!mode) return "";
  const resultCount = commandSurfaceResultCount(model);
  const selected = model.commandSurface.selectedIndex;
  const title = commandSurfaceTitle(mode);
  return `<section class="command-surface ${mode === "workspace" ? "workspace-mode" : ""}" role="dialog" aria-modal="true" aria-labelledby="command-surface-title">
    <div class="command-surface-tabs" role="tablist" aria-label="Navigation mode">
      ${commandSurfaceTab("files", "Files", model)}
      ${commandSurfaceTab("recent", "Recent", model)}
      ${commandSurfaceTab("workspace", "Text", model)}
      ${commandSurfaceTab("commands", "Commands", model)}
      <button class="icon-button command-surface-close" type="button" data-command-surface-close aria-label="Close">${icon("close", 15)}</button>
    </div>
    <div class="command-surface-input">
      ${icon("search", 17)}
      <input id="command-surface-input" type="text" value="${escapeAttribute(model.commandSurface.query)}" placeholder="${escapeAttribute(title)}" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(title)}" aria-controls="command-surface-results" aria-activedescendant="${resultCount > 0 ? `command-result-${selected}` : ""}" />
      ${mode === "workspace" ? `<button class="workspace-search-mode" id="workspace-search-mode" type="button" aria-label="Use regular expressions" aria-pressed="${model.workspaceSearchControls.mode === "regex"}" title="Regular expression">.*</button>` : ""}
      ${mode === "workspace" && model.workspaceSearch.status === "loading" ? '<span class="spinner"></span>' : `<kbd>${mode === "workspace" ? "Enter to search" : "Enter"}</kbd>`}
    </div>
    ${mode === "workspace" ? renderWorkspaceSearchControls(model) : ""}
    <div class="command-surface-results" id="command-surface-results" role="listbox" aria-label="${escapeAttribute(title)}">
      ${renderCommandSurfaceResults(mode, selected, model)}
    </div>
    <footer class="command-surface-footer">
      <span id="command-surface-title">${escapeHtml(commandSurfaceHint(mode))}</span>
      <span><kbd>↑↓</kbd> Navigate <kbd>Enter</kbd> Open <kbd>Esc</kbd> Close</span>
    </footer>
  </section>`;
}

export function renderWorkspaceReplacementDialog(
  model: WorkspaceReplacementViewModel,
): string {
  if (!model.dialog) return "";
  if (model.dialog === "recovery") return renderReplacementRecoveries(model);
  const replacement = model.replacement;
  if (replacement.status === "previewing") {
    return `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
      <div class="dialog-heading"><div><span class="panel-eyebrow">Safe workspace edit</span><h2 id="replacement-dialog-title">Preparing replacement preview</h2></div></div>
      ${loadingBlock("Re-reading the Git-authorized files…")}
      <div class="dialog-actions"><button class="secondary-button" id="replacement-cancel-operation" type="button">Cancel</button></div>
    </section>`;
  }
  if (replacement.status === "error" || !replacement.preview) {
    return `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
      <div class="dialog-heading"><div><span class="panel-eyebrow">Safe workspace edit</span><h2 id="replacement-dialog-title">Replacement preview unavailable</h2></div><button class="icon-button" data-replacement-close type="button" aria-label="Close">${icon("close", 17)}</button></div>
      <div class="replacement-error" role="alert">${escapeHtml(replacement.error ?? "Create a new search and preview.")}</div>
      <div class="dialog-actions"><button class="secondary-button" data-replacement-close type="button">Close</button></div>
    </section>`;
  }

  const preview = replacement.preview;
  const selected = replacement.selectedPaths;
  const selectedFiles = preview.files.filter((file) => selected.has(file.workspacePath));
  const selectedMatches = selectedFiles.reduce((total, file) => total + file.matchCount, 0);
  const applying = replacement.status === "applying";
  const allSelected = selected.size === preview.files.length;
  const rows = preview.files.map((file) => {
    const checked = selected.has(file.workspacePath);
    const blocked = model.blockedOpenPaths.has(file.workspacePath);
    const delta = file.byteDelta === 0 ? "same size" : `${file.byteDelta > 0 ? "+" : ""}${file.byteDelta} B`;
    return `<article class="replacement-file ${checked ? "selected" : ""}">
      <label class="replacement-file-heading">
        <input type="checkbox" data-replacement-file="${escapeAttribute(file.workspacePath)}" ${checked ? "checked" : ""} ${applying ? "disabled" : ""} />
        <span><strong>${escapeHtml(file.workspacePath)}</strong><small>${file.matchCount} ${file.matchCount === 1 ? "match" : "matches"} · ${escapeHtml(delta)}${blocked ? " · save or unselect the open edited file" : ""}</small></span>
      </label>
      <div class="replacement-comparison" aria-label="Before and after preview for ${escapeAttribute(file.workspacePath)}">
        <code class="before"><span>Before</span>${escapeHtml(file.beforePreview)}</code>
        <code class="after"><span>After</span>${escapeHtml(file.afterPreview)}</code>
      </div>
    </article>`;
  }).join("");
  const warning = preview.skippedCount > 0
    ? `<div class="replacement-warning">${preview.skippedCount} unsupported or unreadable files remain outside this reviewed replacement.</div>`
    : "";
  return `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
    <div class="dialog-heading"><div><span class="panel-eyebrow">Safe workspace edit</span><h2 id="replacement-dialog-title">Review Replace in Files</h2></div>${applying ? "" : `<button class="icon-button" data-replacement-close type="button" aria-label="Close">${icon("close", 17)}</button>`}</div>
    <p>${preview.totalMatches} reviewed replacements across ${preview.files.length} files. Only checked files will change.</p>
    ${replacement.error ? `<div class="replacement-error" role="alert">${escapeHtml(replacement.error)}</div>` : ""}
    ${warning}
    <label class="replacement-select-all"><input id="replacement-select-all" type="checkbox" ${allSelected ? "checked" : ""} ${applying ? "disabled" : ""} /> Select all files</label>
    <div class="replacement-file-list">${rows}</div>
    <div class="dialog-actions">
      ${applying ? `<button class="secondary-button" id="replacement-cancel-operation" type="button">Cancel and restore</button><button class="primary-button" type="button" disabled><span class="spinner"></span> Applying safely…</button>` : `<button class="secondary-button" data-replacement-close type="button">Cancel</button><button class="primary-button" id="replacement-apply" type="button" ${selected.size > 0 ? "" : "disabled"}>Replace ${selectedMatches} in ${selected.size} ${selected.size === 1 ? "file" : "files"}</button>`}
    </div>
  </section>`;
}

function commandSurfaceTab(
  mode: NavigationMode,
  label: string,
  model: CommandSurfaceViewModel,
): string {
  const active = model.commandSurface.mode === mode;
  return `<button type="button" role="tab" data-command-mode="${mode}" aria-selected="${active}" ${mode !== "commands" && !model.workspaceOpen ? "disabled" : ""}>${escapeHtml(label)}</button>`;
}

function renderWorkspaceSearchControls(model: CommandSurfaceViewModel): string {
  const controls = model.workspaceSearchControls;
  const hasResults = workspaceSearchHasCurrentResults(model) && Boolean(model.workspaceSearch.report?.matches.length);
  const recoveryCount = model.replacementRecoveryCount;
  return `<div class="workspace-search-controls" role="group" aria-label="Workspace search options">
    <label><span>Include</span><input id="workspace-search-include" type="text" value="${escapeAttribute(controls.includeText)}" placeholder="src/**, **/*.ts" autocomplete="off" spellcheck="false" aria-label="Files to include, comma-separated full-path globs" /></label>
    <label><span>Exclude</span><input id="workspace-search-exclude" type="text" value="${escapeAttribute(controls.excludeText)}" placeholder="dist/**, **/*.min.js" autocomplete="off" spellcheck="false" aria-label="Files to exclude, comma-separated full-path globs" /></label>
    <label class="workspace-search-context"><span>Context</span><select id="workspace-search-context" aria-label="Context lines">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${value === controls.contextLines ? "selected" : ""}>${value}</option>`).join("")}</select></label>
    <label class="workspace-replacement-input"><span>Replace</span><input id="workspace-replacement-text" type="text" value="${escapeAttribute(model.replacementText)}" placeholder="Replacement text" autocomplete="off" spellcheck="false" aria-label="Replacement text" /></label>
    <button class="secondary-button workspace-replacement-preview-button" id="workspace-replacement-preview" type="button" ${hasResults ? "" : "disabled"}>Preview Replace</button>
    ${recoveryCount > 0 ? `<button class="workspace-recovery-button" id="workspace-recovery-open" type="button" aria-label="Review ${recoveryCount} replacement recoveries">${recoveryCount} recovery ${recoveryCount === 1 ? "record" : "records"}</button>` : ""}
  </div>`;
}

function renderCommandSurfaceResults(
  mode: NavigationMode,
  selected: number,
  model: CommandSurfaceViewModel,
): string {
  if (mode === "workspace") return renderWorkspaceSearchResults(selected, model);
  if (mode === "commands") {
    return model.commands.length
      ? model.commands.map((command, index) => renderCommandResult(command, index, selected)).join("")
      : commandSurfaceEmpty("No matching commands", "Try a broader command name.");
  }
  if (model.files.length === 0) {
    return commandSurfaceEmpty(
      mode === "recent" ? "No recent files" : "No matching files",
      mode === "recent"
        ? "Files appear here after they open successfully."
        : model.filesLoading
          ? "The project catalog is still loading."
          : "Try part of a filename or path.",
    );
  }
  return model.files.map((file, index) => renderFileNavigationResult(file, index, selected)).join("");
}

function renderWorkspaceSearchResults(selected: number, model: CommandSurfaceViewModel): string {
  const search = model.workspaceSearch;
  if (search.status === "loading") {
    return commandSurfaceEmpty("Searching current project…", "The scan is bounded and cancellable.", true);
  }
  if (search.status === "error" && model.searchRequestIsCurrent) {
    return commandSurfaceEmpty("Search could not complete", search.error ?? "Try again.");
  }
  if (search.status !== "ready" || !model.searchRequestIsCurrent || !search.report) {
    return commandSurfaceEmpty(
      "Search file contents",
      "Enter a case-sensitive literal or regular expression, then press Enter. Replacement always requires a separate preview.",
    );
  }
  if (search.report.matches.length === 0) {
    return commandSurfaceEmpty(
      search.report.coverageReasons.length > 0 ? "No matches in the searched subset" : "No matches",
      formatWorkspaceSearchCoverage(search.report),
    );
  }
  const rows = search.report.matches.map((match, index) => renderWorkspaceSearchResult(match, index, selected)).join("");
  return `${rows}<div class="workspace-search-summary">${escapeHtml(formatWorkspaceSearchCoverage(search.report))}</div>`;
}

function renderFileNavigationResult(file: ProjectFile, index: number, selected: number): string {
  const directory = dirname(file.workspacePath);
  return `<button class="command-result ${index === selected ? "selected" : ""}" id="command-result-${index}" type="button" role="option" aria-selected="${index === selected}" data-command-result="${index}">
    <span class="command-result-icon">${icon("file", 15)}</span>
    <span class="command-result-copy"><strong>${escapeHtml(basename(file.workspacePath))}</strong><small>${escapeHtml(directory || "/")}</small></span>
    ${file.repositoryId === "." ? "" : `<span class="scope-pill">${escapeHtml(file.repositoryId)}</span>`}
  </button>`;
}

function renderCommandResult(command: NavigationCommand, index: number, selected: number): string {
  return `<button class="command-result ${index === selected ? "selected" : ""}" id="command-result-${index}" type="button" role="option" aria-selected="${index === selected}" data-command-result="${index}" ${command.enabled ? "" : "disabled"}>
    <span class="command-result-icon">${icon("search", 15)}</span>
    <span class="command-result-copy"><strong>${escapeHtml(command.label)}</strong><small>${escapeHtml(command.detail)}</small></span>
    ${command.shortcut ? `<kbd>${escapeHtml(command.shortcut)}</kbd>` : ""}
  </button>`;
}

function renderWorkspaceSearchResult(
  match: WorkspaceTextSearchMatch,
  index: number,
  selected: number,
): string {
  const before = match.preview.slice(0, match.previewFromUtf16);
  const found = match.preview.slice(match.previewFromUtf16, match.previewToUtf16);
  const after = match.preview.slice(match.previewToUtf16);
  const highlighted = found.length > 0
    ? `<mark>${escapeHtml(found)}</mark>`
    : '<mark class="zero-width" aria-label="Zero-width match" title="Zero-width match">│</mark>';
  return `<button class="command-result workspace-search-result ${index === selected ? "selected" : ""}" id="command-result-${index}" type="button" role="option" aria-selected="${index === selected}" data-command-result="${index}">
    <span class="search-result-location">${escapeHtml(`${match.workspacePath}:${match.line}:${match.columnUtf16}`)}</span>
    <code>${match.leadingClipped ? "…" : ""}${escapeHtml(before)}${highlighted}${escapeHtml(after)}${match.trailingClipped ? "…" : ""}</code>
  </button>`;
}

function renderReplacementRecoveries(model: WorkspaceReplacementViewModel): string {
  const state = model.replacement;
  const cards = state.recoveries.length === 0
    ? `<div class="command-surface-empty"><strong>No pending replacement recovery</strong><span>Reviewed backups have been resolved.</span></div>`
    : state.recoveries.map((recovery) => {
        const busy = model.recoveryBusy?.id === recovery.recoveryId;
        const conflicts = recovery.files.filter((file) => file.state === "conflict" || file.state === "unavailable").length;
        const replaced = recovery.files.filter((file) => file.state === "replaced").length;
        const files = recovery.files.map((file) => `<li><span>${escapeHtml(file.workspacePath)}</span><span class="recovery-state ${file.state}">${escapeHtml(replacementFileStateLabel(file.state))}</span></li>`).join("");
        return `<article class="recovery-card">
          <div class="recovery-card-heading"><div><strong>${escapeHtml(recovery.recoveryId)}</strong><small>${replaced}/${recovery.files.length} files contain the reviewed replacement${conflicts ? ` · ${conflicts} need manual review` : ""}</small></div><span class="scope-pill">${escapeHtml(recovery.status === "applied" ? "Ready to verify" : "Needs recovery")}</span></div>
          <ul>${files}</ul>
          <div class="recovery-actions">
            <button class="secondary-button" data-recovery-rollback="${escapeAttribute(recovery.recoveryId)}" type="button" ${busy ? "disabled" : ""}>${busy && model.recoveryBusy?.action === "rollback" ? "Restoring…" : "Roll back"}</button>
            <button class="primary-button" data-recovery-keep="${escapeAttribute(recovery.recoveryId)}" type="button" ${busy || recovery.status !== "applied" ? "disabled" : ""}>${busy && model.recoveryBusy?.action === "keep" ? "Keeping…" : "Keep changes"}</button>
          </div>
        </article>`;
      }).join("");
  return `<section class="dialog replacement-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-recovery-title">
    <div class="dialog-heading"><div><span class="panel-eyebrow">Crash-safe history</span><h2 id="replacement-recovery-title">Replacement recovery</h2></div>${model.recoveryBusy ? "" : `<button class="icon-button" data-replacement-close type="button" aria-label="Close">${icon("close", 17)}</button>`}</div>
    <p>Backups remain until you verify and keep the reviewed changes, or restore the exact originals.</p>
    <div class="recovery-list">${cards}</div>
    <div class="dialog-actions"><button class="secondary-button" data-replacement-close type="button" ${model.recoveryBusy ? "disabled" : ""}>Close</button></div>
  </section>`;
}

function workspaceSearchHasCurrentResults(model: CommandSurfaceViewModel): boolean {
  return model.workspaceSearch.status === "ready" &&
    model.searchRequestIsCurrent && model.workspaceSearch.report !== null;
}

function loadingBlock(label: string): string {
  return `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(label)}</span></div>`;
}

function commandSurfaceEmpty(title: string, detail: string, busy = false): string {
  return `<div class="command-surface-empty">${busy ? '<span class="spinner"></span>' : ""}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function commandSurfaceTitle(mode: NavigationMode): string {
  return {
    files: "Search project files",
    recent: "Filter recent files",
    workspace: "Search text in current project",
    commands: "Search available commands",
  }[mode];
}

function commandSurfaceHint(mode: NavigationMode): string {
  return {
    files: "Go to File · authorized project catalog",
    recent: "Recent Files · successful opens in this project",
    workspace: "Find in Files · bounded search · reviewed recoverable replacement",
    commands: "Command Palette · only currently safe commands are enabled",
  }[mode];
}

function replacementFileStateLabel(state: "original" | "replaced" | "conflict" | "unavailable"): string {
  return {
    original: "Original",
    replaced: "Replaced",
    conflict: "Changed externally",
    unavailable: "Unavailable",
  }[state];
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/, "");
  return normalized.split("/").pop() || normalized;
}

function dirname(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const offset = normalized.lastIndexOf("/");
  return offset < 0 ? "" : normalized.slice(0, offset);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
