import type {
  CommandFocusScope,
  CommandService,
} from "../application/commands/command-service.ts";
import type { KeybindingController } from "../features/keybindings/keybinding-controller.ts";

export interface WindowKeybindingBindingOptions {
  readonly scope: (target: EventTarget | null) => CommandFocusScope;
  readonly pending: (active: boolean) => void;
}

/** Owns the single application-command keydown listener for one window. */
export class WindowKeybindingBinding {
  private abortController: AbortController | null = null;
  private releasePending: (() => void) | null = null;
  private pendingVisible = false;
  private readonly host: Window;
  private readonly keybindings: KeybindingController;
  private readonly commands: CommandService;
  private readonly options: WindowKeybindingBindingOptions;

  constructor(
    host: Window,
    keybindings: KeybindingController,
    commands: CommandService,
    options: WindowKeybindingBindingOptions,
  ) {
    this.host = host;
    this.keybindings = keybindings;
    this.commands = commands;
    this.options = options;
  }

  bind(): void {
    this.dispose();
    const controller = new AbortController();
    this.abortController = controller;
    this.releasePending = this.keybindings.subscribe(() => this.refreshPending());
    this.host.addEventListener("keydown", this.handleKeydown, {
      capture: true,
      signal: controller.signal,
    });
  }

  /** xterm returns false when an application command consumed the event. */
  handleTerminalKeyEvent = (event: KeyboardEvent): boolean => {
    if (event.type !== "keydown") return true;
    const result = this.keybindings.dispatch(event, "terminal", true);
    this.refreshPending();
    if (result.kind === "none") return true;
    event.preventDefault();
    if (result.kind === "command" && result.commandId) {
      void this.commands.execute(result.commandId, "keyboard");
    }
    return false;
  };

  dispose(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.releasePending?.();
    this.releasePending = null;
    if (this.pendingVisible) {
      this.pendingVisible = false;
      this.options.pending(false);
    }
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const scope = this.options.scope(event.target);
    if (scope === "terminal") return;
    const result = this.keybindings.dispatch(event, scope);
    this.refreshPending();
    if (result.kind === "none") return;
    event.preventDefault();
    event.stopPropagation();
    if (result.kind === "command" && result.commandId) {
      void this.commands.execute(result.commandId, "keyboard");
    }
  };

  private refreshPending(): void {
    const pending = this.keybindings.chordPending;
    if (pending === this.pendingVisible) return;
    this.pendingVisible = pending;
    this.options.pending(pending);
  }
}
