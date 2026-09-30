import type { CommandFocusScope, CommandId } from "../application/commands/command-service.ts";
import {
  SEARCH_COMMANDS,
  type SearchCommandAction,
} from "../application/commands/search-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "./dom-command-definition.ts";

const SEARCH_SCOPES: readonly CommandFocusScope[] = ["workbench", "input", "editor", "diff", "history"];

export interface SearchCommandDefinition {
  readonly id: CommandId;
  readonly action: SearchCommandAction;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
  readonly presentationSelector: string;
}

export const SEARCH_COMMAND_DEFINITIONS: readonly SearchCommandDefinition[] = [
  search(SEARCH_COMMANDS.locateCurrent, "locate-current", (catalog) => catalog.projectFiles.locateCurrentFile, "find results locate current file", '[data-find-action="locate"]'),
  search(SEARCH_COMMANDS.toggleResultsView, "toggle-results-view", (catalog) => catalog.projectFiles.showAs(`${catalog.projectFiles.flatList} / ${catalog.projectFiles.directoryTree}`), "find results tree flat view", '[data-find-action="view"]'),
  search(SEARCH_COMMANDS.expandResults, "expand-results", (catalog) => catalog.projectFiles.expandSelectedFolder, "find results expand selected folder", '[data-find-action="expand"]'),
  search(SEARCH_COMMANDS.collapseResults, "collapse-results", (catalog) => catalog.projectFiles.collapseSelectedFolder, "find results collapse selected folder", '[data-find-action="collapse"]'),
];

export const SEARCH_REPLACEMENT_DOM_COMMANDS: readonly DomCommandDefinition[] = [
  {
    id: SEARCH_COMMANDS.previewReplacement, category: "workspace",
    selector: "#workspace-replacement-preview", scopes: ["workbench", "input"],
    title: (catalog) => catalog.navigation.previewReplace,
    detail: (catalog) => catalog.replacement.safeWorkspaceEdit,
    keywords: "search replace preview review workspace files",
    blockedReason: (catalog) => catalog.settings.keybindings.workspaceRequired,
  },
  {
    id: SEARCH_COMMANDS.applyReplacement, category: "workspace",
    selector: "#replacement-apply", scopes: ["dialog"],
    title: (catalog) => catalog.replacement.reviewAndApply,
    detail: (catalog) => catalog.replacement.safeWorkspaceEdit,
    keywords: "search replace apply reviewed selected files",
    blockedReason: (catalog) => catalog.replacement.previewUnavailable,
  },
];

export const SEARCH_SHORTCUT_TARGETS: readonly DomCommandDefinition[] = [
  ...SEARCH_REPLACEMENT_DOM_COMMANDS,
  ...SEARCH_COMMAND_DEFINITIONS.map((definition) => ({
  id: definition.id, category: "workspace" as const, selector: definition.presentationSelector,
  scopes: definition.scopes, title: definition.title, detail: definition.detail,
  keywords: definition.keywords,
  blockedReason: (catalog: LocaleCatalog) => catalog.settings.keybindings.bottomToolRequired,
  })),
];

function search(
  id: CommandId,
  action: SearchCommandAction,
  title: (catalog: LocaleCatalog) => string,
  keywords: string,
  presentationSelector: string,
): SearchCommandDefinition {
  return {
    id, action, title, keywords, presentationSelector, scopes: SEARCH_SCOPES,
    detail: (catalog) => catalog.navigation.findWindow,
  };
}
