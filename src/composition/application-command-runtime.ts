import type { CommandRegistry } from "../application/commands/command-service.ts";
import {
  registerFilesEditorCommands,
  type FilesEditorCommandRuntimeOptions,
} from "./files-editor-command-runtime.ts";
import {
  registerWorkbenchCommands,
  type WorkbenchCommandRuntimeOptions,
} from "./workbench-command-runtime.ts";

export interface ApplicationCommandRuntimeOptions
  extends WorkbenchCommandRuntimeOptions, FilesEditorCommandRuntimeOptions {}

export function registerApplicationCommands(
  registry: CommandRegistry,
  options: ApplicationCommandRuntimeOptions,
): () => void {
  const releases = [
    registerWorkbenchCommands(registry, options),
    registerFilesEditorCommands(registry, options),
  ];
  return () => { for (const release of releases.reverse()) release(); };
}
