import type { NavigationCopy, ReplacementCopy, ShellCopy } from "../localization/catalog.ts";
import type { BottomTool } from "./layout-state.ts";

export interface BottomToolPresentation {
  readonly title: string;
  readonly hideLabel: string;
  readonly ariaLabel: string;
  readonly showGit: boolean;
  readonly showStash: boolean;
  readonly showTerminal: boolean;
  readonly showFind: boolean;
  readonly showReplace: boolean;
}

export function bottomToolPresentation(
  tool: Exclude<BottomTool, null>,
  shell: ShellCopy,
  navigation: NavigationCopy,
  replacement: ReplacementCopy,
): BottomToolPresentation {
  if (tool === "terminal") {
    return presentation(shell.terminal, shell.hideTerminal, shell.terminal, "terminal");
  }
  if (tool === "stash") {
    return presentation(shell.stash, shell.hideStash, shell.stash, "stash");
  }
  if (tool === "find") {
    return presentation(
      navigation.findWindow,
      navigation.hideFindWindow,
      navigation.findWindow,
      "find",
    );
  }
  if (tool === "replace") {
    return presentation(replacement.replaceWindow, replacement.hideReplaceWindow, replacement.replaceWindow, "replace");
  }
  return presentation("Git", shell.hideGit, shell.branchesAndLog, "git");
}

function presentation(
  title: string,
  hideLabel: string,
  ariaLabel: string,
  visible: "git" | "stash" | "terminal" | "find" | "replace",
): BottomToolPresentation {
  return {
    title,
    hideLabel,
    ariaLabel,
    showGit: visible === "git",
    showStash: visible === "stash",
    showTerminal: visible === "terminal",
    showFind: visible === "find",
    showReplace: visible === "replace",
  };
}
