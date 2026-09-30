import type { CommandAvailability, CommandDescriptor, CommandRegistry } from "../application/commands/command-service.ts";
import type { ProjectFilesContextCommandAction } from "../features/files-editor/project-files-context-actions.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import {
  EDITOR_TAB_COMMANDS,
  FILES_EDITOR_DOM_COMMANDS,
  PROJECT_FILES_CONTEXT_COMMANDS,
} from "../presentation/files-editor-command-targets.ts";
import { registerDomCommands } from "./dom-command-runtime.ts";
import { EditorTabCommandAdapter } from "./editor-tab-command-adapter.ts";

export interface FilesEditorCommandRuntimeOptions {
  readonly root: ParentNode;
  readonly catalog: () => LocaleCatalog;
  readonly projectFilesCommandAvailability: (action: ProjectFilesContextCommandAction) => CommandAvailability;
  readonly executeProjectFilesCommand: (action: ProjectFilesContextCommandAction) => void | Promise<void>;
}

export function registerFilesEditorCommands(
  registry: CommandRegistry,
  options: FilesEditorCommandRuntimeOptions,
): () => void {
  const releaseDom = registerDomCommands(registry, FILES_EDITOR_DOM_COMMANDS, options);
  const tabAdapter = new EditorTabCommandAdapter(
    options.root,
    () => options.catalog().settings.keybindings.editorRequired,
  );
  const definitions = [
    ...PROJECT_FILES_CONTEXT_COMMANDS.map((definition) => ({
      ...definition,
      category: "workspace" as const,
      availability: () => options.projectFilesCommandAvailability(definition.action),
      execute: () => options.executeProjectFilesCommand(definition.action),
    })),
    ...EDITOR_TAB_COMMANDS.map((definition) => ({
      ...definition,
      category: "editor" as const,
      availability: () => tabAdapter.availability(),
      execute: () => tabAdapter.execute(definition.action),
    })),
  ];
  const releases = definitions.map((definition) => registry.register({
    id: definition.id,
    category: definition.category,
    userBindingScopes: definition.scopes,
    title: () => definition.title(options.catalog()),
    detail: () => definition.detail(options.catalog()),
    keywords: () => definition.keywords,
    availability: definition.availability,
    execute: definition.execute,
  } satisfies CommandDescriptor));
  return () => {
    for (const release of releases.reverse()) release();
    releaseDom();
  };
}
