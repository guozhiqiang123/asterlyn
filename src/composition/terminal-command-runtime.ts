import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { TerminalCommandAction } from "../application/commands/terminal-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import { TERMINAL_COMMAND_DEFINITIONS } from "../presentation/terminal-command-targets.ts";

export interface TerminalCommandRuntimeOptions {
  readonly catalog: () => LocaleCatalog;
  readonly terminalCommandAvailable: (action: TerminalCommandAction) => boolean;
  readonly executeTerminalCommand: (action: TerminalCommandAction) => void | Promise<void>;
}

export function registerTerminalCommands(
  registry: CommandRegistry,
  options: TerminalCommandRuntimeOptions,
): () => void {
  const descriptors = TERMINAL_COMMAND_DEFINITIONS.map((definition): CommandDescriptor => ({
    id: definition.id,
    category: "workspace",
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: (): CommandAvailability => options.terminalCommandAvailable(definition.action)
      ? { enabled: true }
      : { enabled: false, reason: options.catalog().terminal.notRunning },
    execute: () => options.executeTerminalCommand(definition.action),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); };
}
