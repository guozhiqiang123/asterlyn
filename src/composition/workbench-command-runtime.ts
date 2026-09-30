import {
  CommandRegistry,
  type CommandAvailability,
  type CommandDescriptor,
  type CommandFocusScope,
  type CommandId,
} from "../application/commands/command-service.ts";
import { WORKBENCH_COMMANDS } from "../application/commands/workbench-command-ids.ts";
import type { NavigationCommandId } from "../localization/catalog.ts";
import type { ActivityTool } from "../shell/activity-order.ts";

const WORKBENCH_SCOPES: readonly CommandFocusScope[] = [
  "workbench",
  "input",
  "editor",
  "diff",
  "history",
];

export interface WorkbenchCommandRuntimeOptions {
  readonly navigationCopy: () => Record<NavigationCommandId, {
    readonly label: string;
    readonly detail: string;
    readonly aliases: string;
  }>;
  readonly commandPaletteCopy: () => { readonly label: string; readonly detail: string };
  readonly workspaceRequiredReason: () => string;
  readonly editorRequiredReason: () => string;
  readonly historyRequiredReason: () => string;
  readonly gitRequiredReason: () => string;
  readonly workspaceOpen: () => boolean;
  readonly gitAvailable: () => boolean;
  readonly editorFindAvailable: () => boolean;
  readonly historyFindAvailable: () => boolean;
  readonly saveAvailable: () => boolean;
  readonly refreshAvailable: () => boolean;
  readonly openCommandSurface: (mode: "files" | "recent" | "workspace" | "commands") => void;
  readonly openRepository: () => void | Promise<void>;
  readonly openEditorFind: () => void;
  readonly focusHistoryFilter: () => void;
  readonly saveFile: () => void | Promise<void>;
  readonly refresh: () => void | Promise<void>;
  readonly toggleTool: (tool: ActivityTool) => void;
}

export function registerWorkbenchCommands(
  registry: CommandRegistry,
  options: WorkbenchCommandRuntimeOptions,
): () => void {
  const enabled = (): CommandAvailability => ({ enabled: true });
  const workspace = (): CommandAvailability => options.workspaceOpen()
    ? enabled()
    : { enabled: false, reason: options.workspaceRequiredReason() };
  const git = (): CommandAvailability => options.gitAvailable()
    ? enabled()
    : { enabled: false, reason: options.gitRequiredReason() };
  const navigation = (
    id: CommandId,
    copyId: NavigationCommandId,
    category: CommandDescriptor["category"],
    availability: () => CommandAvailability,
    execute: CommandDescriptor["execute"],
    scopes: readonly CommandFocusScope[] = WORKBENCH_SCOPES,
  ): CommandDescriptor => ({
    id,
    category,
    userBindingScopes: scopes,
    title: () => options.navigationCopy()[copyId].label,
    detail: () => options.navigationCopy()[copyId].detail,
    keywords: () => options.navigationCopy()[copyId].aliases,
    availability,
    execute,
  });
  const descriptors: CommandDescriptor[] = [
    {
      id: WORKBENCH_COMMANDS.commandPalette,
      category: "workbench",
      userBindingScopes: [...WORKBENCH_SCOPES, "terminal"],
      title: () => options.commandPaletteCopy().label,
      detail: () => options.commandPaletteCopy().detail,
      keywords: () => "commands actions palette",
      availability: enabled,
      execute: () => options.openCommandSurface("commands"),
    },
    navigation(
      WORKBENCH_COMMANDS.openRepository,
      "open-repository",
      "workspace",
      enabled,
      () => options.openRepository(),
    ),
    navigation(
      WORKBENCH_COMMANDS.quickOpen,
      "go-file",
      "workspace",
      workspace,
      () => options.openCommandSurface("files"),
    ),
    navigation(
      WORKBENCH_COMMANDS.recentFiles,
      "recent-files",
      "workspace",
      workspace,
      () => options.openCommandSurface("recent"),
    ),
    navigation(
      WORKBENCH_COMMANDS.workspaceSearch,
      "find-workspace",
      "workspace",
      workspace,
      () => options.openCommandSurface("workspace"),
    ),
    navigation(
      WORKBENCH_COMMANDS.editorFind,
      "find-current",
      "editor",
      () => options.editorFindAvailable()
        ? enabled()
        : { enabled: false, reason: options.editorRequiredReason() },
      () => options.openEditorFind(),
      ["editor", "diff"],
    ),
    {
      id: WORKBENCH_COMMANDS.historyFind,
      category: "view",
      userBindingScopes: ["history"],
      title: () => options.navigationCopy()["find-current"].label,
      detail: () => options.navigationCopy()["find-current"].detail,
      keywords: () => "history filter search",
      availability: () => options.historyFindAvailable()
        ? enabled()
        : { enabled: false, reason: options.historyRequiredReason() },
      execute: () => options.focusHistoryFilter(),
    },
    navigation(
      WORKBENCH_COMMANDS.saveFile,
      "save-current",
      "editor",
      () => options.saveAvailable()
        ? enabled()
        : { enabled: false, reason: options.editorRequiredReason() },
      () => options.saveFile(),
      ["editor", "diff"],
    ),
    navigation(
      WORKBENCH_COMMANDS.refresh,
      "refresh",
      "workbench",
      () => options.refreshAvailable()
        ? enabled()
        : { enabled: false, reason: options.workspaceRequiredReason() },
      () => options.refresh(),
    ),
    navigation(
      WORKBENCH_COMMANDS.toggleFiles,
      "toggle-files",
      "view",
      workspace,
      () => options.toggleTool("files"),
    ),
    navigation(
      WORKBENCH_COMMANDS.toggleChanges,
      "toggle-changes",
      "view",
      git,
      () => options.toggleTool("changes"),
    ),
    navigation(
      WORKBENCH_COMMANDS.toggleGit,
      "toggle-git",
      "view",
      git,
      () => options.toggleTool("branches"),
    ),
    navigation(
      WORKBENCH_COMMANDS.toggleTerminal,
      "toggle-terminal",
      "view",
      workspace,
      () => options.toggleTool("terminal"),
    ),
  ];
  const releases = descriptors.map((descriptor) => registry.register(descriptor));
  return () => {
    for (const release of releases.reverse()) release();
  };
}
