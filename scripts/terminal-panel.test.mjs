import assert from "node:assert/strict";
import test from "node:test";

import { renderTerminalHeader } from "../src/features/terminal/terminal-panel.ts";
import { EN_US } from "../src/localization/en-US.ts";

const idle = {
  root: "/repo",
  status: "idle",
  sessionId: null,
  shell: null,
  cwd: null,
  exitCode: null,
  error: null,
};

test("terminal header exposes explicit lifecycle actions and accessible explanations", () => {
  const idleHeader = renderTerminalHeader(idle, EN_US.terminal);
  assert.match(idleHeader, /No active session/);
  assert.match(idleHeader, /Start a new terminal session in the current project folder/);
  assert.match(idleHeader, /data-terminal-action="close"[^>]*disabled/);

  const runningHeader = renderTerminalHeader({
    ...idle,
    status: "running",
    sessionId: "session-1",
    shell: "bash",
    cwd: "/repo",
  }, EN_US.terminal);
  assert.match(runningHeader, />bash</);
  assert.match(runningHeader, /data-terminal-action="restart"[^>]*disabled/);
  assert.doesNotMatch(runningHeader, /data-terminal-action="close"[^>]*disabled/);
});
