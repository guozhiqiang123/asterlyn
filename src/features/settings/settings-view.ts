import {
  EDITOR_FONTS,
  DEFAULT_EDITOR_FONT_ID,
  editorFont,
  editorFontOptionLabel,
  type EditorFontId,
  type EditorFontLoadSource,
} from "../../workbench/editor-fonts.ts";
import {
  EDITOR_FONT_SIZES,
  EDITOR_INDENT_SIZES,
  EDITOR_LETTER_SPACINGS,
  EDITOR_LINE_HEIGHTS,
  EDITOR_TAB_SIZES,
  UI_FONT_SIZES,
  type AppPreferences,
} from "../../workbench/preferences.ts";
import type { SettingsSection, SettingsState } from "./settings-controller.ts";

export interface EditorFontPresentationStatus {
  id: EditorFontId | null;
  kind: "idle" | "loading" | "ready" | "error";
  source?: EditorFontLoadSource;
  message?: string;
}

export function renderSettingsNavigation(section: SettingsSection): string {
  const sections: Array<[SettingsSection, string]> = [
    ["general", "General"],
    ["appearance", "Appearance"],
    ["editor", "Editor"],
    ["version-control", "Version Control"],
    ["code", "Code"],
  ];
  return sections.map(([id, label]) => {
    const selected = section === id;
    return `<button class="settings-navigation-item ${selected ? "selected" : ""}" type="button" data-settings-section="${id}" aria-current="${selected ? "page" : "false"}">${label}</button>`;
  }).join("");
}

export function renderSettingsSection(
  state: SettingsState,
  fontStatus: EditorFontPresentationStatus,
): string {
  const preferences = state.preferences;
  switch (state.section) {
    case "general":
      return settingsGroup(
        "General",
        "Application-wide behavior with explicit support status.",
        `${settingsRow("Application language", "English is the only complete interface language in this build.", '<span class="setting-value-pill">English · Current</span>')}${settingsRow("简体中文", "Planned after every visible string moves into the localization catalog.", '<span class="setting-planned">Planned</span>')}`,
      );
    case "appearance":
      return settingsGroup(
        "Appearance",
        "Interface color and application-menu typography.",
        `${settingsRow("Theme", "Dark is implemented. Light and system-following themes remain explicit future work.", '<span class="setting-value-pill">Dark · Current</span><span class="setting-planned">Light/System planned</span>')}${settingsRow("Application menu font", "Changes navigation, toolbar, tabs, settings, and status text without scaling the editor.", settingsSelect("setting-ui-font", "Application menu font size", "uiFontSize", UI_FONT_SIZES, preferences.uiFontSize, (value) => `${value} px`))}`,
      );
    case "editor":
      return settingsGroup(
        "Editor",
        "Shared defaults for text editors and source-aware Diff panes.",
        `${settingsRow("Editor font", "JetBrains Mono is included. Other fonts download only when selected, pass an integrity check, and remain cached in this profile.", editorFontControl(preferences, fontStatus))}${settingsRow("Editor font size", "Applies immediately to text files and Diff code.", settingsSelect("setting-editor-font", "Editor font size", "editorFontSize", EDITOR_FONT_SIZES, preferences.editorFontSize, (value) => `${value} px`))}${settingsRow("Line spacing", "Controls vertical code density without changing file content.", settingsSelect("setting-editor-line-height", "Editor line spacing", "editorLineHeight", EDITOR_LINE_HEIGHTS, preferences.editorLineHeight, (value) => value.toFixed(2)))}${settingsRow("Letter spacing", "Adjusts horizontal spacing between code glyphs. Android Studio's editor default is represented by 0 px.", settingsSelect("setting-editor-letter-spacing", "Editor letter spacing", "editorLetterSpacing", EDITOR_LETTER_SPACINGS, preferences.editorLetterSpacing, (value) => value === 0 ? "Default · 0 px" : `${value > 0 ? "+" : ""}${value} px`))}${settingsRow("Indent size", "Sets the spaces inserted for one editor indentation level.", settingsSelect("setting-editor-indent", "Editor indent size", "editorIndentSize", EDITOR_INDENT_SIZES, preferences.editorIndentSize, (value) => `${value} spaces`))}${settingsRow("Tab width", "Controls the visual width of an existing tab character without rewriting content.", settingsSelect("setting-editor-tab", "Editor tab width", "editorTabSize", EDITOR_TAB_SIZES, preferences.editorTabSize, (value) => `${value} spaces`))}`,
      );
    case "version-control":
      return settingsGroup(
        "Version Control",
        "Defaults shared by working-tree and commit Diff views.",
        `${settingsRow("Diff layout", "Choose the default presentation used by every Diff preview.", `<div class="setting-segmented" role="group" aria-label="Default Diff layout"><button type="button" data-setting-diff-layout="split" aria-pressed="${preferences.diffLayout === "split"}">Side by side</button><button type="button" data-setting-diff-layout="unified" aria-pressed="${preferences.diffLayout === "unified"}">Unified</button></div>`)}${settingsRow("Whitespace", "Show spaces and tabs in Diff panes.", `<label class="setting-toggle"><input id="setting-show-whitespace" type="checkbox" ${preferences.showWhitespace ? "checked" : ""} /><span>Show whitespace characters</span></label>`)}`,
      );
    case "code":
      return settingsGroup(
        "Code",
        "Syntax and language-specific services are introduced only when their boundaries are real.",
        `${settingsRow("Syntax highlighting", "CodeMirror language packages load on demand for editors and Diff panes.", '<span class="setting-value-pill success">Available</span>')}${settingsRow("Per-language formatting", "Formatter choice, style profiles, and format-on-save need the future language-service boundary.", '<span class="setting-planned">Planned</span>')}`,
      );
  }
}

