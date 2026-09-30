import type { CommandFocusScope, CommandId } from "../application/commands/command-service.ts";
import {
  STASH_COMMANDS,
  type StashCommandAction,
} from "../application/commands/stash-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "./dom-command-definition.ts";

const STASH_SCOPES: readonly CommandFocusScope[] = [
  "stash",
];

export interface StashCommandDefinition {
  readonly id: CommandId;
  readonly action: StashCommandAction;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
  readonly presentationSelector?: string;
}

export const STASH_COMMAND_DEFINITIONS: readonly StashCommandDefinition[] = [
  stash(STASH_COMMANDS.refresh, "refresh", (catalog) => `${catalog.navigation.commands.refresh.label}: ${catalog.stash.title}`, "refresh reload stash catalog details"),
  stash(STASH_COMMANDS.toggleFileView, "toggle-view", (catalog) => catalog.history.showChangedFilesAs(`${catalog.history.flatList} / ${catalog.history.directoryTree}`), "stash files tree flat view", "#stash-file-view-toggle"),
  stash(STASH_COMMANDS.expandAll, "expand-all", (catalog) => catalog.history.expandChangedFolders, "stash expand all folders", "#stash-file-expand-all"),
  stash(STASH_COMMANDS.collapseAll, "collapse-all", (catalog) => catalog.history.collapseChangedFolders, "stash collapse all folders", "#stash-file-collapse-all"),
  stash(STASH_COMMANDS.openFileDiff, "open-diff", (catalog) => catalog.stash.showDiff, "open selected stash file diff"),
  stash(STASH_COMMANDS.openFileDiffNewTab, "open-diff-new-tab", (catalog) => catalog.stash.showDiffNewTab, "open selected stash file diff new pinned tab"),
  stash(STASH_COMMANDS.apply, "apply", (catalog) => catalog.stash.apply, "apply selected stash keep", '[data-stash-action="apply"]'),
  stash(STASH_COMMANDS.pop, "pop", (catalog) => catalog.stash.pop, "pop apply remove selected stash", '[data-stash-action="pop"]'),
  stash(STASH_COMMANDS.unstash, "unstash", (catalog) => catalog.stash.unstash, "open selected stash advanced apply pop branch options"),
  stash(STASH_COMMANDS.drop, "drop", (catalog) => catalog.stash.drop, "drop delete selected stash confirmed"),
  stash(STASH_COMMANDS.clear, "clear", (catalog) => catalog.stash.clear, "clear delete all repository stashes confirmed"),
];

export const STASH_SHORTCUT_TARGETS: readonly DomCommandDefinition[] =
  STASH_COMMAND_DEFINITIONS.flatMap((definition) => definition.presentationSelector
    ? [{
        id: definition.id,
        category: "workspace" as const,
        selector: definition.presentationSelector,
        scopes: definition.scopes,
        title: definition.title,
        detail: definition.detail,
        keywords: definition.keywords,
        blockedReason: (catalog: LocaleCatalog) => catalog.settings.keybindings.gitRequired,
      }]
    : []);

function stash(
  id: CommandId,
  action: StashCommandAction,
  title: (catalog: LocaleCatalog) => string,
  keywords: string,
  presentationSelector?: string,
): StashCommandDefinition {
  return {
    id, action, title, keywords, presentationSelector, scopes: STASH_SCOPES,
    detail: (catalog) => catalog.stash.title,
  };
}
