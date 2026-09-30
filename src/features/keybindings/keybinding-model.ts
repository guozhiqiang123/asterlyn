import type {
  CommandFocusScope,
  CommandId,
} from "../../application/commands/command-service.ts";

export type KeybindingPlatform = "macos" | "windows" | "linux";

export interface KeyStroke {
  readonly key: string;
  readonly primary: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

export type KeySequence = readonly [KeyStroke] | readonly [KeyStroke, KeyStroke];

export interface DefaultKeybindingRule {
  readonly id: string;
  readonly commandId: CommandId;
  readonly sequence: KeySequence;
  readonly platformSequences?: Partial<Record<KeybindingPlatform, KeySequence>>;
  readonly scopes: readonly CommandFocusScope[];
  readonly platform?: KeybindingPlatform;
  readonly terminalPolicy?: "intercept" | "pass-through";
}

export interface KeybindingReplacement {
  readonly bindingId: string;
  readonly commandId: string;
  readonly sequence: KeySequence | null;
}

export interface AddedKeybinding {
  readonly id: string;
  readonly commandId: string;
  readonly sequence: KeySequence;
}

export interface KeybindingProfileV1 {
  readonly version: 1;
  readonly revision: number;
  readonly replacements: readonly KeybindingReplacement[];
  readonly additions: readonly AddedKeybinding[];
}

export interface ResolvedKeybindingRule {
  readonly id: string;
  readonly commandId: string;
  readonly sequence: KeySequence;
  readonly scopes: readonly CommandFocusScope[];
  readonly source: "default" | "replacement" | "user";
  readonly terminalPolicy: "intercept" | "pass-through";
}

export interface KeybindingConflict {
  readonly ruleId: string;
  readonly commandId: string;
  readonly kind: "exact" | "prefix";
}

export interface KeybindingDispatch {
  readonly kind: "none" | "pending" | "command" | "handled";
  readonly commandId?: string;
}

export const EMPTY_KEYBINDING_PROFILE: KeybindingProfileV1 = {
  version: 1,
  revision: 0,
  replacements: [],
  additions: [],
};
