import type { CommandFocusScope } from "../application/commands/command-service.ts";
import type { BottomTool, LeftTool } from "./layout-state.ts";
import { WORKBENCH_COMMANDS } from "../application/commands/workbench-command-ids.ts";
import type { KeybindingController } from "../features/keybindings/keybinding-controller.ts";
import type { LocaleCatalog } from "../localization/catalog.ts";
import { CHANGES_SHORTCUT_TARGETS } from "../presentation/changes-command-targets.ts";
import { FILES_EDITOR_DOM_COMMANDS } from "../presentation/files-editor-command-targets.ts";
import { STASH_SHORTCUT_TARGETS } from "../presentation/stash-command-targets.ts";
import { HISTORY_DOM_COMMANDS } from "../presentation/history-command-targets.ts";
import { REMOTE_SHORTCUT_TARGETS } from "../presentation/remote-command-targets.ts";
import { SEARCH_SHORTCUT_TARGETS } from "../presentation/search-command-targets.ts";
import { WORKBENCH_DOM_COMMANDS } from "../presentation/workbench-command-targets.ts";
import { TERMINAL_COMMAND_DEFINITIONS } from "../presentation/terminal-command-targets.ts";
import type { ActivityTool } from "./activity-order.ts";

export interface CommandShortcutPresentation {
  readonly selector: string;
  readonly commandId: string;
  readonly label: string;
  readonly title?: string;
  readonly staticAriaShortcuts?: readonly string[];
}

export function refreshCommandShortcut(
  root: ParentNode,
  keybindings: KeybindingController,
  presentation: CommandShortcutPresentation,
): void {
  const button = root.querySelector<HTMLElement>(presentation.selector);
  if (!button) return;
  const accessible = keybindings.accessibleShortcutForCommand(presentation.commandId);
  const baseTitle = presentation.title ?? presentation.label;
  button.setAttribute("aria-label", presentation.label);
  button.title = accessible ? `${baseTitle} (${accessible})` : baseTitle;
  const shortcuts = [
    ...(presentation.staticAriaShortcuts ?? []),
    ...(accessible ? [ariaShortcut(accessible)] : []),
  ];
  if (shortcuts.length > 0) button.setAttribute("aria-keyshortcuts", shortcuts.join(" "));
  else button.removeAttribute("aria-keyshortcuts");
}

export function refreshCommandCenterShortcut(
  root: ParentNode,
  label: string,
  keybindings: KeybindingController,
): void {
  const shortcut = keybindings.shortcutForCommand(WORKBENCH_COMMANDS.quickOpen);
  const button = root.querySelector<HTMLButtonElement>("#command-center-button");
  const key = button?.querySelector<HTMLElement>("kbd");
  if (key) key.textContent = shortcut ?? "";
  refreshCommandShortcut(root, keybindings, {
    selector: "#command-center-button",
    commandId: WORKBENCH_COMMANDS.quickOpen,
    label,
  });
}

