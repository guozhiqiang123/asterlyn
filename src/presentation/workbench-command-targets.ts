import {
  TOOL_FOCUS_SCOPES,
  type CommandId,
} from "../application/commands/command-service.ts";
import { WORKBENCH_COMMANDS } from "../application/commands/workbench-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "./dom-command-definition.ts";

export const WORKBENCH_DOM_COMMANDS: readonly DomCommandDefinition[] = [
  workbench(WORKBENCH_COMMANDS.toggleRepositoryMenu, "#repository-switcher", (catalog) => catalog.shell.openProjectMenu, "project repository recent menu switch open"),
  workbench(WORKBENCH_COMMANDS.dismissNotification, "#toast:not(.hidden) #toast-close", (catalog) => catalog.shell.dismissError, "dismiss close visible error warning notification toast"),
];

function workbench(
  id: CommandId,
  selector: string,
  title: (catalog: LocaleCatalog) => string,
  keywords: string,
): DomCommandDefinition {
  return {
    id, selector, title, keywords, category: "workbench", scopes: TOOL_FOCUS_SCOPES,
    detail: (catalog) => catalog.shell.projectMenu,
    blockedReason: (catalog) => catalog.shell.dismissError,
  };
}
