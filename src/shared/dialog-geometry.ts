export interface DialogRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DialogBounds {
  width: number;
  height: number;
}

export interface DialogMinimumSize {
  width: number;
  height: number;
}

export type DialogResizeEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export interface DialogGeometryLabels {
  move: string;
  resize: string;
}

export const DIALOG_GEOMETRY_STORAGE_PREFIX = "asterlyn.dialog-geometry.v1.";
export const DIALOG_GEOMETRY_INSET = 12;

const LEGACY_PUSH_GEOMETRY_KEY = "asterlyn.push-dialog-geometry";
const DIALOG_SELECTOR = ".dialog, .command-surface[role=\"dialog\"]";
const TITLEBAR_SELECTOR = ".dialog-heading, .command-surface-tabs";
const INTERACTIVE_SELECTOR = "button, input, textarea, select, option, a, [contenteditable=\"true\"], [role=\"button\"]";
const EDGES: readonly DialogResizeEdge[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function axisInset(length: number, inset: number): number {
  return Math.min(Math.max(0, inset), Math.max(0, length / 2));
}

export function fitDialogRect(
  rect: DialogRect,
  bounds: DialogBounds,
  minimum: DialogMinimumSize,
  inset = DIALOG_GEOMETRY_INSET,
): DialogRect {
  const horizontalInset = axisInset(bounds.width, inset);
  const verticalInset = axisInset(bounds.height, inset);
  const availableWidth = Math.max(0, bounds.width - 2 * horizontalInset);
  const availableHeight = Math.max(0, bounds.height - 2 * verticalInset);
  const minimumWidth = Math.min(Math.max(0, minimum.width), availableWidth);
  const minimumHeight = Math.min(Math.max(0, minimum.height), availableHeight);
  const width = clamp(rect.width, minimumWidth, availableWidth);
  const height = clamp(rect.height, minimumHeight, availableHeight);
  return {
    left: clamp(
      rect.left,
      horizontalInset,
      Math.max(horizontalInset, bounds.width - horizontalInset - width),
    ),
    top: clamp(
      rect.top,
      verticalInset,
      Math.max(verticalInset, bounds.height - verticalInset - height),
    ),
    width,
    height,
  };
}

export function moveDialogRect(
  initial: DialogRect,
  dx: number,
  dy: number,
  bounds: DialogBounds,
  minimum: DialogMinimumSize,
  inset = DIALOG_GEOMETRY_INSET,
): DialogRect {
  const fitted = fitDialogRect(initial, bounds, minimum, inset);
  return fitDialogRect(
    { ...fitted, left: fitted.left + dx, top: fitted.top + dy },
    bounds,
    minimum,
    inset,
  );
}

export function resizeDialogRect(
  initial: DialogRect,
  edge: DialogResizeEdge,
  dx: number,
  dy: number,
  bounds: DialogBounds,
  minimum: DialogMinimumSize,
  inset = DIALOG_GEOMETRY_INSET,
): DialogRect {
  const start = fitDialogRect(initial, bounds, minimum, inset);
  const horizontalInset = axisInset(bounds.width, inset);
  const verticalInset = axisInset(bounds.height, inset);
  const minimumWidth = Math.min(minimum.width, bounds.width - 2 * horizontalInset);
  const minimumHeight = Math.min(minimum.height, bounds.height - 2 * verticalInset);
  let left = start.left;
  let right = start.left + start.width;
  let top = start.top;
  let bottom = start.top + start.height;
  if (edge.includes("e")) {
    right = clamp(right + dx, left + minimumWidth, bounds.width - horizontalInset);
  }
  if (edge.includes("w")) {
    left = clamp(left + dx, horizontalInset, right - minimumWidth);
  }
  if (edge.includes("s")) {
    bottom = clamp(bottom + dy, top + minimumHeight, bounds.height - verticalInset);
  }
  if (edge.includes("n")) {
    top = clamp(top + dy, verticalInset, bottom - minimumHeight);
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function dialogGeometryStorageKey(key: string): string {
  return `${DIALOG_GEOMETRY_STORAGE_PREFIX}${encodeURIComponent(key)}`;
}

export function loadDialogGeometry(
  storage: Pick<Storage, "getItem"> | null | undefined,
  key: string,
  bounds: DialogBounds,
  minimum: DialogMinimumSize,
): DialogRect | null {
  const stored = storage?.getItem(dialogGeometryStorageKey(key)) ??
    (key === "remote-action-dialog:push-dialog"
      ? storage?.getItem(LEGACY_PUSH_GEOMETRY_KEY)
      : null);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<DialogRect>;
    if (
      Number.isFinite(parsed.left) && Number.isFinite(parsed.top) &&
      Number.isFinite(parsed.width) && Number.isFinite(parsed.height)
    ) {
      return fitDialogRect(parsed as DialogRect, bounds, minimum);
    }
  } catch {
    // Corrupt or older geometry falls back to the dialog's CSS defaults.
  }
  return null;
}

export function saveDialogGeometry(
  storage: Pick<Storage, "setItem"> | null | undefined,
  key: string,
  rect: DialogRect,
): void {
  try {
    storage?.setItem(dialogGeometryStorageKey(key), JSON.stringify(rect));
  } catch {
    // Geometry is a convenience. Storage failures must never block the dialog workflow.
  }
}

export function clearDialogGeometry(
  storage: Pick<Storage, "removeItem"> | null | undefined,
  key: string,
): void {
  try {
    storage?.removeItem(dialogGeometryStorageKey(key));
    if (key === "remote-action-dialog:push-dialog") storage?.removeItem(LEGACY_PUSH_GEOMETRY_KEY);
  } catch {
    // Resetting remains best-effort when profile storage is unavailable.
  }
}

interface GeometryConstraints {
  minimum: DialogMinimumSize;
  defaultWidth: number | null;
  defaultHeight: number | null;
}

interface PointerInteraction {
  pointerId: number;
  target: HTMLElement;
  capture: HTMLElement;
  mode: "move" | "resize";
  edge?: DialogResizeEdge;
  x: number;
  y: number;
  rect: DialogRect;
}

/**
 * Window-scoped presentation behavior for every application-owned modal surface.
 * Feature controllers retain dialog state and focus ownership; this controller owns only geometry.
 */
export class DialogGeometryController {
  private readonly document: Document;
  private readonly viewport: Window;
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  private readonly labels: () => DialogGeometryLabels;
  private readonly initialized = new WeakSet<HTMLElement>();
  private readonly current = new WeakMap<HTMLElement, DialogRect>();
  private readonly managed = new Set<HTMLElement>();
  private readonly abortController = new AbortController();
  private observer: MutationObserver | null = null;
  private scanQueued = false;
  private interaction: PointerInteraction | null = null;

  constructor(
    document: Document,
    viewport: Window,
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
    labels: () => DialogGeometryLabels,
  ) {
    this.document = document;
    this.viewport = viewport;
    this.storage = storage;
    this.labels = labels;
  }

  connect(): void {
    if (this.observer) return;
    const signal = this.abortController.signal;
    this.document.addEventListener("pointerdown", (event) => this.pointerDown(event), { signal });
    this.document.addEventListener("pointermove", (event) => this.pointerMove(event), { signal });
    this.document.addEventListener("pointerup", (event) => this.finishPointer(event), { signal });
    this.document.addEventListener("pointercancel", (event) => this.finishPointer(event), { signal });
    this.document.addEventListener("keydown", (event) => this.keyDown(event), { signal });
    this.document.addEventListener("dblclick", (event) => this.doubleClick(event), { signal });
    this.viewport.addEventListener("resize", () => this.fitManagedDialogs(), { signal });
    this.observer = new MutationObserver(() => this.queueScan());
    this.observer.observe(this.document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "open"],
    });
    this.scan();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.abortController.abort();
    this.interaction = null;
    this.managed.clear();
    this.document.body.classList.remove("dialog-geometry-interacting");
  }

  private queueScan(): void {
    if (this.scanQueued) return;
    this.scanQueued = true;
    queueMicrotask(() => {
      this.scanQueued = false;
      this.scan();
    });
  }

  private scan(): void {
    for (const dialog of this.managed) {
      if (!dialog.isConnected) this.managed.delete(dialog);
    }
    for (const dialog of this.document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR)) {
      if (!this.visible(dialog)) continue;
      this.prepare(dialog);
    }
  }

  private prepare(dialog: HTMLElement): void {
    this.managed.add(dialog);
    if (this.initialized.has(dialog)) {
      const current = this.current.get(dialog);
      if (current) this.apply(dialog, current);
      return;
    }
    // Mark the element before mutating its class or children. Those mutations are
    // observed by this controller and schedule another scan; repeated writes here
    // would otherwise keep the microtask queue busy indefinitely.
    this.initialized.add(dialog);
    dialog.classList.add("dialog-geometry-managed");
    const titlebar = dialog.querySelector<HTMLElement>(TITLEBAR_SELECTOR);
    if (titlebar) {
      titlebar.dataset.dialogDragHandle = "true";
      if (titlebar.tabIndex < 0) titlebar.tabIndex = 0;
      if (titlebar.getAttribute("role") !== "tablist") {
        titlebar.setAttribute("aria-label", this.moveLabel(dialog));
      }
    }
    for (const edge of EDGES) {
      let handle = dialog.querySelector<HTMLElement>(`:scope > [data-dialog-resize="${edge}"]`);
      if (!handle) {
        handle = this.document.createElement("span");
        handle.className = `dialog-geometry-resize-handle ${edge}`;
        handle.dataset.dialogResize = edge;
        dialog.append(handle);
      }
      if (edge === "se") {
        handle.setAttribute("role", "separator");
        handle.setAttribute("aria-label", this.resizeLabel(dialog));
        handle.tabIndex = 0;
      } else {
        handle.setAttribute("aria-hidden", "true");
      }
    }
    const bounds = this.bounds(dialog);
    const constraints = this.constraints(dialog);
    const saved = loadDialogGeometry(
      this.storage,
      this.geometryKey(dialog),
      bounds,
      constraints.minimum,
    );
    if (saved) {
      this.apply(dialog, saved);
      return;
    }
    if (constraints.defaultWidth !== null || constraints.defaultHeight !== null) {
      const measured = this.measure(dialog);
      const width = constraints.defaultWidth ?? measured.width;
      const height = constraints.defaultHeight ?? measured.height;
      this.apply(dialog, fitDialogRect({
        left: (bounds.width - width) / 2,
        top: (bounds.height - height) / 2,
        width,
        height,
      }, bounds, constraints.minimum));
    }
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const resizeHandle = event.target.closest<HTMLElement>("[data-dialog-resize]");
    const titlebar = event.target.closest<HTMLElement>("[data-dialog-drag-handle]");
    const dialog = (resizeHandle ?? titlebar)?.closest<HTMLElement>(DIALOG_SELECTOR);
    if (!dialog || !this.visible(dialog)) return;
    if (titlebar && !resizeHandle && event.target.closest(INTERACTIVE_SELECTOR)) return;
    const capture = resizeHandle ?? titlebar;
    if (!capture) return;
    const rect = fitDialogRect(
      this.current.get(dialog) ?? this.measure(dialog),
      this.bounds(dialog),
      this.constraints(dialog).minimum,
    );
    this.apply(dialog, rect);
    this.interaction = {
      pointerId: event.pointerId,
      target: dialog,
      capture,
      mode: resizeHandle ? "resize" : "move",
      edge: resizeHandle?.dataset.dialogResize as DialogResizeEdge | undefined,
      x: event.clientX,
      y: event.clientY,
      rect,
    };
    capture.setPointerCapture?.(event.pointerId);
    this.document.body.classList.add("dialog-geometry-interacting");
    event.preventDefault();
    event.stopPropagation();
  }

  private pointerMove(event: PointerEvent): void {
    const interaction = this.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId || !interaction.target.isConnected) return;
    const bounds = this.bounds(interaction.target);
    const minimum = this.constraints(interaction.target).minimum;
    const dx = event.clientX - interaction.x;
    const dy = event.clientY - interaction.y;
    const rect = interaction.mode === "move"
      ? moveDialogRect(interaction.rect, dx, dy, bounds, minimum)
      : resizeDialogRect(interaction.rect, interaction.edge ?? "se", dx, dy, bounds, minimum);
    this.apply(interaction.target, rect);
    event.preventDefault();
  }

  private finishPointer(event: PointerEvent): void {
    const interaction = this.interaction;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    this.interaction = null;
    this.document.body.classList.remove("dialog-geometry-interacting");
    const rect = this.current.get(interaction.target);
    if (rect) saveDialogGeometry(this.storage, this.geometryKey(interaction.target), rect);
  }

  private keyDown(event: KeyboardEvent): void {
    if (!(event.target instanceof Element)) return;
    const resizeHandle = event.target.closest<HTMLElement>('[data-dialog-resize="se"]');
    const titlebar = event.target.closest<HTMLElement>("[data-dialog-drag-handle]");
    const dialog = (resizeHandle ?? titlebar)?.closest<HTMLElement>(DIALOG_SELECTOR);
    if (!dialog || !this.visible(dialog)) return;
    if (titlebar && event.target !== titlebar && !resizeHandle) return;
    if (titlebar?.getAttribute("role") === "tablist" && !event.altKey) return;
    const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!dx && !dy) return;
    const step = event.shiftKey ? 48 : 16;
    const bounds = this.bounds(dialog);
    const minimum = this.constraints(dialog).minimum;
    const current = fitDialogRect(this.current.get(dialog) ?? this.measure(dialog), bounds, minimum);
    const move = Boolean(titlebar && !resizeHandle) || event.altKey;
    const next = move
      ? moveDialogRect(current, dx * step, dy * step, bounds, minimum)
      : resizeDialogRect(current, "se", dx * step, dy * step, bounds, minimum);
    this.apply(dialog, next);
    saveDialogGeometry(this.storage, this.geometryKey(dialog), next);
    event.preventDefault();
    event.stopPropagation();
  }

  private doubleClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const titlebar = event.target.closest<HTMLElement>("[data-dialog-drag-handle]");
    const dialog = titlebar?.closest<HTMLElement>(DIALOG_SELECTOR);
    if (!titlebar || !dialog || event.target.closest(INTERACTIVE_SELECTOR)) return;
    clearDialogGeometry(this.storage, this.geometryKey(dialog));
    this.current.delete(dialog);
    this.initialized.delete(dialog);
    for (const property of ["position", "left", "right", "top", "bottom", "width", "height", "margin"]) {
      dialog.style.removeProperty(property);
    }
    this.viewport.requestAnimationFrame(() => {
      if (this.visible(dialog)) this.prepare(dialog);
    });
    event.preventDefault();
    event.stopPropagation();
  }

  private fitManagedDialogs(): void {
    for (const dialog of this.managed) {
      if (!this.visible(dialog)) continue;
      const current = this.current.get(dialog);
      if (!current) continue;
      const fitted = fitDialogRect(
        current,
        this.bounds(dialog),
        this.constraints(dialog).minimum,
      );
      this.apply(dialog, fitted);
      saveDialogGeometry(this.storage, this.geometryKey(dialog), fitted);
    }
  }

  private apply(dialog: HTMLElement, rect: DialogRect): void {
    const next = fitDialogRect(
      rect,
      this.bounds(dialog),
      this.constraints(dialog).minimum,
    );
    this.current.set(dialog, next);
    dialog.style.position = dialog.tagName === "DIALOG" ? "fixed" : "absolute";
    dialog.style.margin = "0";
    dialog.style.right = "auto";
    dialog.style.bottom = "auto";
    dialog.style.left = `${Math.round(next.left)}px`;
    dialog.style.top = `${Math.round(next.top)}px`;
    dialog.style.width = `${Math.round(next.width)}px`;
    dialog.style.height = `${Math.round(next.height)}px`;
  }

  private measure(dialog: HTMLElement): DialogRect {
    const frame = this.containerRect(dialog);
    const rect = dialog.getBoundingClientRect();
    return {
      left: rect.left - frame.left,
      top: rect.top - frame.top,
      width: rect.width,
      height: rect.height,
    };
  }

  private bounds(dialog: HTMLElement): DialogBounds {
    const rect = this.containerRect(dialog);
    return {
      width: rect.width || this.viewport.innerWidth,
      height: rect.height || this.viewport.innerHeight,
    };
  }

  private containerRect(dialog: HTMLElement): Pick<DOMRect, "left" | "top" | "width" | "height"> {
    if (dialog.tagName === "DIALOG") {
      return { left: 0, top: 0, width: this.viewport.innerWidth, height: this.viewport.innerHeight };
    }
    const layer = dialog.closest<HTMLElement>(
      ".dialog-backdrop, .push-diff-backdrop, .remote-authentication-backdrop",
    );
    return layer?.getBoundingClientRect() ??
      { left: 0, top: 0, width: this.viewport.innerWidth, height: this.viewport.innerHeight };
  }

  private constraints(dialog: HTMLElement): GeometryConstraints {
    const styles = this.viewport.getComputedStyle(dialog);
    const number = (name: string, fallback: number | null): number | null => {
      const parsed = Number.parseFloat(styles.getPropertyValue(name));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    return {
      minimum: {
        width: number("--dialog-geometry-min-width", 320) ?? 320,
        height: number("--dialog-geometry-min-height", 160) ?? 160,
      },
      defaultWidth: number("--dialog-geometry-default-width", null),
      defaultHeight: number("--dialog-geometry-default-height", null),
    };
  }

  private geometryKey(dialog: HTMLElement): string {
    const explicit = dialog.dataset.dialogGeometryKey;
    if (explicit) return explicit;
    if (dialog.classList.contains("remote-authentication-dialog")) return "remote-authentication-dialog";
    if (dialog.classList.contains("worktree-recovery-dialog")) return "worktree-recovery-dialog";
    const layer = dialog.closest<HTMLElement>("[id].dialog-backdrop, #push-diff-backdrop");
    if (layer?.id === "remote-action-dialog") {
      if (dialog.classList.contains("push-dialog")) return `${layer.id}:push-dialog`;
      if (dialog.classList.contains("update-dialog")) return `${layer.id}:update-dialog`;
    }
    if (layer?.id) return layer.id;
    const semantic = [...dialog.classList].find((name) => name !== "dialog" && name.endsWith("-dialog"));
    return semantic ?? dialog.id ?? "application-dialog";
  }

  private title(dialog: HTMLElement): string {
    const titleId = dialog.getAttribute("aria-labelledby")?.split(/\s+/u)[0];
    const labelled = titleId ? this.document.getElementById(titleId) : null;
    return (labelled && dialog.contains(labelled) ? labelled.textContent : null)?.trim() ||
      dialog.querySelector<HTMLElement>("h1, h2, h3")?.textContent?.trim() || "";
  }

  private moveLabel(dialog: HTMLElement): string {
    const title = this.title(dialog);
    return title ? `${this.labels().move}: ${title}` : this.labels().move;
  }

  private resizeLabel(dialog: HTMLElement): string {
    const title = this.title(dialog);
    return title ? `${this.labels().resize}: ${title}` : this.labels().resize;
  }

  private visible(dialog: HTMLElement): boolean {
    if (!dialog.isConnected || dialog.closest(".hidden")) return false;
    if (dialog.tagName === "DIALOG" && !dialog.hasAttribute("open")) return false;
    const rect = dialog.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
}
