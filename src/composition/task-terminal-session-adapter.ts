import type { TaskTerminalSessionPort } from "../application/tasks/task-terminal-session.ts";
import { taskTerminalPort, type TerminalPanel } from "../features/terminal/terminal-panel.ts";

/** Adds shell-layout activation without leaking either dependency into task execution. */
export function openingTaskTerminalPort(
  panel: TerminalPanel,
  open: (workspaceRoot: string) => void,
): TaskTerminalSessionPort {
  const direct = taskTerminalPort(panel);
  let workspaceRoot: string | null = null;
  return {
    begin: (session) => {
      workspaceRoot = session.workspaceRoot;
      direct.begin(session);
      open(session.workspaceRoot);
    },
    append: direct.append,
    update: direct.update,
    reveal: (sessionId) => {
      const revealed = direct.reveal(sessionId);
      if (revealed && workspaceRoot) open(workspaceRoot);
      return revealed;
    },
  };
}
