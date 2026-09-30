export type CommandId = string & { readonly __commandId: unique symbol };

export type CommandCategory =
  | "workbench"
  | "workspace"
  | "editor"
  | "view";

export type CommandFocusScope =
  | "workbench"
  | "input"
  | "files"
  | "changes"
  | "search"
  | "stash"
  | "editor"
  | "diff"
  | "history"
  | "history-input"
  | "terminal"
  | "settings"
  | "remote"
  | "replacement"
  | "dialog";

/** Non-modal scopes where workbench-level commands remain eligible. */
export const WORKBENCH_FOCUS_SCOPES: readonly CommandFocusScope[] = [
  "workbench",
  "input",
  "files",
  "changes",
  "search",
  "stash",
  "editor",
  "diff",
  "history",
  "history-input",
];

/** Workbench scopes plus the terminal boundary used by explicit tool-window shortcuts. */
export const TOOL_FOCUS_SCOPES: readonly CommandFocusScope[] = [
  ...WORKBENCH_FOCUS_SCOPES,
  "terminal",
];

export type CommandInvocationSource = "keyboard" | "palette" | "button";

export interface CommandAvailability {
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface CommandDescriptor {
  readonly id: CommandId;
  readonly category: CommandCategory;
  readonly userBindingScopes: readonly CommandFocusScope[];
  readonly title: () => string;
  readonly detail: () => string;
  readonly keywords?: () => string;
  readonly availability: () => CommandAvailability;
  readonly execute: (source: CommandInvocationSource) => void | Promise<void>;
  readonly repeatable?: boolean;
}

type Listener = () => void;

/** Window-local discovery owner. Feature state remains behind contribution closures. */
export class CommandRegistry {
  private readonly commands = new Map<CommandId, CommandDescriptor>();
  private readonly listeners = new Set<Listener>();

  register(descriptor: CommandDescriptor): () => void {
    if (this.commands.has(descriptor.id)) {
      throw new Error(`Duplicate command registration: ${descriptor.id}`);
    }
    this.commands.set(descriptor.id, descriptor);
    this.emit();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.commands.delete(descriptor.id);
      this.emit();
    };
  }

  get(id: string): CommandDescriptor | null {
    return this.commands.get(id as CommandId) ?? null;
  }

  list(): readonly CommandDescriptor[] {
    return Array.from(this.commands.values());
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export interface CommandServiceFeedback {
  readonly blocked: (reason: string) => void;
  readonly error: (error: unknown) => void;
}

/** Rechecks availability at invocation and contains async failures. */
export class CommandService {
  private readonly running = new Set<CommandId>();
  private readonly registry: CommandRegistry;
  private readonly feedback: CommandServiceFeedback;

  constructor(
    registry: CommandRegistry,
    feedback: CommandServiceFeedback,
  ) {
    this.registry = registry;
    this.feedback = feedback;
  }

  async execute(id: string, source: CommandInvocationSource): Promise<boolean> {
    const command = this.registry.get(id);
    if (!command) return false;
    const availability = command.availability();
    if (!availability.enabled) {
      if (availability.reason) this.feedback.blocked(availability.reason);
      return false;
    }
    if (this.running.has(command.id)) return false;
    this.running.add(command.id);
    try {
      await command.execute(source);
      return true;
    } catch (error) {
      this.feedback.error(error);
      return false;
    } finally {
      this.running.delete(command.id);
    }
  }
}

export function commandId(value: string): CommandId {
  return value as CommandId;
}
