import test from "node:test";
import assert from "node:assert/strict";
import { CommandRegistry, commandId } from "../src/application/commands/command-service.ts";
import { KeybindingController } from "../src/features/keybindings/keybinding-controller.ts";
import { primarySequence } from "../src/features/keybindings/keybinding-normalizer.ts";
import { KeybindingStore, createSilentKeybindingSync } from "../src/features/keybindings/keybinding-store.ts";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

function keyboard(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: () => false,
    ...modifiers,
  };
}

function setup() {
  const registry = new CommandRegistry();
  const commandA = commandId("test.command.a");
  const commandB = commandId("test.command.b");
  const register = (id, scopes) => registry.register({
    id,
    category: "workbench",
    userBindingScopes: scopes,
    title: () => id,
    detail: () => "",
    availability: () => ({ enabled: true }),
    execute: () => undefined,
  });
  const releases = [register(commandA, ["workbench", "terminal"]), register(commandB, ["workbench"])];
  const store = new KeybindingStore(new MemoryStorage(), createSilentKeybindingSync());
  const controller = new KeybindingController(registry, store, [
    { id: "a.default", commandId: commandA, sequence: primarySequence("p"), scopes: ["workbench", "terminal"], terminalPolicy: "intercept" },
    { id: "b.default", commandId: commandB, sequence: primarySequence("k"), scopes: ["workbench"] },
  ], "windows");
  return { controller, commandA, commandB, dispose: () => { controller.dispose(); releases.forEach((release) => release()); } };
}

test("dispatch is scope-aware and terminal interception is explicit", () => {
  const { controller, commandA, dispose } = setup();
  assert.deepEqual(controller.dispatch(keyboard("p", { ctrlKey: true }), "workbench"), { kind: "command", commandId: commandA });
  assert.deepEqual(controller.dispatch(keyboard("p", { ctrlKey: true }), "input"), { kind: "none" });
  assert.deepEqual(controller.dispatch(keyboard("p", { ctrlKey: true }), "terminal", true), { kind: "command", commandId: commandA });
  assert.deepEqual(controller.dispatch(keyboard("k", { ctrlKey: true }), "terminal", true), { kind: "none" });
  dispose();
});

test("conflicting reassignment requires explicit replacement", () => {
  const { controller, commandA, commandB, dispose } = setup();
  controller.startRecording(commandB, "b.default");
  assert.equal(controller.capture(keyboard("p", { ctrlKey: true })), true);
  assert.equal(controller.viewModel().recording.conflicts[0].commandId, commandA);
  assert.equal(controller.applyRecording(false), false);
  assert.equal(controller.applyRecording(true), true);
  assert.deepEqual(controller.dispatch(keyboard("p", { ctrlKey: true }), "workbench"), { kind: "command", commandId: commandB });
  assert.equal(controller.shortcutForCommand(commandA), null);
  dispose();
});

test("two-stroke bindings enter and complete one bounded chord", () => {
  const { controller, commandA, dispose } = setup();
  controller.startRecording(commandA, null);
  controller.capture(keyboard("x", { ctrlKey: true }));
  controller.capture(keyboard("s", { ctrlKey: true }));
  assert.equal(controller.applyRecording(false), true);
  assert.deepEqual(controller.dispatch(keyboard("x", { ctrlKey: true }), "workbench"), { kind: "pending" });
  assert.deepEqual(controller.dispatch(keyboard("s", { ctrlKey: true }), "workbench"), { kind: "command", commandId: commandA });
  dispose();
});

test("text editing and accessible navigation combinations are protected", () => {
  const { controller, commandA, dispose } = setup();
  controller.startRecording(commandA, null);
  controller.capture(keyboard("c", { ctrlKey: true }));
  assert.equal(controller.viewModel().recording.validationError, null);
  controller.cancelRecording();

  const registry = new CommandRegistry();
  registry.register({ id: commandA, category: "editor", userBindingScopes: ["editor"], title: () => "A", detail: () => "", availability: () => ({ enabled: true }), execute: () => undefined });
  const editor = new KeybindingController(registry, new KeybindingStore(new MemoryStorage()), [], "windows");
  editor.startRecording(commandA, null);
  editor.capture(keyboard("c", { ctrlKey: true }));
  assert.equal(editor.viewModel().recording.validationError, "protected");
  editor.clearRecordingSequence();
  editor.capture(keyboard("Tab"));
  assert.equal(editor.viewModel().recording.validationError, "reserved");
  editor.dispose();

  for (const scope of ["history-input", "settings"]) {
    const scopedRegistry = new CommandRegistry();
    scopedRegistry.register({
      id: commandA,
      category: "workbench",
      userBindingScopes: [scope],
      title: () => "A",
      detail: () => "",
      availability: () => ({ enabled: true }),
      execute: () => undefined,
    });
    const scoped = new KeybindingController(
      scopedRegistry,
      new KeybindingStore(new MemoryStorage()),
      [],
      "windows",
    );
    scoped.startRecording(commandA, null);
    scoped.capture(keyboard("c", { ctrlKey: true }));
    assert.equal(
      scoped.viewModel().recording.validationError,
      "protected",
      `${scope} must retain text-editing safety`,
    );
    scoped.dispose();
  }
  dispose();
});