export function refreshWorkbenchShortcutPresentation(
  root: ParentNode,
  catalog: LocaleCatalog,
  activityOrder: readonly ActivityTool[],
  keybindings: KeybindingController,
): void {
  const copy = catalog.shell;
  refreshCommandCenterShortcut(root, copy.searchFilesAndCommands, keybindings);
  refreshCommandShortcut(root, keybindings, {
    selector: "#settings-button",
    commandId: WORKBENCH_COMMANDS.openSettings,
    label: copy.openSettings,
    title: copy.settings,
  });
  refreshCommandShortcut(root, keybindings, {
    selector: "#settings-back",
    commandId: WORKBENCH_COMMANDS.closeSettings,
    label: copy.returnToWorkbench,
    title: copy.backToWorkbench,
  });
  const labels: Record<ActivityTool, string> = {
    files: copy.files,
    search: copy.search,
    branches: copy.branches,
    changes: copy.changes,
    stash: copy.stash,
    terminal: copy.terminal,
  };
  const commands: Record<ActivityTool, string> = {
    files: WORKBENCH_COMMANDS.toggleFiles,
    search: WORKBENCH_COMMANDS.toggleSearch,
    branches: WORKBENCH_COMMANDS.toggleGit,
    changes: WORKBENCH_COMMANDS.toggleChanges,
    stash: WORKBENCH_COMMANDS.toggleStash,
    terminal: WORKBENCH_COMMANDS.toggleTerminal,
  };
  for (const tool of activityOrder) {
    const enabled = root.querySelector<HTMLElement>(`[data-tool="${tool}"]`)
      ?.getAttribute("aria-disabled") !== "true";
    refreshCommandShortcut(root, keybindings, {
      selector: `[data-tool="${tool}"]`,
      commandId: commands[tool],
      label: labels[tool],
      title: enabled
        ? copy.toolReorder(labels[tool] || copy.genericTool)
        : tool === "files" || tool === "search" || tool === "terminal"
          ? copy.openFolderFirst
          : copy.gitUnavailableReorder,
      staticAriaShortcuts: ["Alt+ArrowUp", "Alt+ArrowDown"],
    });
  }
  refreshHideShortcut(root, keybindings, "#hide-left-tool", WORKBENCH_COMMANDS.hideLeftTool);
  refreshHideShortcut(root, keybindings, "#hide-bottom-tool", WORKBENCH_COMMANDS.hideBottomTool);
  for (const definition of [...WORKBENCH_DOM_COMMANDS, ...FILES_EDITOR_DOM_COMMANDS, ...CHANGES_SHORTCUT_TARGETS, ...STASH_SHORTCUT_TARGETS, ...HISTORY_DOM_COMMANDS, ...REMOTE_SHORTCUT_TARGETS, ...SEARCH_SHORTCUT_TARGETS]) {
    const button = root.querySelector<HTMLElement>(definition.selector);
    if (!button) continue;
    const label = button.getAttribute("aria-label") ?? definition.title(catalog);
    const currentTitle = button.title || label;
    const baseTitle = currentTitle !== button.dataset.commandShortcutDecoratedTitle
      ? currentTitle
      : button.dataset.commandShortcutBaseTitle ?? currentTitle;
    button.dataset.commandShortcutBaseTitle = baseTitle;
    refreshCommandShortcut(root, keybindings, {
      selector: definition.selector,
      commandId: definition.id,
      label,
      title: baseTitle,
    });
    button.dataset.commandShortcutDecoratedTitle = button.title;
  }
  for (const definition of TERMINAL_COMMAND_DEFINITIONS) {
    const button = root.querySelector<HTMLElement>(definition.presentationSelector);
    if (button) refreshCommandShortcut(root, keybindings, { selector: definition.presentationSelector, commandId: definition.id, label: button.getAttribute("aria-label") ?? definition.title(catalog) });
  }
}

function refreshHideShortcut(
  root: ParentNode,
  keybindings: KeybindingController,
  selector: string,
  commandId: string,
): void {
  const label = root.querySelector(selector)?.getAttribute("aria-label");
  if (label) refreshCommandShortcut(root, keybindings, { selector, commandId, label });
}

function ariaShortcut(accessible: string): string {
  return accessible.replaceAll("Command", "Meta").replaceAll("Option", "Alt");
}

export function shortcutFocusScope(
  target: EventTarget | null,
  settingsOpen: boolean,
  activeDocumentKind: string,
  leftTool: LeftTool,
  bottomTool: BottomTool,
): CommandFocusScope {
  if (settingsOpen) return "settings";
  if (!(target instanceof Element)) return "workbench";
  const editable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement || Boolean(target.closest("[contenteditable='true']"));
  if (target.closest("#push-diff-backdrop")) return "diff";
  if (target.closest("#remote-action-dialog")) return editable ? "input" : "remote";
  if (target.closest("#workspace-replacement-dialog")) return editable ? "input" : "replacement";
  if (target.closest("[role='alertdialog'], [role='dialog']:not(.command-surface)")) {
    return editable ? "input" : "dialog";
  }
  if (target.closest(".xterm")) return "terminal";
  if (target.closest(".cm-editor")) return activeDocumentKind === "project-file" ? "editor" : "diff";
  if (target.closest("#bottom-tool") && bottomTool === "branches") {
    return editable ? "history-input" : "history";
  }
  if (editable) return "input";
  if (target.closest("#left-tool")) {
    if (leftTool === "files") return "files";
    if (leftTool === "changes") return "changes";
  }
  if (target.closest("#bottom-tool")) {
    if (bottomTool === "stash") return "stash";
    if (bottomTool === "find" || bottomTool === "replace") return "search";
  }
  return "workbench";
}
