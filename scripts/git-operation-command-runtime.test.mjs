import test from "node:test";
import assert from "node:assert/strict";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { GIT_OPERATION_COMMANDS } from "../src/application/commands/git-operation-command-ids.ts";
import { registerGitOperationCommands } from "../src/composition/git-operation-command-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Git operation commands reuse guarded launcher and recovery routes", async () => {
  const calls = [];
  let operationAvailable = false;
  let recoveryAvailable = false;
  const registry = new CommandRegistry();
  const release = registerGitOperationCommands(registry, {
    catalog: () => EN_US,
    gitOperationAvailable: () => operationAvailable,
    gitRecoveryAvailable: () => recoveryAvailable,
    openGitOperation: () => calls.push("operation"),
    openGitRecoveries: async () => calls.push("recovery"),
  });

  assert.equal(registry.get(GIT_OPERATION_COMMANDS.open).availability().enabled, false);
  assert.equal(registry.get(GIT_OPERATION_COMMANDS.openRecoveries).availability().enabled, false);
  operationAvailable = true;
  recoveryAvailable = true;
  assert.equal(registry.get(GIT_OPERATION_COMMANDS.open).availability().enabled, true);
  assert.equal(registry.get(GIT_OPERATION_COMMANDS.openRecoveries).availability().enabled, true);
  await registry.get(GIT_OPERATION_COMMANDS.open).execute("keyboard");
  await registry.get(GIT_OPERATION_COMMANDS.openRecoveries).execute("keyboard");
  assert.deepEqual(calls, ["operation", "recovery"]);
  assert.deepEqual(registry.get(GIT_OPERATION_COMMANDS.open).userBindingScopes, [
    "workbench", "input", "files", "changes", "search", "stash",
    "editor", "diff", "history", "history-input",
  ]);

  release();
  assert.deepEqual(registry.list(), []);
});
