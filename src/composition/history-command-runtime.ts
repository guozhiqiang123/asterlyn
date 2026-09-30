import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { HistoryContextCommandAction } from "../application/commands/history-command-ids.ts";
import {
  HISTORY_CONTEXT_COMMANDS,
  HISTORY_DOM_COMMANDS,
} from "../presentation/history-command-targets.ts";
import { registerDomCommands, type DomCommandRuntimeOptions } from "./dom-command-runtime.ts";

export interface HistoryCommandRuntimeOptions extends DomCommandRuntimeOptions {
  readonly historyCommandAvailability: (action: HistoryContextCommandAction) => CommandAvailability;
  readonly executeHistoryCommand: (action: HistoryContextCommandAction) => void | Promise<void>;
}

export function registerHistoryCommands(
  registry: CommandRegistry,
  options: HistoryCommandRuntimeOptions,
): () => void {
  const releaseDom = registerDomCommands(registry, HISTORY_DOM_COMMANDS, options);
  const descriptors = HISTORY_CONTEXT_COMMANDS.map((definition): CommandDescriptor => ({
    id: definition.id,
    category: "workspace",
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => options.historyCommandAvailability(definition.action),
    execute: () => options.executeHistoryCommand(definition.action),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => {
    for (const release of releases.reverse()) release();
    releaseDom();
  };
}
