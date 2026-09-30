import type {
  CommandCategory,
  CommandFocusScope,
  CommandId,
} from "../application/commands/command-service.ts";
import {
  DIFF_COMMANDS,
  EDITOR_COMMANDS,
  FILES_COMMANDS,
} from "../application/commands/files-editor-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";

const SURFACE_SCOPES: readonly CommandFocusScope[] = [
  "workbench", "input", "editor", "diff", "history", "terminal",
];
const EDITOR_SCOPES: readonly CommandFocusScope[] = ["workbench", "input", "editor"];
const DIFF_SCOPES: readonly CommandFocusScope[] = ["workbench", "diff"];

export interface DomCommandDefinition {
  readonly id: CommandId;
  readonly category: CommandCategory;
  readonly selector: string;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
  readonly blockedReason: (catalog: LocaleCatalog) => string;
}

export const FILES_EDITOR_DOM_COMMANDS: readonly DomCommandDefinition[] = [
  files(FILES_COMMANDS.locateActive, "#locate-project-file", (copy) => copy.locateCurrentFile, "locate reveal current active file"),
  files(FILES_COMMANDS.expandFolder, "#expand-project-folder", (copy) => copy.expandSelectedFolder, "expand recursive folder tree"),
  files(FILES_COMMANDS.collapseFolder, "#collapse-project-folder", (copy) => copy.collapseSelectedFolder, "collapse recursive folder tree"),
  editor(EDITOR_COMMANDS.closeTab, '.editor-tab[aria-selected="true"] [data-close-editor-tab-index], .editor-tab[aria-selected="true"] [data-close-editor-pinned-preview-index], .editor-tab[aria-selected="true"] [data-close-editor-preview]', (catalog) => catalog.editor.closeFile(catalog.shell.editor), "close active tab preview"),
  editor(EDITOR_COMMANDS.toggleTabList, "#editor-tab-menu-toggle", (catalog) => catalog.shell.showOpenFiles, "open files tabs list"),
  editor(EDITOR_COMMANDS.markdownSource, '[data-markdown-mode="source"]', (catalog) => catalog.editor.sourceTitle, "markdown source edit"),
  editor(EDITOR_COMMANDS.markdownSplit, '[data-markdown-mode="split"]', (catalog) => catalog.editor.splitTitle, "markdown split preview"),
  editor(EDITOR_COMMANDS.markdownPreview, '[data-markdown-mode="preview"]', (catalog) => catalog.editor.previewTitle, "markdown rendered preview"),
  diff(DIFF_COMMANDS.previousChange, '[data-diff-action="previous-change"]', (copy) => copy.previousChange, "diff previous hunk change"),
  diff(DIFF_COMMANDS.nextChange, '[data-diff-action="next-change"]', (copy) => copy.nextChange, "diff next hunk change"),
  diff(DIFF_COMMANDS.previousFile, '[data-diff-action="previous-file"]', (copy) => copy.previousFile, "diff previous file"),
  diff(DIFF_COMMANDS.nextFile, '[data-diff-action="next-file"]', (copy) => copy.nextFile, "diff next file"),
  diff(DIFF_COMMANDS.openSource, '[data-diff-action="open-source"]', (copy) => copy.openSource, "diff source reveal project"),
  diff(DIFF_COMMANDS.toggleUnchanged, '[data-diff-action="toggle-unchanged"]', (copy) => copy.expandUnchanged, "diff unchanged context expand collapse"),
  diff(DIFF_COMMANDS.unified, '[data-diff-layout="unified"]', (copy) => copy.unifiedTitle, "diff unified layout"),
  diff(DIFF_COMMANDS.split, '[data-diff-layout="split"]', (copy) => copy.sideBySideTitle, "diff split side by side layout"),
  diff(DIFF_COMMANDS.toggleWhitespace, "[data-diff-whitespace]", (copy) => copy.whitespaceTitle, "diff whitespace characters"),
];

function files(
  id: CommandId,
  selector: string,
  title: (copy: LocaleCatalog["projectFiles"]) => string,
  keywords: string,
): DomCommandDefinition {
  return {
    id, selector, keywords, category: "workspace", scopes: SURFACE_SCOPES,
    title: (catalog) => title(catalog.projectFiles),
    detail: (catalog) => catalog.projectFiles.projectFiles,
    blockedReason: (catalog) => catalog.settings.keybindings.workspaceRequired,
  };
}

function editor(
  id: CommandId,
  selector: string,
  title: (catalog: LocaleCatalog) => string,
  keywords: string,
): DomCommandDefinition {
  return {
    id, selector, title, keywords, category: "editor", scopes: EDITOR_SCOPES,
    detail: (catalog) => catalog.shell.editor,
    blockedReason: (catalog) => catalog.settings.keybindings.editorRequired,
  };
}

function diff(
  id: CommandId,
  selector: string,
  title: (copy: LocaleCatalog["editor"]) => string,
  keywords: string,
): DomCommandDefinition {
  return {
    id, selector, keywords, category: "editor", scopes: DIFF_SCOPES,
    title: (catalog) => title(catalog.editor),
    detail: (catalog) => catalog.editor.diffToolbar,
    blockedReason: (catalog) => catalog.settings.keybindings.editorRequired,
  };
}
