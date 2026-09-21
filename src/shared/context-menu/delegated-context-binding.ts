import type { ContextMenuAnchor } from "./context-menu-model.ts";

export interface DelegatedContextRequest<TTarget> {
  readonly target: TTarget;
  readonly anchor: ContextMenuAnchor;
  readonly trigger: HTMLElement;
  restoreFocus(): void;
}

export interface DelegatedContextBindingOptions<TTarget> {
  readonly selector: string;
  /** Matching subtrees never open this binding's menu, even when nested inside a trigger. */
  readonly exclude?: string;
  resolve(trigger: HTMLElement): TTarget | null;
  open(request: DelegatedContextRequest<TTarget>): boolean;
  restoreFocus?(target: TTarget, previous: HTMLElement): void;
}

export function isDelegatedContextKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

export function delegatedContextKeyboardAnchor(
  rectangle: Pick<DOMRect, "left" | "top" | "width" | "height">,
): ContextMenuAnchor {
  return {
    x: rectangle.left + Math.min(16, rectangle.width / 2),
    y: rectangle.top + Math.min(rectangle.height, 24),
  };
}

/** One listener pair survives feature rerenders; target identity is resolved at activation time. */
export class DelegatedContextBinding<TTarget> {
  private readonly root: HTMLElement;
  private readonly options: DelegatedContextBindingOptions<TTarget>;
  private disposed = false;

  constructor(root: HTMLElement, options: DelegatedContextBindingOptions<TTarget>) {
    this.root = root;
    this.options = options;
    root.addEventListener("contextmenu", this.handleContextMenu);
    root.addEventListener("keydown", this.handleKeydown);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeEventListener("contextmenu", this.handleContextMenu);
    this.root.removeEventListener("keydown", this.handleKeydown);
  }

  private readonly handleContextMenu = (event: MouseEvent): void => {
    this.activate(event, { x: event.clientX, y: event.clientY });
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (!isDelegatedContextKey(event)) return;
    const trigger = this.triggerFor(event.target);
    if (!trigger) return;
    this.activate(event, delegatedContextKeyboardAnchor(trigger.getBoundingClientRect()), trigger);
  };

  private activate(
    event: MouseEvent | KeyboardEvent,
    anchor: ContextMenuAnchor,
    knownTrigger?: HTMLElement,
  ): void {
    if (this.disposed) return;
    const trigger = knownTrigger ?? this.triggerFor(event.target);
    if (!trigger) return;
    const target = this.options.resolve(trigger);
    if (!target) return;
    const handled = this.options.open({
      target,
      anchor,
      trigger,
      restoreFocus: () => {
        if (this.disposed) return;
        if (this.options.restoreFocus) this.options.restoreFocus(target, trigger);
        else if (trigger.isConnected) trigger.focus();
        else this.root.focus();
      },
    });
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  }

  private triggerFor(eventTarget: EventTarget | null): HTMLElement | null {
    const element = eventTarget instanceof Element
      ? eventTarget
      : eventTarget instanceof Node
        ? eventTarget.parentElement
        : null;
    if (this.options.exclude && element?.closest(this.options.exclude)) return null;
    const trigger = element?.closest<HTMLElement>(this.options.selector) ?? null;
    return trigger && this.root.contains(trigger) ? trigger : null;
  }
}
