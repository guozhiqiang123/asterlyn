import test from "node:test";
import assert from "node:assert/strict";
import {
  formatKeySequence,
  keybindingPlatform,
  normalizeKeyboardEvent,
  primarySequence,
  sequenceSignature,
} from "../src/features/keybindings/keybinding-normalizer.ts";

function event(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    getModifierState: () => false,
    ...modifiers,
  };
}

test("shortcut normalization uses a portable primary modifier and logical keys", () => {
  const mac = normalizeKeyboardEvent(event("P", { metaKey: true, shiftKey: true }), "macos");
  const windows = normalizeKeyboardEvent(event("p", { ctrlKey: true, shiftKey: true }), "windows");
  assert.deepEqual(mac, { key: "p", primary: true, control: false, alt: false, shift: true, meta: false });
  assert.deepEqual(windows, mac);
  assert.equal(sequenceSignature([mac]), sequenceSignature([windows]));
  assert.equal(formatKeySequence([mac], "macos"), "⌘⇧P");
  assert.equal(formatKeySequence([windows], "windows", true), "Control+Shift+P");
});

test("IME, AltGraph, dead keys, and modifier-only input never become bindings", () => {
  assert.equal(normalizeKeyboardEvent(event("p", { isComposing: true }), "linux"), null);
  assert.equal(normalizeKeyboardEvent(event("Dead"), "linux"), null);
  assert.equal(normalizeKeyboardEvent(event("Shift", { shiftKey: true }), "linux"), null);
  assert.equal(normalizeKeyboardEvent(event("q", { getModifierState: (name) => name === "AltGraph" }), "linux"), null);
});

test("platform detection and default sequence formatting are deterministic", () => {
  assert.equal(keybindingPlatform({ platform: "MacIntel", userAgent: "WebKit" }), "macos");
  assert.equal(keybindingPlatform({ platform: "Win32", userAgent: "WebView2" }), "windows");
  assert.equal(keybindingPlatform({ platform: "Linux x86_64", userAgent: "WebKit" }), "linux");
  assert.equal(formatKeySequence(primarySequence("f", true), "linux"), "Control+Shift+F");
});

test("signatures remain unambiguous for delimiter and whitespace keys", () => {
  const pipe = normalizeKeyboardEvent(event("|", { ctrlKey: true }), "windows");
  const space = normalizeKeyboardEvent(event(" ", { ctrlKey: true }), "windows");
  assert.notEqual(sequenceSignature([pipe]), sequenceSignature([space]));
  assert.notEqual(
    sequenceSignature([pipe, space]),
    sequenceSignature([space, pipe]),
  );
});
