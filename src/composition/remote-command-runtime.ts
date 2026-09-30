import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { RemoteCommandAction } from "../application/commands/remote-command-ids.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import { REMOTE_COMMAND_DEFINITIONS } from "../presentation/remote-command-targets.ts";

export interface RemoteCommandRuntimeOptions {
  readonly catalog: () => LocaleCatalog;
  readonly remoteCommandAvailability: (action: RemoteCommandAction) => CommandAvailability;
  readonly executeRemoteCommand: (action: RemoteCommandAction) => void | Promise<void>;
}

export function registerRemoteCommands(
  registry: CommandRegistry,
  options: RemoteCommandRuntimeOptions,
): () => void {
  const descriptors = REMOTE_COMMAND_DEFINITIONS.map((definition): CommandDescriptor => ({
    id: definition.id,
    category: "workspace",
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => options.remoteCommandAvailability(definition.action),
    execute: () => options.executeRemoteCommand(definition.action),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); };
}
