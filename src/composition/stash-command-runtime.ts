import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { StashCommandAction } from "../application/commands/stash-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import { STASH_COMMAND_DEFINITIONS } from "../presentation/stash-command-targets.ts";

export interface StashCommandRuntimeOptions {
  readonly catalog: () => LocaleCatalog;
  readonly stashCommandAvailability: (action: StashCommandAction) => CommandAvailability;
  readonly executeStashCommand: (action: StashCommandAction) => void | Promise<void>;
}

export function registerStashCommands(
  registry: CommandRegistry,
  options: StashCommandRuntimeOptions,
): () => void {
  const descriptors = STASH_COMMAND_DEFINITIONS.map((definition): CommandDescriptor => ({
    id: definition.id,
    category: "workspace",
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => options.stashCommandAvailability(definition.action),
    execute: () => options.executeStashCommand(definition.action),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); };
}
