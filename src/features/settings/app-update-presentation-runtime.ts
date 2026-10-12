import type { AppUpdateController } from "./app-update-controller.ts";
import { renderAppUpdateDialog } from "./settings-view.ts";
import type { CommonCopy, SettingsCopy } from "../../localization/catalog.ts";

export interface AppUpdatePresentationOptions {
  readonly copy: () => { readonly settings: SettingsCopy; readonly common: CommonCopy };
  readonly settingsVisible: () => boolean;
  readonly renderSettings: () => void;
}

/** Owns the window-level update prompt while Settings owns the detailed status panel. */
export class AppUpdatePresentationRuntime {
  private readonly release: () => void;
  private renderedDialog: "confirm" | "installing" | "error" | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: AppUpdateController,
    private readonly options: AppUpdatePresentationOptions,
  ) {
    this.release = controller.subscribe(() => {
      if (options.settingsVisible()) options.renderSettings();
      this.render();
    });
  }

  checkOnStartup(): void {
    void this.controller.check(true);
  }

  render(): void {
    const host = this.root.querySelector<HTMLElement>("#app-update-dialog");
    if (!host) return;
    const state = this.controller.state;
    const previous = this.renderedDialog;
    const document = this.root.ownerDocument;
    if (!previous && state.dialog) {
      this.returnFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    this.renderedDialog = state.dialog;
    host.classList.toggle("hidden", state.dialog === null);
    const copy = this.options.copy();
    host.innerHTML = renderAppUpdateDialog(state, copy.settings, copy.common);
    if (!state.dialog) {
      host.onclick = null;
      if (previous) {
        const target = this.returnFocus;
        this.returnFocus = null;
        queueMicrotask(() => target?.isConnected && target.focus());
      }
      return;
    }

    const close = () => this.controller.closeDialog();
    host.onclick = (event) => {
      if (event.target === host) close();
    };
    host.querySelector("#app-update-dialog-close")?.addEventListener("click", close);
    host.querySelector("#app-update-cancel")?.addEventListener("click", close);
    host.querySelector("#app-update-close")?.addEventListener("click", close);
    host.querySelector("#app-update-confirm")?.addEventListener("click", () => {
      void this.controller.install();
    });
    host.querySelector("#app-update-open-release")?.addEventListener("click", () => {
      void this.controller.openRelease();
    });
    host.querySelector<HTMLElement>(".app-update-dialog")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    if (previous !== state.dialog) {
      queueMicrotask(() => {
        host.querySelector<HTMLElement>(
          "#app-update-confirm, #app-update-close, #app-update-dialog-close",
        )?.focus();
      });
    }
  }

  dispose(): void {
    this.release();
  }
}
