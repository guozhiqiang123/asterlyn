import type { TaskTerminalSessionPort } from "../../application/tasks/task-terminal-session.ts";
import { taskTerminalPort, type TerminalPanel } from "./terminal-panel.ts";

/** Adds shell-layout activation without leaking either dependency into task execution. */
export function openingTaskTerminalPort(
  panel: TerminalPanel,
  open: () => void,
): TaskTerminalSessionPort {
  const direct = taskTerminalPort(panel);
  return {
    begin: (session) => {
      direct.begin(session);
      open();
    },
    append: direct.append,
    update: direct.update,
    reveal: (sessionId) => {
      const revealed = direct.reveal(sessionId);
      if (revealed) open();
      return revealed;
    },
  };
}
