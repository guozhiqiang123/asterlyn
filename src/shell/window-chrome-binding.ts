import { icon } from "../icons";
import { windowControls } from "../window-controls";

export interface WindowChromeActions {
  readonly captureEditor: () => void;
  readonly dirtyTextTabs: () => number;
  readonly confirmClose: () => Promise<boolean>;
  readonly reportError: (error: unknown) => void;
}

export class WindowChromeBinding {
  private abortController: AbortController | null = null;
  private releaseResize: (() => void) | null = null;
  private releaseCloseRequest: (() => void) | null = null;
  private generation = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: WindowChromeActions,
  ) {}

  get available(): boolean {
    return windowControls.available;
  }

  bind(): void {
    this.dispose();
    if (!this.available) return;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.abortController = controller;
    const listen = (selector: string, action: () => void) => {
      this.query(selector).addEventListener("click", action, { signal: controller.signal });
    };

    listen("#window-minimize", () => void this.run(() => windowControls.minimize()));
    listen("#window-maximize", () => void this.run(async () => {
      await windowControls.toggleMaximize();
      await this.syncMaximizeControl();
    }));
    listen("#window-close", () => void this.requestClose());
    this.refreshMaximizeControl();
    void this.installNativeListeners(generation);
  }

  dispose(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.releaseResize?.();
    this.releaseResize = null;
    this.releaseCloseRequest?.();
    this.releaseCloseRequest = null;
  }

  private async installNativeListeners(generation: number): Promise<void> {
    try {
      const releaseResize = await windowControls.onResized(() => this.refreshMaximizeControl());
      if (generation !== this.generation) releaseResize();
      else this.releaseResize = releaseResize;

      const releaseClose = await windowControls.onCloseRequested((event) => {
        this.actions.captureEditor();
        if (this.actions.dirtyTextTabs() === 0) return;
        event.preventDefault();
        void this.requestClose();
      });
      if (generation !== this.generation) releaseClose();
      else this.releaseCloseRequest = releaseClose;
    } catch (error) {
      this.actions.reportError(error);
    }
  }

  private async requestClose(): Promise<void> {
    if (!(await this.actions.confirmClose())) return;
    await this.run(() => windowControls.close());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.actions.reportError(error);
    }
  }

  private async syncMaximizeControl(): Promise<void> {
    const maximized = await windowControls.isMaximized();
    const button = this.query<HTMLButtonElement>("#window-maximize");
    const label = maximized ? "Restore window" : "Maximize window";
    button.setAttribute("aria-label", label);
    button.title = maximized ? "Restore" : "Maximize";
    button.innerHTML = icon(maximized ? "restore" : "maximize", 16);
  }

  private refreshMaximizeControl(): void {
    void this.syncMaximizeControl().catch((error) => this.actions.reportError(error));
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing window chrome element: ${selector}`);
    return element;
  }
}