function settingsGroup(title: string, description: string, rows: string): string {
  return `<section class="settings-group"><header><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></header><div class="settings-list">${rows}</div></section>`;
}

function settingsRow(label: string, description: string, control: string): string {
  return `<div class="settings-row"><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(description)}</span></div><div class="settings-control">${control}</div></div>`;
}

function editorFontControl(
  preferences: AppPreferences,
  status: EditorFontPresentationStatus,
): string {
  const selected = status.kind === "loading" && status.id
    ? status.id
    : preferences.editorFontFamily;
  let message = "Included with Asterlyn";
  let statusClass = "";
  if (status.kind === "loading" && status.id) {
    message = `Downloading and verifying ${editorFont(status.id).label}…`;
    statusClass = "loading";
  } else if (status.kind === "error" && status.message) {
    message = status.message;
    statusClass = "error";
  } else if (status.kind === "ready" && status.id !== DEFAULT_EDITOR_FONT_ID) {
    message = status.source === "download"
      ? "Downloaded, verified, and cached"
      : status.source === "download-uncached"
        ? "Loaded for this window; local cache is unavailable"
        : status.source === "cache"
          ? "Loaded from verified local cache"
          : "Ready in this window";
    statusClass = "success";
  }
  const retry = status.kind === "error" && status.id
    ? `<button class="setting-retry-button" id="setting-editor-font-retry" type="button">Retry ${escapeHtml(editorFont(status.id).label)}</button>`
    : "";
  return `<div class="editor-font-setting"><select id="setting-editor-font-family" aria-label="Editor font family" aria-describedby="setting-editor-font-status">${EDITOR_FONTS.map((definition) => `<option value="${definition.id}" ${definition.id === selected ? "selected" : ""}>${escapeHtml(editorFontOptionLabel(definition))}</option>`).join("")}</select><span class="editor-font-status ${statusClass}" id="setting-editor-font-status" role="status">${escapeHtml(message)}</span>${retry}</div>`;
}

function settingsSelect(
  id: string,
  ariaLabel: string,
  field: keyof Pick<AppPreferences, "uiFontSize" | "editorFontSize" | "editorLineHeight" | "editorLetterSpacing" | "editorIndentSize" | "editorTabSize">,
  values: readonly number[],
  selected: number,
  label: (value: number) => string,
): string {
  return `<select id="${id}" data-setting-number="${field}" aria-label="${escapeAttribute(ariaLabel)}">${values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label(value))}</option>`).join("")}</select>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
