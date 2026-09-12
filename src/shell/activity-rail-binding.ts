import {
  moveActivityTool,
  moveActivityToolByOffset,
  type ActivityDropPosition,
  type ActivityTool,
} from "../workbench/activity-order.ts";

export interface ActivityRailCallbacks {
  readonly order: () => readonly ActivityTool[];
  readonly activate: (tool: ActivityTool) => void;
  readonly commitOrder: (order: ActivityTool[], focusTool: ActivityTool) => void;
}

interface PointerDrag {
  source: ActivityTool;
  pointerId: number;
  startY: number;
  dragging: boolean;
  target: ActivityTool | null;
  position: ActivityDropPosition | null;
}

export class ActivityRailBinding {
  private drag: PointerDrag | null = null;
  private suppressedClick: ActivityTool | null = null;
  private installed = false;
  private readonly move = (event: PointerEvent) => this.moveDrag(event);
  private readonly finish = (event: PointerEvent) => this.finishDrag(event);
  private readonly cancel = () => this.clearDragState();

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: ActivityRailCallbacks,
  ) {}

  bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>(".activity-rail [data-tool]").forEach((button) => {
      const tool = button.dataset.tool as ActivityTool;
      button.addEventListener("click", () => {
        if (this.suppressedClick === tool) {
          this.suppressedClick = null;
          return;
        }
        if (button.getAttribute("aria-disabled") !== "true") this.callbacks.activate(tool);
      });
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        this.drag = {
          source: tool,
          pointerId: event.pointerId,
          startY: event.clientY,
          dragging: false,
          target: null,
          position: null,
        };
      });
      button.addEventListener("keydown", (event) => {
        if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault();
        this.callbacks.commitOrder(
          moveActivityToolByOffset(
            this.callbacks.order(),
            tool,
            event.key === "ArrowUp" ? -1 : 1,
          ),
          tool,
        );
      });
    });
    if (this.installed) return;
    this.installed = true;
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.finish);
    window.addEventListener("pointercancel", this.cancel);
  }

  dispose(): void {
    if (!this.installed) return;
    this.installed = false;
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.finish);
    window.removeEventListener("pointercancel", this.cancel);
    this.clearDragState();
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging && Math.abs(event.clientY - drag.startY) < 5) return;
    drag.dragging = true;
    this.root.querySelector<HTMLElement>(`[data-tool="${drag.source}"]`)?.classList.add("dragging");
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>(".activity-rail [data-tool]") ?? null;
    this.clearDropMarkers();
    if (!target || target.dataset.tool === drag.source) {
      drag.target = null;
      drag.position = null;
      return;
    }
    drag.target = target.dataset.tool as ActivityTool;
    const bounds = target.getBoundingClientRect();
    drag.position = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    target.classList.add(drag.position === "before" ? "drop-before" : "drop-after");
  }

  private finishDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.dragging) {
      event.preventDefault();
      this.suppressedClick = drag.source;
      window.setTimeout(() => {
        if (this.suppressedClick === drag.source) this.suppressedClick = null;
      }, 0);
      if (drag.target && drag.position) {
        this.callbacks.commitOrder(
          moveActivityTool(
            this.callbacks.order(),
            drag.source,
            drag.target,
            drag.position,
          ),
          drag.source,
        );
      }
    }
    this.clearDragState();
  }

  private clearDropMarkers(): void {
    this.root.querySelectorAll<HTMLElement>(".activity-rail [data-tool]").forEach((button) => {
      button.classList.remove("drop-before", "drop-after");
    });
  }

  private clearDragState(): void {
    this.drag = null;
    this.clearDropMarkers();
    this.root.querySelectorAll<HTMLElement>(".activity-rail [data-tool]").forEach((button) => {
      button.classList.remove("dragging");
    });
  }
}
