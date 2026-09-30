import type { CommandAvailability } from "../application/commands/command-service.ts";
import type { EditorTabCommandAction } from "../presentation/files-editor-command-targets.ts";

/** Navigates the rendered tab order so text, preview, and feature-pinned tabs keep one activation route. */
export class EditorTabCommandAdapter {
  private readonly root: ParentNode;
  private readonly blockedReason: () => string;

  constructor(root: ParentNode, blockedReason: () => string) {
    this.root = root;
    this.blockedReason = blockedReason;
  }

  availability(): CommandAvailability {
    return this.target("next")
      ? { enabled: true }
      : { enabled: false, reason: this.blockedReason() };
  }

  execute(action: EditorTabCommandAction): void {
    this.target(action)?.querySelector<HTMLButtonElement>(".editor-tab-target")?.click();
  }

  private target(action: EditorTabCommandAction): HTMLElement | null {
    const tabs = Array.from(this.root.querySelectorAll<HTMLElement>(
      "#editor-tabbar .editor-tab[role=tab]",
    ));
    if (tabs.length < 2) return null;
    const active = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    if (active < 0) return null;
    const offset = action === "previous" ? -1 : 1;
    return tabs[(active + offset + tabs.length) % tabs.length] ?? null;
  }
}
