import type { CommandFocusScope } from "../../application/commands/command-service.ts";
import { WORKBENCH_COMMANDS } from "../../application/commands/workbench-command-ids.ts";
import { primarySequence } from "./keybinding-normalizer.ts";
import type { DefaultKeybindingRule } from "./keybinding-model.ts";

const WORKBENCH_SCOPES: readonly CommandFocusScope[] = [
  "workbench",
  "input",
  "editor",
  "diff",
  "history",
];

export const DEFAULT_KEYBINDINGS: readonly DefaultKeybindingRule[] = [
  {
    id: "workbench.command-palette.primary",
    commandId: WORKBENCH_COMMANDS.commandPalette,
    sequence: primarySequence("p", true),
    scopes: [...WORKBENCH_SCOPES, "terminal"],
    terminalPolicy: "intercept",
  },
  {
    id: "workspace.open-repository.primary",
    commandId: WORKBENCH_COMMANDS.openRepository,
    sequence: primarySequence("o"),
    scopes: WORKBENCH_SCOPES,
  },
  {
    id: "workspace.quick-open.primary",
    commandId: WORKBENCH_COMMANDS.quickOpen,
    sequence: primarySequence("p"),
    scopes: WORKBENCH_SCOPES,
  },
  {
    id: "workspace.recent-files.primary",
    commandId: WORKBENCH_COMMANDS.recentFiles,
    sequence: primarySequence("e"),
    scopes: WORKBENCH_SCOPES,
  },
  {
    id: "workspace.search.primary",
    commandId: WORKBENCH_COMMANDS.workspaceSearch,
    sequence: primarySequence("f", true),
    scopes: WORKBENCH_SCOPES,
  },
  {
    id: "editor.find.primary",
    commandId: WORKBENCH_COMMANDS.editorFind,
    sequence: primarySequence("f"),
    scopes: ["editor", "diff"],
  },
  {
    id: "history.find.primary",
    commandId: WORKBENCH_COMMANDS.historyFind,
    sequence: primarySequence("f"),
    scopes: ["history"],
  },
  {
    id: "editor.save.primary",
    commandId: WORKBENCH_COMMANDS.saveFile,
    sequence: primarySequence("s"),
    scopes: ["editor", "diff"],
  },
  {
    id: "workbench.refresh.primary",
    commandId: WORKBENCH_COMMANDS.refresh,
    sequence: primarySequence("r"),
    scopes: WORKBENCH_SCOPES,
  },
  {
    id: "workbench.settings.primary",
    commandId: WORKBENCH_COMMANDS.openSettings,
    sequence: primarySequence(","),
    scopes: [...WORKBENCH_SCOPES, "terminal"],
    terminalPolicy: "intercept",
  },
];
