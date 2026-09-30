import type {
  KeySequence,
  KeyStroke,
  KeybindingPlatform,
} from "./keybinding-model.ts";

const NAMED_KEYS = new Map([
  [" ", "Space"],
  ["Esc", "Escape"],
  ["Left", "ArrowLeft"],
  ["Right", "ArrowRight"],
  ["Up", "ArrowUp"],
  ["Down", "ArrowDown"],
  ["Del", "Delete"],
]);

const REJECTED_KEYS = new Set(["", "Dead", "Process", "Unidentified", "AltGraph"]);
const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);

export function keybindingPlatform(
  navigatorValue: Pick<Navigator, "platform" | "userAgent"> = navigator,
): KeybindingPlatform {
  const identity = `${navigatorValue.platform} ${navigatorValue.userAgent}`.toLowerCase();
  if (identity.includes("mac")) return "macos";
  if (identity.includes("win")) return "windows";
  return "linux";
}

export function normalizeKeyboardEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing" | "getModifierState">,
  platform: KeybindingPlatform,
): KeyStroke | null {
  if (event.isComposing || event.getModifierState?.("AltGraph")) return null;
  const raw = NAMED_KEYS.get(event.key) ?? event.key;
  if (REJECTED_KEYS.has(raw) || MODIFIER_KEYS.has(raw)) return null;
  const key = raw.length === 1 ? raw.toLowerCase() : raw;
  const primary = platform === "macos" ? event.metaKey : event.ctrlKey;
  return {
    key,
    primary,
    control: platform === "macos" && event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: platform !== "macos" && event.metaKey,
  };
}

export function strokeSignature(stroke: KeyStroke): string {
  return JSON.stringify([
    stroke.primary,
    stroke.control,
    stroke.alt,
    stroke.shift,
    stroke.meta,
    stroke.key,
  ]);
}

export function sequenceSignature(sequence: KeySequence): string {
  return JSON.stringify(sequence.map(strokeSignature));
}

export function sequenceStartsWith(sequence: KeySequence, prefix: KeySequence): boolean {
  if (prefix.length >= sequence.length) return false;
  return prefix.every((stroke, index) => strokeSignature(sequence[index]!) === strokeSignature(stroke));
}

export function formatKeySequence(
  sequence: KeySequence,
  platform: KeybindingPlatform,
  accessible = false,
): string {
  return sequence.map((stroke) => formatKeyStroke(stroke, platform, accessible)).join(" ");
}

export function formatKeyStroke(
  stroke: KeyStroke,
  platform: KeybindingPlatform,
  accessible = false,
): string {
  const key = displayKey(stroke.key);
  if (accessible || platform !== "macos") {
    const modifiers = [
      stroke.primary ? (platform === "macos" ? "Command" : "Control") : null,
      stroke.control ? "Control" : null,
      stroke.alt ? (platform === "macos" ? "Option" : "Alt") : null,
      stroke.shift ? "Shift" : null,
      stroke.meta ? "Meta" : null,
    ].filter(Boolean);
    return [...modifiers, key].join("+");
  }
  return `${stroke.primary ? "⌘" : ""}${stroke.control ? "⌃" : ""}${stroke.alt ? "⌥" : ""}${stroke.shift ? "⇧" : ""}${stroke.meta ? "◆" : ""}${key}`;
}

function displayKey(key: string): string {
  if (key.length === 1) return key.toLocaleUpperCase();
  return ({
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Escape: "Esc",
  } as Record<string, string>)[key] ?? key;
}

export function primarySequence(key: string, shift = false): KeySequence {
  return [{
    key: key.length === 1 ? key.toLowerCase() : key,
    primary: true,
    control: false,
    alt: false,
    shift,
    meta: false,
  }];
}
