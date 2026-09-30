import {
  CommandRegistry,
  CommandService,
  type CommandFocusScope,
} from "../application/commands/command-service.ts";
import { WORKBENCH_COMMANDS } from "../application/commands/workbench-command-ids.ts";
import { DEFAULT_KEYBINDINGS } from "../features/keybindings/default-keybindings.ts";
import { KeybindingController } from "../features/keybindings/keybinding-controller.ts";
import { keybindingPlatform } from "../features/keybindings/keybinding-normalizer.ts";
import {
  KeybindingStore,
  createBrowserKeybindingSync,
} from "../features/keybindings/keybinding-store.ts";
import type { NavigationCommand } from "../features/files-editor/navigation.ts";
import { WindowKeybindingBinding } from "../shell/window-keybinding-binding.ts";
import {
  registerApplicationCommands,
  type ApplicationCommandRuntimeOptions,
} from "./application-command-runtime.ts";

export interface KeyboardShortcutRuntimeOptions
  extends Omit<ApplicationCommandRuntimeOptions, "root"> {
  readonly scope: (target: EventTarget | null) => CommandFocusScope;
  readonly pending: (active: boolean) => void;
  readonly blocked: (reason: string) => void;
  readonly error: (error: unknown) => void;
}

/** Window composition for command discovery, shortcut persistence, and event ownership. */
export class KeyboardShortcutRuntime {
  readonly keybindings: KeybindingController;
  private readonly registry = new CommandRegistry();
  private readonly commands: CommandService;
  private readonly windowBinding: WindowKeybindingBinding;
  private readonly releaseCommands: () => void;
  private disposed = false;

  constructor(
    host: Window,
    storage: Storage,
    options: KeyboardShortcutRuntimeOptions,
  ) {
    this.commands = new CommandService(this.registry, options);
    this.releaseCommands = registerApplicationCommands(this.registry, {
      ...options,
      root: host.document,
    });
    this.keybindings = new KeybindingController(
      this.registry,
      new KeybindingStore(storage, createBrowserKeybindingSync(host)),
      DEFAULT_KEYBINDINGS,
      keybindingPlatform(host.navigator),
    );
    this.windowBinding = new WindowKeybindingBinding(
      host,
      this.keybindings,
      this.commands,
      options,
    );
  }

  bind(): void {
    this.windowBinding.bind();
  }

  subscribe(listener: () => void): () => void {
    return this.keybindings.subscribe(listener);
  }

  navigationCommands(): NavigationCommand[] {
    return this.registry.list().filter((command) => command.id !== WORKBENCH_COMMANDS.historyFind).map((command) => {
      const availability = command.availability();
      const shortcut = this.keybindings.shortcutsForCommand(command.id)[0];
      const ariaShortcuts = this.keybindings.ariaShortcutsForCommand(command.id);
      return {
        id: command.id,
        label: command.title(),
        detail: command.detail(),
        keywords: command.keywords?.(),
        ...(shortcut ? { shortcut } : {}),
        ...(ariaShortcuts.length > 0 ? { ariaShortcuts } : {}),
        enabled: availability.enabled,
      };
    });
  }

  execute(commandId: string): void {
    void this.commands.execute(commandId, "palette");
  }

  handleTerminalKeyEvent = (event: KeyboardEvent): boolean =>
    this.windowBinding.handleTerminalKeyEvent(event);

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.windowBinding.dispose();
    this.keybindings.dispose();
    this.releaseCommands();
  }
}
