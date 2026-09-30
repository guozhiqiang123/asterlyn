import test from "node:test";
import assert from "node:assert/strict";
import { WindowKeybindingBinding } from "../src/shell/window-keybinding-binding.ts";

class Host {
  listener = null;
  options = null;
  addEventListener(type, listener, options) {
    assert.equal(type, "keydown");
    this.listener = listener;
    this.options = options;
  }
}

test("window shortcut routing captures before editors and consumes only matched commands", () => {
  const host = new Host();
  const executed = [];
  const pending = [];
  let result = { kind: "command", commandId: "test.command" };
  const keybindings = {
    chordPending: false,
    subscribe: () => () => undefined,
    dispatch: () => result,
  };
  const binding = new WindowKeybindingBinding(
    host,
    keybindings,
    { execute: (id, source) => executed.push([id, source]) },
    { scope: () => "editor", pending: (active) => pending.push(active) },
  );
  binding.bind();
  assert.equal(host.options.capture, true);

  const handled = event("keydown");
  host.listener(handled);
  assert.equal(handled.prevented, true);
  assert.equal(handled.stopped, true);
  assert.deepEqual(executed, [["test.command", "keyboard"]]);

  result = { kind: "none" };
  const unmatched = event("keydown");
  host.listener(unmatched);
  assert.equal(unmatched.prevented, false);
  assert.equal(unmatched.stopped, false);
  binding.dispose();
  assert.deepEqual(pending, []);
});

test("terminal routing ignores keyup and sends only an intercepted keydown to commands", () => {
  let dispatches = 0;
  const executed = [];
  const binding = new WindowKeybindingBinding(
    new Host(),
    {
      chordPending: false,
      subscribe: () => () => undefined,
      dispatch: () => {
        dispatches += 1;
        return { kind: "command", commandId: "terminal.command" };
      },
    },
    { execute: (id, source) => executed.push([id, source]) },
    { scope: () => "terminal", pending: () => undefined },
  );
  assert.equal(binding.handleTerminalKeyEvent(event("keyup")), true);
  assert.equal(binding.handleTerminalKeyEvent(event("keypress")), true);
  const keydown = event("keydown");
  assert.equal(binding.handleTerminalKeyEvent(keydown), false);
  assert.equal(keydown.prevented, true);
  assert.equal(dispatches, 1);
  assert.deepEqual(executed, [["terminal.command", "keyboard"]]);
});

function event(type) {
  return {
    type,
    defaultPrevented: false,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
}
