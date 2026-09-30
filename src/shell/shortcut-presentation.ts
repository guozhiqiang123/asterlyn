import type { CommandFocusScope } from "../application/commands/command-service.ts";
import { WORKBENCH_COMMANDS } from "../application/commands/workbench-command-ids.ts";
import type { KeybindingController } from "../features/keybindings/keybinding-controller.ts";

export function refreshCommandCenterShortcut(
  root: ParentNode,
  label: string,
  keybindings: KeybindingController,
): void {
  const shortcut = keybindings.shortcutForCommand(WORKBENCH_COMMANDS.quickOpen);
  const accessible = keybindings.accessibleShortcutForCommand(WORKBENCH_COMMANDS.quickOpen);
  const button = root.querySelector<HTMLButtonElement>("#command-center-button");
  const key = button?.querySelector<HTMLElement>("kbd");
  if (key) key.textContent = shortcut ?? "";
  if (!button) return;
  button.setAttribute("aria-label", label);
  button.title = accessible ? `${label} (${accessible})` : label;
  if (accessible) {
    button.setAttribute(
      "aria-keyshortcuts",
      accessible.replaceAll("Command", "Meta").replaceAll("Option", "Alt"),
    );
  } else {
    button.removeAttribute("aria-keyshortcuts");
  }
}

export function shortcutFocusScope(
  target: EventTarget | null,
  settingsOpen: boolean,
  activeDocumentKind: string,
  bottomTool: string | null,
): CommandFocusScope {
  if (settingsOpen) return "settings";
  if (!(target instanceof Element)) return "workbench";
  if (target.closest("[role='alertdialog'], [role='dialog']:not(.command-surface)")) return "dialog";
  if (target.closest(".xterm")) return "terminal";
  if (target.closest(".cm-editor")) return activeDocumentKind === "project-file" ? "editor" : "diff";
  if (target.closest("#bottom-tool") && bottomTool === "branches") return "history";
  if (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement || target.closest("[contenteditable='true']")
  ) return "input";
  return "workbench";
}
