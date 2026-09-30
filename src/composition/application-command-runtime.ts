import type { CommandRegistry } from "../application/commands/command-service.ts";
import {
  registerChangesCommands,
  type ChangesCommandRuntimeOptions,
} from "./changes-command-runtime.ts";
import {
  registerFilesEditorCommands,
  type FilesEditorCommandRuntimeOptions,
} from "./files-editor-command-runtime.ts";
import {
  registerWorkbenchCommands,
  type WorkbenchCommandRuntimeOptions,
} from "./workbench-command-runtime.ts";
import {
  registerStashCommands,
  type StashCommandRuntimeOptions,
} from "./stash-command-runtime.ts";
import {
  registerHistoryCommands,
  type HistoryCommandRuntimeOptions,
} from "./history-command-runtime.ts";
import {
  registerRemoteCommands,
  type RemoteCommandRuntimeOptions,
} from "./remote-command-runtime.ts";
import {
  registerSearchCommands,
  type SearchCommandRuntimeOptions,
} from "./search-command-runtime.ts";
import {
  registerGitOperationCommands,
  type GitOperationCommandRuntimeOptions,
} from "./git-operation-command-runtime.ts";
import {
  registerTerminalCommands,
  type TerminalCommandRuntimeOptions,
} from "./terminal-command-runtime.ts";

export interface ApplicationCommandRuntimeOptions
  extends WorkbenchCommandRuntimeOptions, FilesEditorCommandRuntimeOptions,
    ChangesCommandRuntimeOptions, StashCommandRuntimeOptions, HistoryCommandRuntimeOptions,
    RemoteCommandRuntimeOptions, SearchCommandRuntimeOptions, GitOperationCommandRuntimeOptions,
    TerminalCommandRuntimeOptions {}

export function registerApplicationCommands(
  registry: CommandRegistry,
  options: ApplicationCommandRuntimeOptions,
): () => void {
  const releases = [
    registerWorkbenchCommands(registry, options),
    registerFilesEditorCommands(registry, options),
    registerChangesCommands(registry, options),
    registerStashCommands(registry, options),
    registerHistoryCommands(registry, options),
    registerRemoteCommands(registry, options),
    registerSearchCommands(registry, options),
    registerGitOperationCommands(registry, options),
    registerTerminalCommands(registry, options),
  ];
  return () => { for (const release of releases.reverse()) release(); };
}
