import {
  TOOL_FOCUS_SCOPES,
  WORKBENCH_FOCUS_SCOPES,
  type CommandFocusScope,
} from "../../application/commands/command-service.ts";
import { CHANGES_COMMANDS } from "../../application/commands/changes-command-ids.ts";
import {
  DIFF_COMMANDS,
  EDITOR_COMMANDS,
  FILES_COMMANDS,
} from "../../application/commands/files-editor-command-ids.ts";
import { GIT_OPERATION_COMMANDS } from "../../application/commands/git-operation-command-ids.ts";
import { HISTORY_COMMANDS } from "../../application/commands/history-command-ids.ts";
import { REMOTE_COMMANDS } from "../../application/commands/remote-command-ids.ts";
import { WORKBENCH_COMMANDS } from "../../application/commands/workbench-command-ids.ts";
import { keySequence, primarySequence } from "./keybinding-normalizer.ts";
import type { DefaultKeybindingRule } from "./keybinding-model.ts";

const FILES_SCOPE: readonly CommandFocusScope[] = ["files"];
const CHANGES_SCOPE: readonly CommandFocusScope[] = ["changes"];
const EDITOR_SCOPE: readonly CommandFocusScope[] = ["editor"];
const DIFF_SCOPES: readonly CommandFocusScope[] = ["diff"];
const HISTORY_SCOPE: readonly CommandFocusScope[] = ["history"];

/**
 * Semantically equivalent defaults derived from the user's active Android Studio macOS keymap.
 * These are authored Asterlyn rules, not an imported IDE keymap or runtime dependency.
 */
