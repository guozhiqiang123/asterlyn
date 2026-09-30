import type { CommandFocusScope, CommandId } from "../application/commands/command-service.ts";
import {
  TERMINAL_COMMANDS,
  type TerminalCommandAction,
} from "../application/commands/terminal-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";

const TERMINAL_SCOPES: readonly CommandFocusScope[] = ["terminal"];

export interface TerminalCommandDefinition {
  readonly id: CommandId;
  readonly action: TerminalCommandAction;
  readonly scopes: readonly CommandFocusScope[];
  readonly title: (catalog: LocaleCatalog) => string;
  readonly detail: (catalog: LocaleCatalog) => string;
  readonly keywords: string;
  readonly presentationSelector: string;
}

export const TERMINAL_COMMAND_DEFINITIONS: readonly TerminalCommandDefinition[] = [
  terminal(TERMINAL_COMMANDS.restart, "restart", (catalog) => catalog.terminal.newSession, "terminal restart start new shell session"),
  terminal(TERMINAL_COMMANDS.clear, "clear", (catalog) => catalog.terminal.clear, "terminal clear display scrollback"),
  terminal(TERMINAL_COMMANDS.close, "close", (catalog) => catalog.terminal.close, "terminal close stop supervised shell session"),
];

function terminal(
  id: CommandId,
  action: TerminalCommandAction,
  title: (catalog: LocaleCatalog) => string,
  keywords: string,
): TerminalCommandDefinition {
  return {
    id, action, title, keywords, scopes: TERMINAL_SCOPES,
    detail: (catalog) => catalog.shell.terminal,
    presentationSelector: `[data-terminal-action="${action}"]`,
  };
}
