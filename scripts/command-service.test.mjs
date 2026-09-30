import test from "node:test";
import assert from "node:assert/strict";
import {
  CommandRegistry,
  CommandService,
  commandId,
} from "../src/application/commands/command-service.ts";

function descriptor(id, overrides = {}) {
  return {
    id,
    category: "workbench",
    userBindingScopes: ["workbench"],
    title: () => "Test command",
    detail: () => "",
    availability: () => ({ enabled: true }),
    execute: () => undefined,
    ...overrides,
  };
}

test("command registrations reject duplicates and unregister idempotently", () => {
  const registry = new CommandRegistry();
  const id = commandId("test.registry");
  const release = registry.register(descriptor(id));
  assert.throws(() => registry.register(descriptor(id)), /Duplicate command registration/);
  release();
  release();
  assert.equal(registry.get(id), null);
});

test("command execution rechecks availability and reports the current blocked reason", async () => {
  const registry = new CommandRegistry();
  const blocked = [];
  const errors = [];
  let enabled = false;
  let calls = 0;
  const id = commandId("test.availability");
  registry.register(descriptor(id, {
    availability: () => enabled ? { enabled: true } : { enabled: false, reason: "Not now" },
    execute: () => { calls += 1; },
  }));
  const service = new CommandService(registry, {
    blocked: (reason) => blocked.push(reason),
    error: (error) => errors.push(error),
  });
  assert.equal(await service.execute(id, "keyboard"), false);
  assert.deepEqual(blocked, ["Not now"]);
  enabled = true;
  assert.equal(await service.execute(id, "palette"), true);
  assert.equal(calls, 1);
  assert.deepEqual(errors, []);
});

test("async failures are contained and a running command drops duplicate invocations", async () => {
  const registry = new CommandRegistry();
  const errors = [];
  let resolve;
  let calls = 0;
  const id = commandId("test.in-flight");
  registry.register(descriptor(id, {
    execute: () => {
      calls += 1;
      return new Promise((accept) => { resolve = accept; });
    },
  }));
  const service = new CommandService(registry, {
    blocked: () => undefined,
    error: (error) => errors.push(error),
  });
  const first = service.execute(id, "keyboard");
  assert.equal(await service.execute(id, "palette"), false);
  assert.equal(calls, 1);
  resolve();
  assert.equal(await first, true);

  const failing = commandId("test.failure");
  const failure = new Error("contained");
  registry.register(descriptor(failing, { execute: async () => { throw failure; } }));
  assert.equal(await service.execute(failing, "button"), false);
  assert.deepEqual(errors, [failure]);
});