export const ANDROID_STUDIO_MACOS_KEYBINDINGS: readonly DefaultKeybindingRule[] = [
  tool("workbench.tool.files.macos-ide", WORKBENCH_COMMANDS.toggleFiles, primarySequence("1")),
  tool("workbench.tool.search.macos-ide", WORKBENCH_COMMANDS.toggleSearch, primarySequence("3")),
  tool("workbench.tool.changes.macos-ide", WORKBENCH_COMMANDS.toggleChanges, primarySequence("0")),
  tool("workbench.tool.branches.macos-ide", WORKBENCH_COMMANDS.toggleGit, primarySequence("9")),
  tool(
    "workbench.tool.terminal.macos-ide",
    WORKBENCH_COMMANDS.toggleTerminal,
    keySequence("F12", { alt: true }),
  ),
  mac(
    "files.active.locate.macos-ide",
    FILES_COMMANDS.locateActive,
    keySequence("F1", { alt: true }),
    WORKBENCH_FOCUS_SCOPES,
  ),
  mac(
    "files.selection.open.function.macos-ide",
    FILES_COMMANDS.openSelection,
    keySequence("F4"),
    FILES_SCOPE,
  ),
  mac(
    "files.selection.open.option.macos-ide",
    FILES_COMMANDS.openSelection,
    keySequence("s", { alt: true }),
    FILES_SCOPE,
  ),
  mac(
    "files.file.create.macos-ide",
    FILES_COMMANDS.createFile,
    primarySequence("n"),
    FILES_SCOPE,
  ),
  mac(
    "files.selection.rename.macos-ide",
    FILES_COMMANDS.renameSelection,
    primarySequence("r"),
    FILES_SCOPE,
  ),
  mac(
    "files.selection.cut.macos-ide",
    FILES_COMMANDS.cutSelection,
    primarySequence("x"),
    FILES_SCOPE,
  ),
  mac(
    "files.selection.copy.macos-ide",
    FILES_COMMANDS.copySelection,
    primarySequence("c"),
    FILES_SCOPE,
  ),
  mac(
    "files.selection.paste.macos-ide",
    FILES_COMMANDS.pasteSelection,
    primarySequence("v"),
    FILES_SCOPE,
  ),
  mac(
    "files.folder.expand.macos-ide",
    FILES_COMMANDS.expandFolder,
    keySequence("=", { control: true }),
    FILES_SCOPE,
  ),
  mac(
    "files.folder.collapse.macos-ide",
    FILES_COMMANDS.collapseFolder,
    keySequence("-", { control: true }),
    FILES_SCOPE,
  ),
  mac(
    "editor.tab.close.macos-ide",
    EDITOR_COMMANDS.closeTab,
    keySequence("F4", { control: true, shift: true }),
    EDITOR_SCOPE,
  ),
  mac(
    "editor.tab.previous.macos-ide",
    EDITOR_COMMANDS.previousTab,
    keySequence("ArrowLeft", { control: true, shift: true }),
    EDITOR_SCOPE,
  ),
  mac(
    "editor.tab.next.macos-ide",
    EDITOR_COMMANDS.nextTab,
    keySequence("ArrowRight", { control: true, shift: true }),
    EDITOR_SCOPE,
  ),
  mac(
    "editor.tab-list.macos-ide",
    EDITOR_COMMANDS.toggleTabList,
    keySequence("ArrowDown", { control: true, shift: true }),
    EDITOR_SCOPE,
  ),
  mac(
    "diff.change.previous.macos-ide",
    DIFF_COMMANDS.previousChange,
    keySequence("ArrowLeft", { control: true, shift: true }),
    DIFF_SCOPES,
  ),
  mac(
    "diff.change.next.macos-ide",
    DIFF_COMMANDS.nextChange,
    keySequence("ArrowRight", { control: true, shift: true }),
    DIFF_SCOPES,
  ),
  mac(
    "diff.file.previous.macos-ide",
    DIFF_COMMANDS.previousFile,
    primarySequence("{", true),
    DIFF_SCOPES,
  ),
  mac(
    "diff.file.next.macos-ide",
    DIFF_COMMANDS.nextFile,
    primarySequence("}", true),
    DIFF_SCOPES,
  ),
  mac(
    "diff.source.open.function.macos-ide",
    DIFF_COMMANDS.openSource,
    keySequence("F4"),
    DIFF_SCOPES,
  ),
  mac(
    "diff.source.open.option.macos-ide",
    DIFF_COMMANDS.openSource,
    keySequence("s", { alt: true }),
    DIFF_SCOPES,
  ),
  mac(
    "changes.view.toggle.macos-ide",
    CHANGES_COMMANDS.toggleView,
    keySequence("p", { control: true }),
    CHANGES_SCOPE,
  ),
  mac(
    "changes.source.open.function.macos-ide",
    CHANGES_COMMANDS.openSource,
    keySequence("F4"),
    CHANGES_SCOPE,
  ),
  mac(
    "changes.source.open.option.macos-ide",
    CHANGES_COMMANDS.openSource,
    keySequence("s", { alt: true }),
    CHANGES_SCOPE,
  ),
  mac(
    "history.file.open-current.function.macos-ide",
    HISTORY_COMMANDS.openCurrentFile,
    keySequence("F4"),
    HISTORY_SCOPE,
  ),
  mac(
    "history.file.open-current.option.macos-ide",
    HISTORY_COMMANDS.openCurrentFile,
    keySequence("s", { alt: true }),
    HISTORY_SCOPE,
  ),
  mac(
    "git.branch.create.macos-ide",
    HISTORY_COMMANDS.createBranch,
    keySequence("n", { primary: true, alt: true }),
    HISTORY_SCOPE,
  ),
  mac(
    "git.branch.rename.macos-ide",
    HISTORY_COMMANDS.renameBranch,
    primarySequence("r"),
    HISTORY_SCOPE,
  ),
  mac(
    "remote.update.open.macos-ide",
    REMOTE_COMMANDS.openUpdate,
    primarySequence("t"),
    WORKBENCH_FOCUS_SCOPES,
  ),
  mac(
    "remote.push.open.macos-ide",
    REMOTE_COMMANDS.openPush,
    primarySequence("k", true),
    WORKBENCH_FOCUS_SCOPES,
  ),
  mac(
    "git.operation.open.macos-ide",
    GIT_OPERATION_COMMANDS.open,
    keySequence("v", { control: true }),
    WORKBENCH_FOCUS_SCOPES,
  ),
];

function mac(
  id: string,
  commandId: DefaultKeybindingRule["commandId"],
  sequence: DefaultKeybindingRule["sequence"],
  scopes: readonly CommandFocusScope[],
): DefaultKeybindingRule {
  return { id, commandId, sequence, scopes, platform: "macos" };
}

function tool(
  id: string,
  commandId: DefaultKeybindingRule["commandId"],
  sequence: DefaultKeybindingRule["sequence"],
): DefaultKeybindingRule {
  return {
    ...mac(id, commandId, sequence, TOOL_FOCUS_SCOPES),
    terminalPolicy: "intercept",
  };
}
