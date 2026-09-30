import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import type { DomCommandDefinition } from "../presentation/dom-command-definition.ts";

export interface DomCommandRuntimeOptions {
  readonly root: ParentNode;
  readonly catalog: () => LocaleCatalog;
}

export function registerDomCommands(
  registry: CommandRegistry,
  definitions: readonly DomCommandDefinition[],
  options: DomCommandRuntimeOptions,
): () => void {
  const descriptors = definitions.map((definition): CommandDescriptor => ({
    id: definition.id,
    category: definition.category,
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => domAvailability(options.root, definition, options.catalog()),
    execute: () => enabledDomTarget(options.root, definition)?.click(),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); };
}

function domAvailability(
  root: ParentNode,
  definition: DomCommandDefinition,
  catalog: LocaleCatalog,
): CommandAvailability {
  return enabledDomTarget(root, definition)
    ? { enabled: true }
    : { enabled: false, reason: definition.blockedReason(catalog) };
}

function enabledDomTarget(
  root: ParentNode,
  definition: DomCommandDefinition,
): HTMLButtonElement | null {
  const button = root.querySelector<HTMLButtonElement>(definition.selector);
  return button && !button.disabled && button.getAttribute("aria-disabled") !== "true"
    ? button
    : null;
}
