import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { SearchCommandAction } from "../application/commands/search-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import { SEARCH_COMMAND_DEFINITIONS } from "../presentation/search-command-targets.ts";

export interface SearchCommandRuntimeOptions {
  readonly catalog: () => LocaleCatalog;
  readonly searchCommandAvailability: (action: SearchCommandAction) => CommandAvailability;
  readonly executeSearchCommand: (action: SearchCommandAction) => void | Promise<void>;
}

export function registerSearchCommands(
  registry: CommandRegistry,
  options: SearchCommandRuntimeOptions,
): () => void {
  const descriptors = SEARCH_COMMAND_DEFINITIONS.map((definition): CommandDescriptor => ({
    id: definition.id, category: "workspace", userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => options.searchCommandAvailability(definition.action),
    execute: () => options.executeSearchCommand(definition.action),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); };
}
