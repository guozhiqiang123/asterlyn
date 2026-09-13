import { icon } from "../../icons.ts";
import type { ProjectFile, WorkspaceTextSearchMatch, WorkspaceTextSearchReport } from "../../models.ts";
import type {
  CommandSurfaceState,
  NavigationCommand,
  NavigationMode,
} from "../../workbench/navigation.ts";
import {
  type WorkspaceSearchControls,
  type WorkspaceSearchState,
} from "../../workbench/workspace-search.ts";
import type { WorkspaceReplacementState } from "../../workbench/workspace-replacement.ts";
import type { NavigationCopy, ReplacementCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";

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
  readonly copy?: NavigationCopy;
}

export interface WorkspaceReplacementViewModel {
  readonly dialog: "preview" | "recovery" | null;
  readonly replacement: WorkspaceReplacementState;
  readonly recoveryBusy: { id: string; action: "keep" | "rollback" } | null;
  readonly blockedOpenPaths: ReadonlySet<string>;
  readonly copy?: ReplacementCopy;
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
  const copy = model.copy ?? EN_US.navigation;
  const title = copy.titles[mode];
  return `<section class="command-surface ${mode === "workspace" ? "workspace-mode" : ""}" role="dialog" aria-modal="true" aria-labelledby="command-surface-title">
    <div class="command-surface-tabs" role="tablist" aria-label="${escapeAttribute(copy.navigationMode)}">
      ${commandSurfaceTab("files", copy.tabs.files, model)}
      ${commandSurfaceTab("recent", copy.tabs.recent, model)}
      ${commandSurfaceTab("workspace", copy.tabs.workspace, model)}
      ${commandSurfaceTab("commands", copy.tabs.commands, model)}
      <button class="icon-button command-surface-close" type="button" data-command-surface-close aria-label="${escapeAttribute(copy.close)}">${icon("close", 15)}</button>
    </div>
    <div class="command-surface-input">
      ${icon("search", 17)}
      <input id="command-surface-input" type="text" value="${escapeAttribute(model.commandSurface.query)}" placeholder="${escapeAttribute(title)}" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(title)}" aria-controls="command-surface-results" aria-activedescendant="${resultCount > 0 ? `command-result-${selected}` : ""}" />
      ${mode === "workspace" ? `<button class="workspace-search-mode" id="workspace-search-mode" type="button" aria-label="${escapeAttribute(copy.useRegularExpressions)}" aria-pressed="${model.workspaceSearchControls.mode === "regex"}" title="${escapeAttribute(copy.regularExpression)}">.*</button>` : ""}
      ${mode === "workspace" && model.workspaceSearch.status === "loading" ? '<span class="spinner"></span>' : `<kbd>${escapeHtml(mode === "workspace" ? copy.enterToSearch : copy.enter)}</kbd>`}
    </div>
    ${mode === "workspace" ? renderWorkspaceSearchControls(model) : ""}
    <div class="command-surface-results" id="command-surface-results" role="listbox" aria-label="${escapeAttribute(title)}">
      ${renderCommandSurfaceResults(mode, selected, model)}
    </div>
    <footer class="command-surface-footer">
      <span id="command-surface-title">${escapeHtml(copy.hints[mode])}</span>
      <span><kbd>↑↓</kbd> ${escapeHtml(copy.navigate)} <kbd>Enter</kbd> ${escapeHtml(copy.open)} <kbd>Esc</kbd> ${escapeHtml(copy.close)}</span>
    </footer>
  </section>`;
}

