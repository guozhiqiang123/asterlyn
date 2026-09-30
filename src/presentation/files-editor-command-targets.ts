import type { CommandFocusScope, CommandId } from "../application/commands/command-service.ts";
import {
  DIFF_COMMANDS,
  EDITOR_COMMANDS,
  FILES_COMMANDS,
} from "../application/commands/files-editor-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "./dom-command-definition.ts";
import type { ProjectFilesContextCommandAction } from "../features/files-editor/project-files-context-actions.ts";

const SURFACE_SCOPES: readonly CommandFocusScope[] = [
  "workbench", "input", "editor", "diff", "history", "terminal",
];
const EDITOR_SCOPES: readonly CommandFocusScope[] = ["workbench", "input", "editor"];
const DIFF_SCOPES: readonly CommandFocusScope[] = ["workbench", "diff"];

export const FILES_EDITOR_DOM_COMMANDS: readonly DomCommandDefinition[] = [
  files(FILES_COMMANDS.locateActive, "#locate-project-file", (copy) => copy.locateCurrentFile, "locate reveal current active file"),
  files(FILES_COMMANDS.expandFolder, "#expand-project-folder", (copy) => copy.expandSelectedFolder, "expand recursive folder tree"),
  files(FILES_COMMANDS.collapseFolder, "#collapse-project-folder", (copy) => copy.collapseSelectedFolder, "collapse recursive folder tree"),
  files(FILES_COMMANDS.openRecoveries, "[data-workspace-mutation-recovery-open]", (copy) => copy.contextMenu.recoveryTitle, "review recover file operation records"),
  files(FILES_COMMANDS.refresh, "#retry-project-files", (copy) => copy.tryAgain, "retry refresh reload project files"),
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

export interface ProjectFilesContextCommandDefinition {
  readonly id: CommandId;
  readonly action: ProjectFilesContextCommandAction;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
}

export const PROJECT_FILES_CONTEXT_COMMANDS: readonly ProjectFilesContextCommandDefinition[] = [
  filesContext(FILES_COMMANDS.openSelection, "open", (copy) => copy.contextMenu.open, "open activate selected file"),
  filesContext(FILES_COMMANDS.createFile, "new-file", (copy) => copy.contextMenu.newFile, "new create file selected folder"),
  filesContext(FILES_COMMANDS.renameSelection, "rename", (copy) => copy.contextMenu.rename, "rename selected file folder"),
  filesContext(FILES_COMMANDS.cutSelection, "cut", (copy) => copy.contextMenu.cut, "cut move selected file folder"),
  filesContext(FILES_COMMANDS.copySelection, "copy", (copy) => copy.contextMenu.copy, "copy duplicate selected file folder"),
  filesContext(FILES_COMMANDS.pasteSelection, "paste", (copy) => copy.contextMenu.paste, "paste file folder clipboard"),
  filesContext(FILES_COMMANDS.revealSelection, "reveal", (copy) => copy.contextMenu.reveal, "reveal selected system file manager finder explorer"),
  filesContext(FILES_COMMANDS.copyName, "copy-name", (copy) => copy.contextMenu.fileName, "copy selected file name"),
  filesContext(FILES_COMMANDS.copyRelativePath, "copy-relative-path", (copy) => copy.contextMenu.relativePath, "copy selected relative path"),
  filesContext(FILES_COMMANDS.copyAbsolutePath, "copy-absolute-path", (copy) => copy.contextMenu.absolutePath, "copy selected absolute full path"),
  filesContext(FILES_COMMANDS.selectionHistory, "history", (copy) => copy.contextMenu.gitHistory, "selected file folder git history log"),
  filesContext(FILES_COMMANDS.trashSelection, "trash", (copy) => copy.contextMenu.trash, "trash delete selected file folder"),
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

function filesContext(
  id: CommandId,
  action: ProjectFilesContextCommandAction,
  title: (copy: LocaleCatalog["projectFiles"]) => string,
  keywords: string,
): ProjectFilesContextCommandDefinition {
  return {
    id, action, keywords, scopes: SURFACE_SCOPES,
    title: (catalog) => title(catalog.projectFiles),
    detail: (catalog) => catalog.projectFiles.projectFiles,
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
