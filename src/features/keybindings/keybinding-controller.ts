import {
  type CommandCategory,
  type CommandFocusScope,
  type CommandRegistry,
} from "../../application/commands/command-service.ts";
import {
  ariaKeyShortcut,
  defaultKeybindingsForPlatform,
  formatKeySequence,
  normalizeKeyboardEvent,
  sequenceSignature,
  strokeSignature,
} from "./keybinding-normalizer.ts";
import {
  createKeybindingAdditionId,
  type KeybindingStore,
  removeAddition,
  setAddition,
  setReplacement,
} from "./keybinding-store.ts";
import type {
  DefaultKeybindingRule,
  KeySequence,
  KeyStroke,
  KeybindingConflict,
  KeybindingDispatch,
  KeybindingPlatform,
  ResolvedKeybindingRule,
} from "./keybinding-model.ts";

export type KeybindingFilter = "all" | "modified" | "conflicts";

export interface KeybindingBindingRow {
  readonly id: string;
  readonly display: string;
  readonly accessible: string;
  readonly source: "default" | "modified" | "user" | "disabled";
  readonly sequence: KeySequence | null;
}

export interface KeybindingCommandRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly category: CommandCategory;
  readonly enabled: boolean;
  readonly reason?: string;
  readonly keywords: string;
  readonly modified: boolean;
  readonly unknown: boolean;
  readonly bindings: readonly KeybindingBindingRow[];
  readonly conflicts: readonly KeybindingConflict[];
}

export interface KeybindingRecordingState {
  readonly commandId: string;
  readonly bindingId: string | null;
  readonly sequence: KeySequence | readonly [];
  readonly conflicts: readonly KeybindingConflict[];
  readonly validationError: "reserved" | "protected" | null;
}

export interface KeybindingSettingsViewModel {
  readonly query: string;
  readonly filter: KeybindingFilter;
  readonly category: CommandCategory | "all";
  readonly rows: readonly KeybindingCommandRow[];
  readonly modifiedCount: number;
  readonly recording: KeybindingRecordingState | null;
  readonly diagnostic: "invalid" | "oversized" | null;
}

type Listener = () => void;

interface PendingChord {
  readonly first: KeyStroke;
  readonly scope: CommandFocusScope;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Owns effective rules, chord state, conflict policy, and Settings editing state. */
export class KeybindingController {
  private readonly listeners = new Set<Listener>();
  private readonly releases: readonly (() => void)[];
  private readonly defaults: readonly DefaultKeybindingRule[];
  private resolved: readonly ResolvedKeybindingRule[] = [];
  private exact = new Map<CommandFocusScope, Map<string, ResolvedKeybindingRule>>();
  private prefixes = new Map<CommandFocusScope, Set<string>>();
  private candidates = new Map<CommandFocusScope, Map<string, ResolvedKeybindingRule[]>>();
  private chordsByPrefix = new Map<CommandFocusScope, Map<string, ResolvedKeybindingRule[]>>();
  private pending: PendingChord | null = null;
  private queryValue = "";
  private filterValue: KeybindingFilter = "all";
  private categoryValue: CommandCategory | "all" = "all";
  private recordingValue: KeybindingRecordingState | null = null;
  private disposed = false;
  private readonly registry: CommandRegistry;
  private readonly store: KeybindingStore;
  readonly platform: KeybindingPlatform;

