import test from "node:test";
import assert from "node:assert/strict";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { TERMINAL_COMMANDS } from "../src/application/commands/terminal-command-ids.ts";
import { registerTerminalCommands } from "../src/composition/terminal-command-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("terminal commands remain terminal-scoped and reuse panel lifecycle actions", async () => {
  const calls = [];
  const available = new Set(["clear", "close"]);
  const registry = new CommandRegistry();
  const release = registerTerminalCommands(registry, {
    catalog: () => EN_US,
    terminalCommandAvailable: (action) => available.has(action),
    executeTerminalCommand: async (action) => calls.push(action),
  });

  assert.equal(registry.get(TERMINAL_COMMANDS.restart).availability().enabled, false);
  assert.equal(registry.get(TERMINAL_COMMANDS.clear).availability().enabled, true);
  assert.equal(registry.get(TERMINAL_COMMANDS.close).availability().enabled, true);
  for (const id of Object.values(TERMINAL_COMMANDS)) {
    assert.deepEqual(registry.get(id).userBindingScopes, ["terminal"]);
  }
  await registry.get(TERMINAL_COMMANDS.clear).execute("keyboard");
  await registry.get(TERMINAL_COMMANDS.close).execute("keyboard");
  assert.deepEqual(calls, ["clear", "close"]);

  release();
  assert.deepEqual(registry.list(), []);
});
