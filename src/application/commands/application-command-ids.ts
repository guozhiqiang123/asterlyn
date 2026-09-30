import { CHANGES_COMMANDS } from "./changes-command-ids.ts";
import { FILES_COMMANDS, EDITOR_COMMANDS, DIFF_COMMANDS } from "./files-editor-command-ids.ts";
import { STASH_COMMANDS } from "./stash-command-ids.ts";
import { HISTORY_COMMANDS } from "./history-command-ids.ts";
import { REMOTE_COMMANDS } from "./remote-command-ids.ts";
import { WORKBENCH_COMMANDS } from "./workbench-command-ids.ts";

export const APPLICATION_COMMAND_IDS = Object.freeze([
  ...Object.values(WORKBENCH_COMMANDS),
  ...Object.values(FILES_COMMANDS),
  ...Object.values(EDITOR_COMMANDS),
  ...Object.values(DIFF_COMMANDS),
  ...Object.values(CHANGES_COMMANDS),
  ...Object.values(STASH_COMMANDS),
  ...Object.values(HISTORY_COMMANDS),
  ...Object.values(REMOTE_COMMANDS),
]);
