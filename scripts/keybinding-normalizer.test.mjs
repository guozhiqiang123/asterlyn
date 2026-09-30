import test from "node:test";
import assert from "node:assert/strict";
import {
  ariaKeyShortcut,
  defaultKeybindingsForPlatform,
  formatKeySequence,
  keySequence,
  keybindingPlatform,
  normalizeKeyboardEvent,
  primarySequence,
  sequenceSignature,
} from "../src/features/keybindings/keybinding-normalizer.ts";

function event(key, modifiers = {}) {
  return {
    key,
    code: "",
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

test("macOS Option shortcuts use the physical base letter instead of produced symbols", () => {
  assert.deepEqual(
    normalizeKeyboardEvent(event("ß", { code: "KeyS", altKey: true }), "macos"),
    { key: "s", primary: false, control: false, alt: true, shift: false, meta: false },
  );
  assert.deepEqual(
    normalizeKeyboardEvent(event("Dead", {
      code: "KeyN",
      altKey: true,
      metaKey: true,
      isComposing: true,
    }), "macos"),
    { key: "n", primary: true, control: false, alt: true, shift: false, meta: false },
  );
  assert.equal(
    normalizeKeyboardEvent(event("Dead", { code: "KeyN", altKey: true }), "windows"),
    null,
  );
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

test("ARIA shortcut tokens use platform-neutral modifier and named-key values", () => {
  assert.equal(ariaKeyShortcut("Command+Option+←"), "Meta+Alt+ArrowLeft");
  assert.equal(ariaKeyShortcut("Control+Esc"), "Control+Escape");
});

test("stable defaults can resolve verified platform-specific sequences", () => {
  const defaults = [{
    id: "refresh.default",
    commandId: "workbench.refresh",
    sequence: primarySequence("r"),
    platformSequences: { macos: primarySequence("y", true) },
    scopes: ["workbench"],
  }];
  const mac = defaultKeybindingsForPlatform(defaults, "macos");
  const windows = defaultKeybindingsForPlatform(defaults, "windows");

  assert.equal(mac[0].id, "refresh.default");
  assert.equal(formatKeySequence(mac[0].sequence, "macos"), "⌘⇧Y");
  assert.equal(formatKeySequence(windows[0].sequence, "windows"), "Control+R");
  assert.deepEqual(keySequence("N", { primary: true, alt: true }), [{
    key: "n",
    primary: true,
    control: false,
    alt: true,
    shift: false,
    meta: false,
  }]);
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
