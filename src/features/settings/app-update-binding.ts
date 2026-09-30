import type { AppUpdateController } from "./app-update-controller.ts";

export function bindAppUpdateControls(
  root: HTMLElement,
  controller: AppUpdateController,
  render: () => void,
): void {
  bindAsyncAction(root, "#setting-check-for-updates", () => controller.check(), render);
  bindAsyncAction(root, "#setting-open-update-release", () => controller.openRelease(), render);
}

function bindAsyncAction(
  root: HTMLElement,
  selector: string,
  action: () => Promise<void>,
  render: () => void,
): void {
  root.querySelector<HTMLButtonElement>(selector)?.addEventListener("click", (event) => {
    const id = (event.currentTarget as HTMLButtonElement).id;
    const pending = action();
    renderAndRestoreFocus(root, render, id);
    void pending.finally(() => renderAndRestoreFocus(root, render, id));
  });
}

function renderAndRestoreFocus(root: HTMLElement, render: () => void, id: string): void {
  render();
  queueMicrotask(() => {
    const button = root.querySelector<HTMLButtonElement>(`#${id}`);
    if (button && !button.closest(".hidden")) button.focus();
  });
}
