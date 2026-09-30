import type { KeybindingPlatform } from "../features/keybindings/keybinding-model.ts";
import {
  ariaKeyShortcut,
  formatKeySequence,
  primarySequence,
} from "../features/keybindings/keybinding-normalizer.ts";

export interface LocalShortcutPresentation {
  readonly display: string;
  readonly aria: string;
}

export function historyPathApplyShortcut(
  platform: KeybindingPlatform,
): LocalShortcutPresentation {
  const sequence = primarySequence("Enter");
  return {
    display: formatKeySequence(sequence, platform),
    aria: ariaKeyShortcut(formatKeySequence(sequence, platform, true)),
  };
}
