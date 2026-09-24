/**
 * The command-surface query field is a multi-line textarea so the in-field line-break control can put
 * a real line break into the query. Every other key keeps its existing meaning: Enter still searches
 * or opens the selected result, and Escape still closes the surface.
 */
const QUERY_INPUT_ID = "command-surface-input";
const MAXIMUM_QUERY_HEIGHT = 124;

export function commandSurfaceQueryInput(root: ParentNode): HTMLTextAreaElement | null {
  return root.querySelector<HTMLTextAreaElement>(`#${QUERY_INPUT_ID}`);
}

export function focusCommandSurfaceQuery(root: ParentNode): void {
  queueMicrotask(() => {
    const input = commandSurfaceQueryInput(root);
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    syncCommandSurfaceQueryHeight(root);
  });
}

/** A search rerender keeps the active field and caret instead of moving text edits to the end. */
export function renderCommandSurfacePreservingFocus(root: HTMLElement, render: () => void): void {
  const host = root.querySelector<HTMLElement>("#command-surface");
  const active = document.activeElement;
  const focusId = active instanceof HTMLElement && host?.contains(active) ? active.id : "";
  const selection = active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type === "text")
    ? [active.selectionStart, active.selectionEnd] as const
    : null;
  render();
  if (!focusId) return;
  queueMicrotask(() => {
    const target = root.querySelector<HTMLElement>(`#${focusId}`);
    target?.focus({ preventScroll: true });
    if (
      selection && selection[0] !== null && selection[1] !== null &&
      (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)
    ) {
      target.setSelectionRange(selection[0], selection[1]);
    }
  });
}

/** The field grows with its own text so an inserted line break stays visible. */
export function syncCommandSurfaceQueryHeight(root: ParentNode): void {
  const input = commandSurfaceQueryInput(root);
  if (!input) return;
  input.style.height = "auto";
  const height = Math.min(input.scrollHeight, MAXIMUM_QUERY_HEIGHT);
  input.style.height = `${height}px`;
  input.style.overflowY = input.scrollHeight > height ? "auto" : "hidden";
}

export function bindCommandSurfaceLineBreak(root: HTMLElement): void {
  syncCommandSurfaceQueryHeight(root);
  commandSurfaceQueryInput(root)?.addEventListener("input", () => syncCommandSurfaceQueryHeight(root));
  root
    .querySelector<HTMLButtonElement>('[data-search-insert="new-line"]')
    ?.addEventListener("click", () => insertQueryLineBreak(root));
}

function insertQueryLineBreak(root: ParentNode): void {
  const input = commandSurfaceQueryInput(root);
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const caret = start + 1;
  input.value = `${input.value.slice(0, start)}\n${input.value.slice(end)}`;
  input.setSelectionRange(caret, caret);
  // Reuse the surface's own input path so request invalidation and rerendering stay in one place.
  input.dispatchEvent(new Event("input", { bubbles: true }));
  queueMicrotask(() => {
    const field = commandSurfaceQueryInput(root);
    field?.focus();
    field?.setSelectionRange(caret, caret);
    syncCommandSurfaceQueryHeight(root);
  });
}