  constructor(
    registry: CommandRegistry,
    store: KeybindingStore,
    defaults: readonly DefaultKeybindingRule[],
    platform: KeybindingPlatform,
  ) {
    this.registry = registry;
    this.store = store;
    this.platform = platform;
    this.defaults = defaultKeybindingsForPlatform(defaults, platform);
    this.rebuild();
    this.releases = [
      registry.subscribe(() => this.changed()),
      store.subscribe(() => this.changed()),
    ];
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get chordPending(): boolean {
    return this.pending !== null;
  }

  shortcutForCommand(commandId: string, scope?: CommandFocusScope): string | null {
    return this.shortcutsForCommand(commandId, scope)[0] ?? null;
  }

  accessibleShortcutForCommand(commandId: string, scope?: CommandFocusScope): string | null {
    return this.accessibleShortcutsForCommand(commandId, scope)[0] ?? null;
  }

  shortcutsForCommand(commandId: string, scope?: CommandFocusScope): readonly string[] {
    return this.formattedShortcutsForCommand(commandId, scope, false);
  }

  accessibleShortcutsForCommand(
    commandId: string,
    scope?: CommandFocusScope,
  ): readonly string[] {
    return this.formattedShortcutsForCommand(commandId, scope, true);
  }

  ariaShortcutsForCommand(commandId: string, scope?: CommandFocusScope): readonly string[] {
    const shortcuts = this.resolved
      .filter((candidate) =>
        candidate.commandId === commandId && candidate.sequence.length === 1 &&
        (!scope || candidate.scopes.includes(scope))
      )
      .map((rule) => ariaKeyShortcut(formatKeySequence(rule.sequence, this.platform, true)));
    return [...new Set(shortcuts)];
  }

  dispatch(
    event: KeyboardEvent,
    scope: CommandFocusScope,
    terminal = false,
  ): KeybindingDispatch {
    if (this.disposed || event.isComposing) return { kind: "none" };
    const stroke = normalizeKeyboardEvent(event, this.platform);
    if (!stroke) return { kind: "none" };
    if (this.pending) {
      const pending = this.pending;
      this.clearPending();
      if (pending.scope !== scope) return { kind: "handled" };
      const signature = sequenceSignature([pending.first, stroke]);
      const rule = this.exact.get(scope)?.get(signature);
      if (!rule || (terminal && rule.terminalPolicy !== "intercept")) return { kind: "handled" };
      return { kind: "command", commandId: rule.commandId };
    }
    const strokeKey = strokeSignature(stroke);
    const rule = this.exact.get(scope)?.get(sequenceSignature([stroke]));
    if (rule && (!terminal || rule.terminalPolicy === "intercept")) {
      if (event.repeat && this.registry.get(rule.commandId)?.repeatable !== true) {
        return { kind: "handled" };
      }
      return { kind: "command", commandId: rule.commandId };
    }
    if (this.prefixes.get(scope)?.has(strokeKey)) {
      const terminalPrefix = this.resolved.some((candidate) =>
        candidate.scopes.includes(scope) && candidate.sequence.length === 2 &&
        strokeSignature(candidate.sequence[0]) === strokeKey &&
        (!terminal || candidate.terminalPolicy === "intercept")
      );
      if (!terminalPrefix) return { kind: "none" };
      this.pending = {
        first: stroke,
        scope,
        timer: setTimeout(() => {
          this.pending = null;
          this.emit();
        }, 1_200),
      };
      this.emit();
      return { kind: "pending" };
    }
    return { kind: "none" };
  }

  setQuery(query: string): void {
    if (query === this.queryValue) return;
    this.queryValue = query;
    this.emit();
  }

  setFilter(filter: KeybindingFilter): void {
    if (filter === this.filterValue) return;
    this.filterValue = filter;
    this.emit();
  }

  setCategory(category: CommandCategory | "all"): void {
    if (category === this.categoryValue) return;
    this.categoryValue = category;
    this.emit();
  }

  startRecording(commandId: string, bindingId: string | null): void {
    if (!this.registry.get(commandId)) return;
    this.recordingValue = {
      commandId,
      bindingId,
      sequence: [],
      conflicts: [],
      validationError: null,
    };
    this.emit();
  }

  capture(event: KeyboardEvent): boolean {
    const recording = this.recordingValue;
    if (!recording) return false;
    const stroke = normalizeKeyboardEvent(event, this.platform);
    if (!stroke) return false;
    const strokes = recording.sequence.length >= 2
      ? [stroke]
      : [...recording.sequence, stroke];
    const sequence = strokes as unknown as KeySequence;
    const scopes = this.recordingScopes(recording);
    const validationError = reservedSequence(sequence, this.platform, scopes);
    this.recordingValue = {
      ...recording,
      sequence,
      validationError,
      conflicts: validationError ? [] : this.conflicts(sequence, scopes, recording.bindingId),
    };
    this.emit();
    return true;
  }

  clearRecordingSequence(): void {
    if (!this.recordingValue) return;
    this.recordingValue = {
      ...this.recordingValue,
      sequence: [],
      conflicts: [],
      validationError: null,
    };
    this.emit();
  }

  cancelRecording(): void {
    if (!this.recordingValue) return;
    this.recordingValue = null;
    this.emit();
  }

  applyRecording(replaceConflicts: boolean): boolean {
    const recording = this.recordingValue;
    if (!recording || recording.sequence.length === 0 || recording.validationError) return false;
    if (recording.conflicts.length > 0 && !replaceConflicts) return false;
    const sequence = recording.sequence as KeySequence;
    const targetDefault = recording.bindingId
      ? this.defaults.find((rule) => rule.id === recording.bindingId)
      : null;
    const targetAdditionId = recording.bindingId?.startsWith("user:")
      ? recording.bindingId.slice("user:".length)
      : null;
    const changed = this.store.mutate((profile) => {
      if (replaceConflicts) {
        for (const conflict of recording.conflicts) {
          const defaultRule = this.defaults.find((rule) => rule.id === conflict.ruleId);
          if (defaultRule) setReplacement(profile, defaultRule.id, defaultRule.commandId, null);
          else if (conflict.ruleId.startsWith("user:")) {
            removeAddition(profile, conflict.ruleId.slice("user:".length));
          }
        }
      }
      if (targetDefault) {
        setReplacement(profile, targetDefault.id, targetDefault.commandId, sequence);
      } else {
        setAddition(profile, {
          id: targetAdditionId ?? createKeybindingAdditionId(),
          commandId: recording.commandId,
          sequence,
        });
      }
    });
    if (changed) this.recordingValue = null;
    return changed;
  }

  removeBinding(bindingId: string): boolean {
    const defaultRule = this.defaults.find((rule) => rule.id === bindingId);
    if (defaultRule) {
      return this.store.mutate((profile) => {
        setReplacement(profile, defaultRule.id, defaultRule.commandId, null);
      });
    }
    if (!bindingId.startsWith("user:")) return false;
    return this.store.mutate((profile) => removeAddition(profile, bindingId.slice("user:".length)));
  }

  resetCommand(commandId: string): boolean {
    return this.store.mutate((profile) => {
      const bindingIds = new Set(
        this.defaults.filter((rule) => rule.commandId === commandId).map((rule) => rule.id),
      );
      profile.replacements = profile.replacements.filter((entry) => !bindingIds.has(entry.bindingId));
      profile.additions = profile.additions.filter((entry) => entry.commandId !== commandId);
    });
  }

  resetAll(): boolean {
    return this.store.reset();
  }

  viewModel(): KeybindingSettingsViewModel {
    const rows = this.allRows();
    const normalized = this.queryValue.trim().toLocaleLowerCase();
    const visible = rows.filter((row) => {
      if (this.filterValue === "modified" && !row.modified) return false;
      if (this.filterValue === "conflicts" && row.conflicts.length === 0) return false;
      if (this.categoryValue !== "all" && row.category !== this.categoryValue) return false;
      if (!normalized) return true;
      const shortcuts = row.bindings.map((binding) => binding.accessible).join(" ");
      return `${row.title} ${row.detail} ${row.keywords} ${row.id} ${shortcuts}`.toLocaleLowerCase().includes(normalized);
    });
    return {
      query: this.queryValue,
      filter: this.filterValue,
      category: this.categoryValue,
      rows: visible,
      modifiedCount: rows.filter((row) => row.modified).length,
      recording: this.recordingValue,
      diagnostic: this.store.diagnostic?.kind ?? null,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPending();
    for (const release of this.releases) release();
    this.store.dispose();
    this.listeners.clear();
  }

  private formattedShortcutsForCommand(
    commandId: string,
    scope: CommandFocusScope | undefined,
    accessible: boolean,
  ): readonly string[] {
    const shortcuts = this.resolved
      .filter((candidate) =>
        candidate.commandId === commandId && (!scope || candidate.scopes.includes(scope))
      )
      .map((rule) => formatKeySequence(rule.sequence, this.platform, accessible));
    return [...new Set(shortcuts)];
  }

  private allRows(): KeybindingCommandRow[] {
    const profile = this.store.profile;
    const commandIds = new Set(this.registry.list().map((command) => command.id as string));
    for (const entry of profile.replacements) commandIds.add(entry.commandId);
    for (const entry of profile.additions) commandIds.add(entry.commandId);
    const defaultsByCommand = groupByCommand(this.defaults);
    const additionsByCommand = groupByCommand(profile.additions);
    const rulesByCommand = groupByCommand(this.resolved);
    return Array.from(commandIds).map((id): KeybindingCommandRow => {
      const command = this.registry.get(id);
      const availability = command?.availability() ?? { enabled: false };
      const defaultRules = defaultsByCommand.get(id) ?? [];
      const replacementById = new Map(
        profile.replacements.map((replacement) => [replacement.bindingId, replacement]),
      );
      const bindings: KeybindingBindingRow[] = defaultRules.map((rule) => {
        const replacement = replacementById.get(rule.id);
        const sequence = replacement ? replacement.sequence : rule.sequence;
        return {
          id: rule.id,
          display: sequence ? formatKeySequence(sequence, this.platform) : "",
          accessible: sequence ? formatKeySequence(sequence, this.platform, true) : "",
          source: replacement ? (sequence ? "modified" : "disabled") : "default",
          sequence,
        };
      });
      for (const addition of additionsByCommand.get(id) ?? []) {
        bindings.push({
          id: `user:${addition.id}`,
          display: formatKeySequence(addition.sequence, this.platform),
          accessible: formatKeySequence(addition.sequence, this.platform, true),
          source: "user",
          sequence: addition.sequence,
        });
      }
      const modified = bindings.some((binding) => binding.source !== "default");
      const rules = rulesByCommand.get(id) ?? [];
      const conflicts = rules.flatMap((rule) =>
        this.conflicts(rule.sequence, rule.scopes, rule.id).filter((conflict) => conflict.commandId !== id)
      );
      return {
        id,
        title: command?.title() ?? id,
        detail: command?.detail() ?? "",
        keywords: command?.keywords?.() ?? "",
        category: command?.category ?? "workbench",
        enabled: availability.enabled,
        ...(availability.reason ? { reason: availability.reason } : {}),
        modified,
        unknown: !command,
        bindings,
        conflicts,
      };
    }).sort((left, right) =>
      left.category.localeCompare(right.category) || left.title.localeCompare(right.title)
    );
  }

  private recordingScopes(recording: KeybindingRecordingState): readonly CommandFocusScope[] {
    const target = recording.bindingId
      ? this.resolved.find((rule) => rule.id === recording.bindingId) ??
        this.defaults.find((rule) => rule.id === recording.bindingId)
      : null;
    return target?.scopes ?? this.registry.get(recording.commandId)?.userBindingScopes ?? [];
  }

  private conflicts(
    sequence: KeySequence,
    scopes: readonly CommandFocusScope[],
    excludedRuleId: string | null,
  ): KeybindingConflict[] {
    const signature = sequenceSignature(sequence);
    const conflicts = new Map<string, KeybindingConflict>();
    for (const scope of scopes) {
      for (const rule of this.candidates.get(scope)?.get(signature) ?? []) {
        if (rule.id !== excludedRuleId) {
          conflicts.set(rule.id, { ruleId: rule.id, commandId: rule.commandId, kind: "exact" });
        }
      }
      const prefixRules = sequence.length === 1
        ? this.chordsByPrefix.get(scope)?.get(strokeSignature(sequence[0])) ?? []
        : this.candidates.get(scope)?.get(sequenceSignature([sequence[0]])) ?? [];
      for (const rule of prefixRules) {
        if (rule.id !== excludedRuleId && !conflicts.has(rule.id)) {
          conflicts.set(rule.id, { ruleId: rule.id, commandId: rule.commandId, kind: "prefix" });
        }
      }
    }
    return Array.from(conflicts.values());
  }

  private changed(): void {
    this.rebuild();
    if (this.recordingValue?.sequence.length) {
      const scopes = this.recordingScopes(this.recordingValue);
      this.recordingValue = {
        ...this.recordingValue,
        conflicts: this.conflicts(
          this.recordingValue.sequence as KeySequence,
          scopes,
          this.recordingValue.bindingId,
        ),
      };
    }
    this.emit();
  }

  private rebuild(): void {
    const profile = this.store.profile;
    const replacements = new Map(profile.replacements.map((entry) => [entry.bindingId, entry]));
    const rules: ResolvedKeybindingRule[] = [];
    for (const rule of this.defaults) {
      const replacement = replacements.get(rule.id);
      const sequence = replacement ? replacement.sequence : rule.sequence;
      if (!sequence || !this.registry.get(rule.commandId)) continue;
      rules.push({
        ...rule,
        sequence,
        source: replacement ? "replacement" : "default",
        terminalPolicy: rule.terminalPolicy ?? "pass-through",
      });
    }
    for (const addition of profile.additions) {
      const command = this.registry.get(addition.commandId);
      if (!command) continue;
      rules.push({
        id: `user:${addition.id}`,
        commandId: addition.commandId,
        sequence: addition.sequence,
        scopes: command.userBindingScopes,
        source: "user",
        terminalPolicy: command.userBindingScopes.includes("terminal") ? "intercept" : "pass-through",
      });
    }
    this.resolved = rules;
    this.exact = new Map();
    this.prefixes = new Map();
    this.candidates = new Map();
    this.chordsByPrefix = new Map();
    for (const rule of rules) {
      for (const scope of rule.scopes) {
        const exact = this.exact.get(scope) ?? new Map<string, ResolvedKeybindingRule>();
        const signature = sequenceSignature(rule.sequence);
        exact.set(signature, rule);
        this.exact.set(scope, exact);
        const candidates = this.candidates.get(scope) ?? new Map<string, ResolvedKeybindingRule[]>();
        const sameSequence = candidates.get(signature) ?? [];
        sameSequence.push(rule);
        candidates.set(signature, sameSequence);
        this.candidates.set(scope, candidates);
        if (rule.sequence.length === 2) {
          const prefixes = this.prefixes.get(scope) ?? new Set<string>();
          const prefix = strokeSignature(rule.sequence[0]);
          prefixes.add(prefix);
          this.prefixes.set(scope, prefixes);
          const chords = this.chordsByPrefix.get(scope) ?? new Map<string, ResolvedKeybindingRule[]>();
          const samePrefix = chords.get(prefix) ?? [];
          samePrefix.push(rule);
          chords.set(prefix, samePrefix);
          this.chordsByPrefix.set(scope, chords);
        }
      }
    }
  }

  private clearPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}

function reservedSequence(
  sequence: KeySequence,
  platform: KeybindingPlatform,
  scopes: readonly CommandFocusScope[],
): "reserved" | "protected" | null {
  const editable = scopes.some((scope) =>
    scope === "editor" || scope === "diff" || scope === "input" ||
    scope === "history-input" || scope === "settings"
  );
  for (const stroke of sequence) {
    const hasModifier = stroke.primary || stroke.control || stroke.alt || stroke.meta;
    const bareNavigation = !stroke.primary && !stroke.control && !stroke.alt && !stroke.meta &&
      (["Tab", "Enter", "Escape", "Space", "Home", "End", "PageUp", "PageDown"].includes(stroke.key) || stroke.key.startsWith("Arrow"));
    if (bareNavigation) return "reserved";
    if (platform === "macos" && stroke.primary && ["q", "h", "m", "w", "Space", "Tab"].includes(stroke.key)) {
      return "reserved";
    }
    if (platform !== "macos" && stroke.alt && stroke.key === "F4") return "reserved";
    if (editable && stroke.key.length === 1 && !hasModifier) return "protected";
    if (editable && stroke.primary && ["a", "c", "v", "x", "y", "z"].includes(stroke.key)) {
      return "protected";
    }
  }
  return null;
}

function groupByCommand<T extends { readonly commandId: string }>(
  entries: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const values = grouped.get(entry.commandId) ?? [];
    values.push(entry);
    grouped.set(entry.commandId, values);
  }
  return grouped;
}
