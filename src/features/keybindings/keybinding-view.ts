import type { KeybindingCopy } from "../../localization/catalog.ts";
import type {
  KeybindingCommandRow,
  KeybindingSettingsViewModel,
} from "./keybinding-controller.ts";
import { formatKeySequence } from "./keybinding-normalizer.ts";
import type { KeybindingPlatform } from "./keybinding-model.ts";
import { renderSelectControl } from "../../shared/select-control.ts";

export function renderKeybindingSettings(
  model: KeybindingSettingsViewModel,
  platform: KeybindingPlatform,
  copy: KeybindingCopy,
): string {
  const diagnostic = model.diagnostic
    ? `<div class="keybinding-diagnostic" role="alert">${escapeHtml(model.diagnostic === "oversized" ? copy.profileOversized : copy.profileInvalid)}</div>`
    : "";
  const recorder = model.recording
    ? renderRecorder(model, platform, copy)
    : "";
  return `<section class="settings-group keybinding-settings">
    <header><h2>${escapeHtml(copy.title)}</h2><p>${escapeHtml(copy.description)}</p></header>
    ${diagnostic}${recorder}
    <div class="keybinding-toolbar">
      <label class="keybinding-search"><span>${escapeHtml(copy.search)}</span><input id="keybinding-search" type="search" value="${escapeAttribute(model.query)}" placeholder="${escapeAttribute(copy.searchPlaceholder)}" autocomplete="off" spellcheck="false" /></label>
      <div class="setting-segmented" role="group" aria-label="${escapeAttribute(copy.filter)}">
        ${filterButton("all", copy.all, model.filter)}
        ${filterButton("modified", copy.modified, model.filter)}
        ${filterButton("conflicts", copy.conflicts, model.filter)}
      </div>
      ${renderSelectControl(`<select id="keybinding-category" aria-label="${escapeAttribute(copy.categoryFilter)}"><option value="all">${escapeHtml(copy.allCategories)}</option>${Object.entries(copy.categories).map(([id, label]) => `<option value="${id}" ${model.category === id ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`)}
      <button class="setting-retry-button" type="button" data-keybinding-reset-all ${model.modifiedCount === 0 && !model.diagnostic ? "disabled" : ""}>${escapeHtml(copy.resetAll)}${model.modifiedCount ? ` (${model.modifiedCount})` : ""}</button>
    </div>
    <div class="keybinding-list" role="list" aria-label="${escapeAttribute(copy.listLabel)}">
      ${model.rows.length ? model.rows.map((row) => renderRow(row, copy)).join("") : `<div class="keybinding-empty">${escapeHtml(copy.noResults)}</div>`}
    </div>
  </section>`;
}

function renderRow(row: KeybindingCommandRow, copy: KeybindingCopy): string {
  const conflictingCommands = Array.from(new Set(row.conflicts.map((conflict) => conflict.commandId)));
  const bindings = row.bindings.length
    ? row.bindings.map((binding) => `<div class="keybinding-pill ${binding.source}">
        <button type="button" data-keybinding-edit="${escapeAttribute(binding.id)}" data-command-id="${escapeAttribute(row.id)}" aria-label="${escapeAttribute(copy.editBinding(row.title, binding.accessible || copy.unassigned))}">${binding.sequence ? `<kbd>${escapeHtml(binding.display)}</kbd>` : `<span>${escapeHtml(copy.unassigned)}</span>`}</button>
        <button type="button" class="keybinding-remove" data-keybinding-remove="${escapeAttribute(binding.id)}" aria-label="${escapeAttribute(copy.removeBinding(row.title))}">×</button>
      </div>`).join("")
    : `<span class="keybinding-unassigned">${escapeHtml(copy.unassigned)}</span>`;
  return `<article class="keybinding-row ${row.unknown ? "unknown" : ""}" role="listitem" data-keybinding-command="${escapeAttribute(row.id)}">
    <div class="keybinding-command-copy"><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.detail || row.id)}</span><code>${escapeHtml(row.id)}</code></div>
    <div class="keybinding-command-meta"><span>${escapeHtml(copy.categories[row.category])}</span>${row.modified ? `<span class="keybinding-badge">${escapeHtml(copy.modified)}</span>` : ""}${!row.enabled ? `<span class="keybinding-badge warning"${row.reason ? ` title="${escapeAttribute(row.reason)}"` : ""}>${escapeHtml(copy.unavailable)}</span>` : ""}${row.unknown ? `<span class="keybinding-badge warning">${escapeHtml(copy.unknown)}</span>` : ""}${conflictingCommands.length ? `<span class="keybinding-badge warning" title="${escapeAttribute(copy.conflictWith(conflictingCommands.join(", ")))}">${escapeHtml(copy.conflict)}</span>` : ""}</div>
    <div class="keybinding-values">${bindings}</div>
    <div class="keybinding-row-actions">
      <button type="button" data-keybinding-add data-command-id="${escapeAttribute(row.id)}">${escapeHtml(copy.add)}</button>
      ${row.modified ? `<button type="button" data-keybinding-reset-command data-command-id="${escapeAttribute(row.id)}">${escapeHtml(copy.reset)}</button>` : ""}
    </div>
  </article>`;
}

function renderRecorder(
  model: KeybindingSettingsViewModel,
  platform: KeybindingPlatform,
  copy: KeybindingCopy,
): string {
  const recording = model.recording!;
  const title = model.rows.find((row) => row.id === recording.commandId)?.title ?? recording.commandId;
  const display = recording.sequence.length
    ? formatKeySequence(recording.sequence as Parameters<typeof formatKeySequence>[0], platform)
    : copy.pressKeys;
  const validation = recording.validationError
    ? `<p class="keybinding-recorder-error" role="alert">${escapeHtml(recording.validationError === "protected" ? copy.protectedBinding : copy.reservedBinding)}</p>`
    : recording.conflicts.length
      ? `<p class="keybinding-recorder-error" role="alert">${escapeHtml(copy.conflictWith(recording.conflicts.map((conflict) => conflict.commandId).join(", ")))}</p>`
      : "";
  return `<div class="keybinding-recorder" role="dialog" aria-modal="false" aria-labelledby="keybinding-recorder-title">
    <div><strong id="keybinding-recorder-title">${escapeHtml(copy.record(title))}</strong><span>${escapeHtml(copy.recordInstructions)}</span></div>
    <div id="keybinding-recorder-input" class="keybinding-recorder-input" tabindex="0" aria-label="${escapeAttribute(copy.recorderAria)}"><kbd>${escapeHtml(display)}</kbd></div>
    ${validation}
    <div class="keybinding-recorder-actions">
      <button type="button" data-keybinding-cancel>${escapeHtml(copy.cancel)}</button>
      ${recording.conflicts.length && !recording.validationError ? `<button type="button" data-keybinding-replace>${escapeHtml(copy.replace)}</button>` : `<button type="button" data-keybinding-save ${recording.sequence.length === 0 || recording.validationError ? "disabled" : ""}>${escapeHtml(copy.save)}</button>`}
    </div>
  </div>`;
}

function filterButton(id: string, label: string, selected: string): string {
  return `<button type="button" data-keybinding-filter="${id}" aria-pressed="${id === selected}">${escapeHtml(label)}</button>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}
