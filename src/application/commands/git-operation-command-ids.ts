import { commandId } from "./command-service.ts";

export const GIT_OPERATION_COMMANDS = {
  open: commandId("git.operation.open"),
  openRecoveries: commandId("git.operation.recovery.open"),
} as const;
