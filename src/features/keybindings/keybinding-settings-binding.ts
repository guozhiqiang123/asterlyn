import type {
  KeybindingController,
  KeybindingFilter,
} from "./keybinding-controller.ts";
import type { KeybindingCopy } from "../../localization/catalog.ts";

export interface KeybindingSettingsBindingOptions {
  readonly render: (focusSelector?: string, selection?: readonly [number, number]) => void;
  readonly error: (error: unknown) => void;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly copy: KeybindingCopy;
}

export function bindKeybindingSettings(
  root: HTMLElement,
  controller: KeybindingController,
  options: KeybindingSettingsBindingOptions,
): void {
  root.querySelector<HTMLInputElement>("#keybinding-search")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    controller.setQuery(input.value);
    options.render("#keybinding-search", [input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length]);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-keybinding-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      controller.setFilter(button.dataset.keybindingFilter as KeybindingFilter);
      options.render(`[data-keybinding-filter="${button.dataset.keybindingFilter}"]`);
    });
  });
  root.querySelector<HTMLSelectElement>("#keybinding-category")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    controller.setCategory(select.value as Parameters<KeybindingController["setCategory"]>[0]);
    options.render("#keybinding-category");
  });
  root.querySelectorAll<HTMLButtonElement>("[data-keybinding-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      controller.startRecording(button.dataset.commandId!, button.dataset.keybindingEdit!);
      options.render("#keybinding-recorder-input");
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-keybinding-add]").forEach((button) => {
    button.addEventListener("click", () => {
      controller.startRecording(button.dataset.commandId!, null);
      options.render("#keybinding-recorder-input");
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-keybinding-remove]").forEach((button) => {
    button.addEventListener("click", () => run(() => controller.removeBinding(button.dataset.keybindingRemove!)));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-keybinding-reset-command]").forEach((button) => {
    button.addEventListener("click", () => run(() => controller.resetCommand(button.dataset.commandId!)));
  });
  root.querySelector<HTMLButtonElement>("[data-keybinding-reset-all]")?.addEventListener("click", () => {
    void options.confirm(options.copy.resetAllConfirm).then((confirmed) => {
      if (confirmed) run(() => controller.resetAll());
    }).catch(options.error);
  });
  root.querySelector<HTMLButtonElement>("[data-keybinding-cancel]")?.addEventListener("click", () => {
    controller.cancelRecording();
    options.render();
  });
  root.querySelector<HTMLButtonElement>("[data-keybinding-save]")?.addEventListener("click", () => apply(false));
  root.querySelector<HTMLButtonElement>("[data-keybinding-replace]")?.addEventListener("click", () => apply(true));
  root.querySelector<HTMLElement>("#keybinding-recorder-input")?.addEventListener("keydown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      controller.cancelRecording();
      options.render();
      return;
    }
    if (event.key === "Enter") {
      apply(false);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      controller.clearRecordingSequence();
      options.render("#keybinding-recorder-input");
      return;
    }
    if (controller.capture(event)) options.render("#keybinding-recorder-input");
  });

  function apply(replace: boolean): void {
    const commandId = controller.viewModel().recording?.commandId;
    run(() => controller.applyRecording(replace), commandId ? `[data-keybinding-command="${CSS.escape(commandId)}"]` : undefined);
  }

  function run(action: () => boolean, focusSelector?: string): void {
    try {
      if (action()) options.render(focusSelector);
    } catch (error) {
      options.error(error);
    }
  }
}
