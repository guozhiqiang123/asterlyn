import type {
  CommandAvailability,
  CommandDescriptor,
  CommandRegistry,
} from "../application/commands/command-service.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import {
  FILES_EDITOR_DOM_COMMANDS,
  type DomCommandDefinition,
} from "../presentation/files-editor-command-targets.ts";

export interface FilesEditorCommandRuntimeOptions {
  readonly root: ParentNode;
  readonly catalog: () => LocaleCatalog;
}

export function registerFilesEditorCommands(
  registry: CommandRegistry,
  options: FilesEditorCommandRuntimeOptions,
): () => void {
  const descriptors = FILES_EDITOR_DOM_COMMANDS.map((definition): CommandDescriptor => ({
    id: definition.id,
    category: definition.category,
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: () => availability(options.root, definition, options.catalog()),
    execute: () => target(options.root, definition)?.click(),
  }));
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => { for (const release of releases.reverse()) release(); };
}

function availability(
  root: ParentNode,
  definition: DomCommandDefinition,
  catalog: LocaleCatalog,
): CommandAvailability {
  return target(root, definition)
    ? { enabled: true }
    : { enabled: false, reason: definition.blockedReason(catalog) };
}

function target(root: ParentNode, definition: DomCommandDefinition): HTMLButtonElement | null {
  const button = root.querySelector<HTMLButtonElement>(definition.selector);
  return button && !button.disabled && button.getAttribute("aria-disabled") !== "true"
    ? button
    : null;
}
