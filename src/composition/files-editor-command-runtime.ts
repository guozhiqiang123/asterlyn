import type { CommandRegistry } from "../application/commands/command-service.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import {
  FILES_EDITOR_DOM_COMMANDS,
} from "../presentation/files-editor-command-targets.ts";
import { registerDomCommands } from "./dom-command-runtime.ts";

export interface FilesEditorCommandRuntimeOptions {
  readonly root: ParentNode;
  readonly catalog: () => LocaleCatalog;
}

export function registerFilesEditorCommands(
  registry: CommandRegistry,
  options: FilesEditorCommandRuntimeOptions,
): () => void {
  return registerDomCommands(registry, FILES_EDITOR_DOM_COMMANDS, options);
}