export function renderWorkspaceReplacementDialog(
  model: WorkspaceReplacementViewModel,
): string {
  const copy = model.copy ?? EN_US.replacement;
  if (!model.dialog) return "";
  if (model.dialog === "recovery") return renderReplacementRecoveries(model, copy);
  const replacement = model.replacement;
  if (replacement.status === "previewing") {
    return `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
      <div class="dialog-heading"><div><span class="panel-eyebrow">${escapeHtml(copy.safeWorkspaceEdit)}</span><h2 id="replacement-dialog-title">${escapeHtml(copy.preparingPreview)}</h2></div></div>
      ${loadingBlock(copy.rereadingFiles)}
      <div class="dialog-actions"><button class="secondary-button" id="replacement-cancel-operation" type="button">${escapeHtml(copy.cancel)}</button></div>
    </section>`;
  }
  if (replacement.status === "error" || !replacement.preview) {
    return `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
      <div class="dialog-heading"><div><span class="panel-eyebrow">${escapeHtml(copy.safeWorkspaceEdit)}</span><h2 id="replacement-dialog-title">${escapeHtml(copy.previewUnavailable)}</h2></div><button class="icon-button" data-replacement-close type="button" aria-label="${escapeAttribute(copy.close)}">${icon("close", 17)}</button></div>
      <div class="replacement-error" role="alert">${escapeHtml(replacement.error ?? copy.createNewSearch)}</div>
      <div class="dialog-actions"><button class="secondary-button" data-replacement-close type="button">${escapeHtml(copy.close)}</button></div>
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
    const delta = file.byteDelta === 0 ? copy.sameSize : copy.byteDelta(file.byteDelta);
    return `<article class="replacement-file ${checked ? "selected" : ""}">
      <label class="replacement-file-heading">
        <input type="checkbox" data-replacement-file="${escapeAttribute(file.workspacePath)}" ${checked ? "checked" : ""} ${applying ? "disabled" : ""} />
        <span><strong>${escapeHtml(file.workspacePath)}</strong><small>${escapeHtml(copy.matches(file.matchCount))} · ${escapeHtml(delta)}${blocked ? ` · ${escapeHtml(copy.blockedFile)}` : ""}</small></span>
      </label>
      <div class="replacement-comparison" aria-label="${escapeAttribute(copy.comparisonFor(file.workspacePath))}">
        <code class="before"><span>${escapeHtml(copy.before)}</span>${escapeHtml(file.beforePreview)}</code>
        <code class="after"><span>${escapeHtml(copy.after)}</span>${escapeHtml(file.afterPreview)}</code>
      </div>
    </article>`;
  }).join("");
  const warning = preview.skippedCount > 0
    ? `<div class="replacement-warning">${escapeHtml(copy.skippedFiles(preview.skippedCount))}</div>`
    : "";
  return `<section class="dialog replacement-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-dialog-title">
    <div class="dialog-heading"><div><span class="panel-eyebrow">${escapeHtml(copy.safeWorkspaceEdit)}</span><h2 id="replacement-dialog-title">${escapeHtml(copy.reviewTitle)}</h2></div>${applying ? "" : `<button class="icon-button" data-replacement-close type="button" aria-label="${escapeAttribute(copy.close)}">${icon("close", 17)}</button>`}</div>
    <p>${escapeHtml(copy.reviewedSummary(preview.totalMatches, preview.files.length))}</p>
    ${replacement.error ? `<div class="replacement-error" role="alert">${escapeHtml(replacement.error)}</div>` : ""}
    ${warning}
    <label class="replacement-select-all"><input id="replacement-select-all" type="checkbox" ${allSelected ? "checked" : ""} ${applying ? "disabled" : ""} /> ${escapeHtml(copy.selectAll)}</label>
    <div class="replacement-file-list">${rows}</div>
    <div class="dialog-actions">
      ${applying ? `<button class="secondary-button" id="replacement-cancel-operation" type="button">${escapeHtml(copy.cancelAndRestore)}</button><button class="primary-button" type="button" disabled><span class="spinner"></span> ${escapeHtml(copy.applying)}</button>` : `<button class="secondary-button" data-replacement-close type="button">${escapeHtml(copy.cancel)}</button><button class="primary-button" id="replacement-apply" type="button" ${selected.size > 0 ? "" : "disabled"}>${escapeHtml(copy.applySelection(selectedMatches, selected.size))}</button>`}
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
  const copy = model.copy ?? EN_US.navigation;
  const controls = model.workspaceSearchControls;
  const hasResults = workspaceSearchHasCurrentResults(model) && Boolean(model.workspaceSearch.report?.matches.length);
  const recoveryCount = model.replacementRecoveryCount;
  return `<div class="workspace-search-controls" role="group" aria-label="${escapeAttribute(copy.workspaceSearchOptions)}">
    <label><span>${escapeHtml(copy.include)}</span><input id="workspace-search-include" type="text" value="${escapeAttribute(controls.includeText)}" placeholder="src/**, **/*.ts" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(copy.includeAria)}" /></label>
    <label><span>${escapeHtml(copy.exclude)}</span><input id="workspace-search-exclude" type="text" value="${escapeAttribute(controls.excludeText)}" placeholder="dist/**, **/*.min.js" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(copy.excludeAria)}" /></label>
    <label class="workspace-search-context"><span>${escapeHtml(copy.context)}</span><select id="workspace-search-context" aria-label="${escapeAttribute(copy.contextLines)}">${[0, 1, 2, 3].map((value) => `<option value="${value}" ${value === controls.contextLines ? "selected" : ""}>${value}</option>`).join("")}</select></label>
    <label class="workspace-replacement-input"><span>${escapeHtml(copy.replace)}</span><input id="workspace-replacement-text" type="text" value="${escapeAttribute(model.replacementText)}" placeholder="${escapeAttribute(copy.replacementText)}" autocomplete="off" spellcheck="false" aria-label="${escapeAttribute(copy.replacementText)}" /></label>
    <button class="secondary-button workspace-replacement-preview-button" id="workspace-replacement-preview" type="button" ${hasResults ? "" : "disabled"}>${escapeHtml(copy.previewReplace)}</button>
    ${recoveryCount > 0 ? `<button class="workspace-recovery-button" id="workspace-recovery-open" type="button" aria-label="${escapeAttribute(copy.reviewRecoveries(recoveryCount))}">${escapeHtml(copy.recoveryRecords(recoveryCount))}</button>` : ""}
  </div>`;
}

function renderCommandSurfaceResults(
  mode: NavigationMode,
  selected: number,
  model: CommandSurfaceViewModel,
): string {
  const copy = model.copy ?? EN_US.navigation;
  if (mode === "workspace") return renderWorkspaceSearchResults(selected, model);
  if (mode === "commands") {
    return model.commands.length
      ? model.commands.map((command, index) => renderCommandResult(command, index, selected)).join("")
      : commandSurfaceEmpty(copy.noMatchingCommands, copy.broaderCommand);
  }
  if (model.files.length === 0) {
    return commandSurfaceEmpty(
      mode === "recent" ? copy.noRecentFiles : copy.noMatchingFiles,
      mode === "recent"
        ? copy.recentFilesDetail
        : model.filesLoading
          ? copy.catalogLoading
          : copy.fileQueryDetail,
    );
  }
  return model.files.map((file, index) => renderFileNavigationResult(file, index, selected)).join("");
}

function renderWorkspaceSearchResults(selected: number, model: CommandSurfaceViewModel): string {
  const copy = model.copy ?? EN_US.navigation;
  const search = model.workspaceSearch;
  if (search.status === "loading") {
    return commandSurfaceEmpty(copy.searchingProject, copy.boundedSearchDetail, true);
  }
  if (search.status === "error" && model.searchRequestIsCurrent) {
    return commandSurfaceEmpty(copy.searchFailed, search.error ?? copy.tryAgain);
  }
  if (search.status !== "ready" || !model.searchRequestIsCurrent || !search.report) {
    return commandSurfaceEmpty(
      copy.searchFileContents,
      copy.searchInstructions,
    );
  }
  if (search.report.matches.length === 0) {
    return commandSurfaceEmpty(
      search.report.coverageReasons.length > 0 ? copy.noSubsetMatches : copy.noMatches,
      formatLocalizedWorkspaceSearchCoverage(search.report, copy),
    );
  }
  const rows = search.report.matches.map((match, index) => renderWorkspaceSearchResult(match, index, selected, copy)).join("");
  return `${rows}<div class="workspace-search-summary">${escapeHtml(formatLocalizedWorkspaceSearchCoverage(search.report, copy))}</div>`;
}

function formatLocalizedWorkspaceSearchCoverage(report: WorkspaceTextSearchReport, copy: NavigationCopy): string {
  const size = report.bytesRead < 1024
    ? `${report.bytesRead} B`
    : report.bytesRead < 1024 * 1024
      ? `${Math.max(1, Math.round(report.bytesRead / 1024))} KiB`
      : `${(report.bytesRead / (1024 * 1024)).toFixed(1)} MiB`;
  const catalog = report.eligibleCandidates === report.catalogCandidates
    ? copy.coverageFiles(report.filesSearched, report.catalogCandidates)
    : copy.coverageEligible(report.filesSearched, report.eligibleCandidates, report.catalogCandidates);
  const base = `${copy.coverageMatches(report.matches.length)} · ${catalog} · ${size}`;
  if (report.coverageReasons.length === 0) return `${base} · ${copy.coverageComplete}`;
  const reasons = report.coverageReasons.map((reason) =>
    reason === "skippedFiles" ? copy.coverageSkipped(report.skippedCount) : copy.coverageReasons[reason]
  ).join(", ");
  return `${base} · ${copy.coveragePartial(reasons)}`;
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
  copy: NavigationCopy,
): string {
  const before = match.preview.slice(0, match.previewFromUtf16);
  const found = match.preview.slice(match.previewFromUtf16, match.previewToUtf16);
  const after = match.preview.slice(match.previewToUtf16);
  const highlighted = found.length > 0
    ? `<mark>${escapeHtml(found)}</mark>`
    : `<mark class="zero-width" aria-label="${escapeAttribute(copy.zeroWidthMatch)}" title="${escapeAttribute(copy.zeroWidthMatch)}">│</mark>`;
  return `<button class="command-result workspace-search-result ${index === selected ? "selected" : ""}" id="command-result-${index}" type="button" role="option" aria-selected="${index === selected}" data-command-result="${index}">
    <span class="search-result-location">${escapeHtml(`${match.workspacePath}:${match.line}:${match.columnUtf16}`)}</span>
    <code>${match.leadingClipped ? "…" : ""}${escapeHtml(before)}${highlighted}${escapeHtml(after)}${match.trailingClipped ? "…" : ""}</code>
  </button>`;
}

function renderReplacementRecoveries(model: WorkspaceReplacementViewModel, copy: ReplacementCopy): string {
  const state = model.replacement;
  const cards = state.recoveries.length === 0
    ? `<div class="command-surface-empty"><strong>${escapeHtml(copy.noPendingRecovery)}</strong><span>${escapeHtml(copy.backupsResolved)}</span></div>`
    : state.recoveries.map((recovery) => {
        const busy = model.recoveryBusy?.id === recovery.recoveryId;
        const conflicts = recovery.files.filter((file) => file.state === "conflict" || file.state === "unavailable").length;
        const replaced = recovery.files.filter((file) => file.state === "replaced").length;
        const files = recovery.files.map((file) => `<li><span>${escapeHtml(file.workspacePath)}</span><span class="recovery-state ${file.state}">${escapeHtml(copy.fileStates[file.state])}</span></li>`).join("");
        return `<article class="recovery-card">
          <div class="recovery-card-heading"><div><strong>${escapeHtml(recovery.recoveryId)}</strong><small>${escapeHtml(copy.recoveryFileSummary(replaced, recovery.files.length, conflicts))}</small></div><span class="scope-pill">${escapeHtml(recovery.status === "applied" ? copy.readyToVerify : copy.needsRecovery)}</span></div>
          <ul>${files}</ul>
          <div class="recovery-actions">
            <button class="secondary-button" data-recovery-rollback="${escapeAttribute(recovery.recoveryId)}" type="button" ${busy ? "disabled" : ""}>${escapeHtml(busy && model.recoveryBusy?.action === "rollback" ? copy.restoring : copy.rollBack)}</button>
            <button class="primary-button" data-recovery-keep="${escapeAttribute(recovery.recoveryId)}" type="button" ${busy || recovery.status !== "applied" ? "disabled" : ""}>${escapeHtml(busy && model.recoveryBusy?.action === "keep" ? copy.keeping : copy.keepChanges)}</button>
          </div>
        </article>`;
      }).join("");
  return `<section class="dialog replacement-dialog recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="replacement-recovery-title">
    <div class="dialog-heading"><div><span class="panel-eyebrow">${escapeHtml(copy.crashSafeHistory)}</span><h2 id="replacement-recovery-title">${escapeHtml(copy.recoveryTitle)}</h2></div>${model.recoveryBusy ? "" : `<button class="icon-button" data-replacement-close type="button" aria-label="${escapeAttribute(copy.close)}">${icon("close", 17)}</button>`}</div>
    <p>${escapeHtml(copy.recoveryDetail)}</p>
    <div class="recovery-list">${cards}</div>
    <div class="dialog-actions"><button class="secondary-button" data-replacement-close type="button" ${model.recoveryBusy ? "disabled" : ""}>${escapeHtml(copy.close)}</button></div>
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
