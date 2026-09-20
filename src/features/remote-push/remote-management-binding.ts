import type { RemoteManagementCopy } from "../../localization/git-reviewed-copy.ts";
import { RemoteManagementController } from "./remote-management-controller.ts";
import { renderRemoteManagement } from "./remote-management-view.ts";

export class RemoteManagementBinding {
  private readonly root: HTMLElement;
  private readonly controller: RemoteManagementController;
  private readonly copy: () => RemoteManagementCopy;
  private readonly host: HTMLElement;
  private readonly release: () => void;
  private focusReturn: HTMLElement | null = null;
  private wasOpen = false;

  constructor(
    root: HTMLElement,
    controller: RemoteManagementController,
    copy: () => RemoteManagementCopy,
  ) {
    this.root = root;
    this.controller = controller;
    this.copy = copy;
    this.host = document.createElement("div");
    this.host.id = "remote-management-dialog";
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
    this.host.innerHTML = renderRemoteManagement(this.controller.state, this.copy());
    this.host.onclick = open ? (event) => { if (event.target === this.host) this.controller.close(); } : null;
    if (!open) { this.restoreFocus(); return; }
    this.host.querySelectorAll<HTMLElement>("[data-remote-close]").forEach((button) => button.onclick = () => { this.controller.close(); });
    this.host.querySelectorAll<HTMLElement>("[data-remote-back]").forEach((button) => button.onclick = () => this.controller.back());
    this.host.querySelectorAll<HTMLElement>("[data-remote-name]").forEach((row) => row.onclick = () => this.controller.select(row.dataset.remoteName ?? ""));
    this.host.querySelector<HTMLElement>("[data-remote-add]")?.addEventListener("click", () => this.controller.add());
    this.host.querySelector<HTMLElement>("[data-remote-edit]")?.addEventListener("click", () => this.controller.edit());
    this.host.querySelector<HTMLElement>("[data-remote-delete]")?.addEventListener("click", () => this.controller.requestDelete());
    this.host.querySelector<HTMLElement>("[data-remote-confirm-delete]")?.addEventListener("click", () => void this.controller.delete());
    this.host.querySelector<HTMLInputElement>("#remote-definition-name")?.addEventListener("input", (event) => this.controller.update("name", (event.currentTarget as HTMLInputElement).value));
    this.host.querySelector<HTMLInputElement>("#remote-definition-url")?.addEventListener("input", (event) => this.controller.update("url", (event.currentTarget as HTMLInputElement).value));
    this.host.querySelector<HTMLInputElement>("#remote-definition-fetch")?.addEventListener("change", (event) => this.controller.update("fetch", (event.currentTarget as HTMLInputElement).checked));
    this.host.querySelector<HTMLFormElement>("#remote-definition-form")?.addEventListener("submit", (event) => { event.preventDefault(); void this.controller.save(); });
    this.host.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault();
      if (this.controller.state.dialog?.kind === "list") this.controller.close(); else this.controller.back(); } };
    queueMicrotask(() => (this.host.querySelector<HTMLElement>("input, button:not([disabled])")?.focus()));
  }

  refreshCopy(): void { if (this.controller.state.dialog) this.render(); }
  dispose(): void { this.release(); this.host.remove(); this.focusReturn = null; }
  private restoreFocus(): void { const target = this.focusReturn; this.focusReturn = null; if (target?.isConnected) queueMicrotask(() => target.focus()); }
}
