import type { GitResetCopy } from "../../localization/git-reviewed-copy.ts";
import type { GitResetMode } from "../../models.ts";
import { GitResetController } from "./git-reset-controller.ts";
import { renderGitResetDialog } from "./git-reset-view.ts";

export class GitResetBinding {
  private readonly root: HTMLElement;
  private readonly controller: GitResetController;
  private readonly copy: () => GitResetCopy;
  private readonly host: HTMLElement;
  private readonly release: () => void;
  private focusReturn: HTMLElement | null = null;
  private wasOpen = false;

  constructor(root: HTMLElement, controller: GitResetController, copy: () => GitResetCopy) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.host = document.createElement("div");
    this.host.id = "git-reset-dialog";
    this.host.className = "dialog-backdrop hidden";
    this.host.setAttribute("role", "presentation");
    root.append(this.host);
    this.release = controller.subscribe(() => this.render());
  }

  render(): void {
    if (!this.host.isConnected) this.root.append(this.host);
    const open = this.controller.state.dialog !== null;
    if (open && !this.wasOpen) this.focusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.wasOpen = open;
    this.host.classList.toggle("hidden", !open);
    this.host.innerHTML = renderGitResetDialog(this.controller.state, this.copy());
    this.host.onclick = open ? (event) => { if (event.target === this.host) this.controller.close(); } : null;
    if (!open) { this.restoreFocus(); return; }
    this.host.querySelectorAll<HTMLElement>("[data-git-reset-close]").forEach((button) => button.onclick = () => { this.controller.close(); });
    this.host.querySelector<HTMLElement>("[data-git-reset-execute]")?.addEventListener("click", () => void this.controller.execute());
    this.host.querySelectorAll<HTMLInputElement>('input[name="git-reset-mode"]').forEach((input) => input.onchange = () => this.controller.selectMode(input.value as GitResetMode));
    this.host.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); this.controller.close(); } };
    queueMicrotask(() => this.host.querySelector<HTMLElement>('input:checked, button:not([disabled])')?.focus());
  }

  refreshCopy(): void { if (this.controller.state.dialog) this.render(); }
  dispose(): void { this.release(); this.host.remove(); this.focusReturn = null; }
  private restoreFocus(): void { const target = this.focusReturn; this.focusReturn = null; if (target?.isConnected) queueMicrotask(() => target.focus()); }
}
