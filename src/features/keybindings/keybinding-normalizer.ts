import type {
  DefaultKeybindingRule,
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
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing" | "getModifierState"> &
    Partial<Pick<KeyboardEvent, "code">>,
  platform: KeybindingPlatform,
): KeyStroke | null {
  if (event.getModifierState?.("AltGraph")) return null;
  const optionBaseKey = platform === "macos" && event.altKey
    ? macOptionBaseKey(event.code)
    : null;
  if (event.isComposing && !optionBaseKey) return null;
  const raw = optionBaseKey ?? NAMED_KEYS.get(event.key) ?? event.key;
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

/** Option changes KeyboardEvent.key into symbols or dead keys; IDE shortcuts use the base key. */
function macOptionBaseKey(code: string | undefined): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/u.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/u.test(code)) return code.slice(5);
  return null;
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

export function ariaKeyShortcut(accessibleShortcut: string): string {
  const aliases: Readonly<Record<string, string>> = {
    Command: "Meta",
    Option: "Alt",
    Esc: "Escape",
    "←": "ArrowLeft",
    "→": "ArrowRight",
    "↑": "ArrowUp",
    "↓": "ArrowDown",
  };
  return accessibleShortcut.split("+").map((token) => aliases[token] ?? token).join("+");
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
  return keySequence(key, { primary: true, shift });
}

export function keySequence(
  key: string,
  modifiers: Partial<Omit<KeyStroke, "key">> = {},
): KeySequence {
  return [{
    key: key.length === 1 ? key.toLowerCase() : key,
    primary: modifiers.primary ?? false,
    control: modifiers.control ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
    meta: modifiers.meta ?? false,
  }];
}

export function defaultKeybindingsForPlatform(
  rules: readonly DefaultKeybindingRule[],
  platform: KeybindingPlatform,
): readonly DefaultKeybindingRule[] {
  return rules
    .filter((rule) => !rule.platform || rule.platform === platform)
    .map((rule) => ({
      ...rule,
      sequence: rule.platformSequences?.[platform] ?? rule.sequence,
    }));
}
