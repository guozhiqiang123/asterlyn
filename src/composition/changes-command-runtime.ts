import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { ChangesContextCommandAction } from "../features/changes-commit/changes-context-actions.ts";
import {
  CHANGES_CONTEXT_COMMANDS,
  CHANGES_DOM_COMMANDS,
} from "../presentation/changes-command-targets.ts";
import { registerDomCommands, type DomCommandRuntimeOptions } from "./dom-command-runtime.ts";

export interface ChangesCommandRuntimeOptions extends DomCommandRuntimeOptions {
  readonly changesCommandAvailability: (action: ChangesContextCommandAction) => CommandAvailability;
  readonly executeChangesCommand: (action: ChangesContextCommandAction) => void | Promise<void>;
}

export function registerChangesCommands(
  registry: CommandRegistry,
  options: ChangesCommandRuntimeOptions,
): () => void {
  const releaseDom = registerDomCommands(registry, CHANGES_DOM_COMMANDS, options);
  const descriptors = CHANGES_CONTEXT_COMMANDS.map((definition): CommandDescriptor => ({
    id: definition.id,
    category: "workspace",
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => options.changesCommandAvailability(definition.action),
    execute: () => options.executeChangesCommand(definition.action),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => {
    for (const release of releases.reverse()) release();
    releaseDom();
  };
}
