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
import type { SettingsCopy } from "../../localization/catalog.ts";
import { EN_US } from "../../localization/en-US.ts";
import { renderSelectControl } from "../../shared/select-control.ts";

export interface EditorFontPresentationStatus {
  id: EditorFontId | null;
  kind: "idle" | "loading" | "ready" | "error";
  source?: EditorFontLoadSource;
  message?: string;
}

export function renderSettingsNavigation(
  section: SettingsSection,
  copy: SettingsCopy = EN_US.settings,
): string {
  const sections = Object.entries(copy.sections) as Array<[SettingsSection, string]>;
  return sections.map(([id, label]) => {
    const selected = section === id;
    return `<button class="settings-navigation-item ${selected ? "selected" : ""}" type="button" data-settings-section="${id}" aria-current="${selected ? "page" : "false"}">${label}</button>`;
  }).join("");
}

export function renderSettingsSection(
  state: SettingsState,
  fontStatus: EditorFontPresentationStatus,
  copy: SettingsCopy = EN_US.settings,
): string {
  const preferences = state.preferences;
  switch (state.section) {
    case "general":
      return settingsGroup(
        copy.generalTitle,
        copy.generalDescription,
        settingsRow(copy.languageLabel, copy.languageDescription, `<div class="setting-segmented" role="group" aria-label="${escapeAttribute(copy.languageLabel)}"><button type="button" data-setting-locale="system" aria-pressed="${preferences.locale === "system"}">${escapeHtml(copy.languageSystem)}</button><button type="button" data-setting-locale="en-US" aria-pressed="${preferences.locale === "en-US"}">${escapeHtml(copy.languageEnglish)}</button><button type="button" data-setting-locale="zh-CN" aria-pressed="${preferences.locale === "zh-CN"}">${escapeHtml(copy.languageChinese)}</button></div>`),
      );
    case "appearance":
      return settingsGroup(
        copy.appearanceTitle,
        copy.appearanceDescription,
        `${settingsRow(copy.themeLabel, copy.themeDescription, `<div class="setting-segmented" role="group" aria-label="${escapeAttribute(copy.themeLabel)}"><button type="button" data-setting-theme="system" aria-pressed="${preferences.theme === "system"}">${escapeHtml(copy.themeSystem)}</button><button type="button" data-setting-theme="dark" aria-pressed="${preferences.theme === "dark"}">${escapeHtml(copy.themeDark)}</button><button type="button" data-setting-theme="light" aria-pressed="${preferences.theme === "light"}">${escapeHtml(copy.themeLight)}</button></div>`)}${settingsRow(copy.applicationFontLabel, copy.applicationFontDescription, settingsSelect("setting-ui-font", copy.applicationFontAria, "uiFontSize", UI_FONT_SIZES, preferences.uiFontSize, (value) => `${value} px`))}`,
      );
    case "editor":
      return settingsGroup(
        copy.editorTitle,
        copy.editorDescription,
        `${settingsRow(copy.editorFontLabel, copy.editorFontDescription, editorFontControl(preferences, fontStatus, copy))}${settingsRow(copy.editorFontSizeLabel, copy.editorFontSizeDescription, settingsSelect("setting-editor-font", copy.editorFontSizeAria, "editorFontSize", EDITOR_FONT_SIZES, preferences.editorFontSize, (value) => `${value} px`))}${settingsRow(copy.lineSpacingLabel, copy.lineSpacingDescription, settingsSelect("setting-editor-line-height", copy.lineSpacingAria, "editorLineHeight", EDITOR_LINE_HEIGHTS, preferences.editorLineHeight, (value) => value.toFixed(2)))}${settingsRow(copy.letterSpacingLabel, copy.letterSpacingDescription, settingsSelect("setting-editor-letter-spacing", copy.letterSpacingAria, "editorLetterSpacing", EDITOR_LETTER_SPACINGS, preferences.editorLetterSpacing, (value) => value === 0 ? copy.defaultPixels(0) : `${value > 0 ? "+" : ""}${value} px`))}${settingsRow(copy.indentLabel, copy.indentDescription, settingsSelect("setting-editor-indent", copy.indentAria, "editorIndentSize", EDITOR_INDENT_SIZES, preferences.editorIndentSize, copy.spaces))}${settingsRow(copy.tabWidthLabel, copy.tabWidthDescription, settingsSelect("setting-editor-tab", copy.tabWidthAria, "editorTabSize", EDITOR_TAB_SIZES, preferences.editorTabSize, copy.spaces))}`,
      );
    case "version-control":
      return settingsGroup(
        copy.versionControlTitle,
        copy.versionControlDescription,
        `${settingsRow(copy.diffLayoutLabel, copy.diffLayoutDescription, `<div class="setting-segmented" role="group" aria-label="${escapeAttribute(copy.diffLayoutAria)}"><button type="button" data-setting-diff-layout="split" aria-pressed="${preferences.diffLayout === "split"}">${escapeHtml(copy.sideBySide)}</button><button type="button" data-setting-diff-layout="unified" aria-pressed="${preferences.diffLayout === "unified"}">${escapeHtml(copy.unified)}</button></div>`)}${settingsRow(copy.whitespaceLabel, copy.whitespaceDescription, `<label class="setting-toggle"><input id="setting-show-whitespace" type="checkbox" ${preferences.showWhitespace ? "checked" : ""} /><span>${escapeHtml(copy.showWhitespace)}</span></label>`)}`,
      );
    case "code":
      return settingsGroup(
        copy.codeTitle,
        copy.codeDescription,
        `${settingsRow(copy.syntaxHighlighting, copy.syntaxDescription, `<span class="setting-value-pill success">${escapeHtml(copy.available)}</span>`)}${settingsRow(copy.formatting, copy.formattingDescription, `<span class="setting-planned">${escapeHtml(copy.planned)}</span>`)}`,
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
  copy: SettingsCopy,
): string {
  const selected = status.kind === "loading" && status.id
    ? status.id
    : preferences.editorFontFamily;
  let message = copy.includedWithApp;
  let statusClass = "";
  if (status.kind === "loading" && status.id) {
    message = copy.downloadingFont(editorFont(status.id).label);
    statusClass = "loading";
  } else if (status.kind === "error" && status.message) {
    message = status.message;
    statusClass = "error";
  } else if (status.kind === "ready" && status.id !== DEFAULT_EDITOR_FONT_ID) {
    message = status.source === "download"
      ? copy.downloadedFont
      : status.source === "download-uncached"
        ? copy.uncachedFont
        : status.source === "cache"
          ? copy.cachedFont
          : copy.fontReady;
    statusClass = "success";
  }
  const retry = status.kind === "error" && status.id
    ? `<button class="setting-retry-button" id="setting-editor-font-retry" type="button">${escapeHtml(copy.retryFont(editorFont(status.id).label))}</button>`
    : "";
  return `<div class="editor-font-setting">${renderSelectControl(`<select id="setting-editor-font-family" aria-label="${escapeAttribute(copy.editorFontAria)}" aria-describedby="setting-editor-font-status">${EDITOR_FONTS.map((definition) => `<option value="${definition.id}" ${definition.id === selected ? "selected" : ""}>${escapeHtml(editorFontOptionLabel(definition))}</option>`).join("")}</select>`)}<span class="editor-font-status ${statusClass}" id="setting-editor-font-status" role="status">${escapeHtml(message)}</span>${retry}</div>`;
}

function settingsSelect(
  id: string,
  ariaLabel: string,
  field: keyof Pick<AppPreferences, "uiFontSize" | "editorFontSize" | "editorLineHeight" | "editorLetterSpacing" | "editorIndentSize" | "editorTabSize">,
  values: readonly number[],
  selected: number,
  label: (value: number) => string,
): string {
  return renderSelectControl(`<select id="${id}" data-setting-number="${field}" aria-label="${escapeAttribute(ariaLabel)}">${values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label(value))}</option>`).join("")}</select>`);
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
