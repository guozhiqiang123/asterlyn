import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { SearchCommandAction } from "../application/commands/search-command-ids.ts";
import {
  SEARCH_COMMAND_DEFINITIONS,
  SEARCH_REPLACEMENT_DOM_COMMANDS,
} from "../presentation/search-command-targets.ts";
import { registerDomCommands, type DomCommandRuntimeOptions } from "./dom-command-runtime.ts";

export interface SearchCommandRuntimeOptions extends DomCommandRuntimeOptions {
  readonly searchCommandAvailability: (action: SearchCommandAction) => CommandAvailability;
  readonly executeSearchCommand: (action: SearchCommandAction) => void | Promise<void>;
}

export function registerSearchCommands(
  registry: CommandRegistry,
  options: SearchCommandRuntimeOptions,
): () => void {
  const releaseDom = registerDomCommands(registry, SEARCH_REPLACEMENT_DOM_COMMANDS, options);
  const descriptors = SEARCH_COMMAND_DEFINITIONS.map((definition): CommandDescriptor => ({
    id: definition.id, category: "workspace", userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => options.searchCommandAvailability(definition.action),
    execute: () => options.executeSearchCommand(definition.action),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); releaseDom(); };
}
