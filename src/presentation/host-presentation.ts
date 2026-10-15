export type HostActionIntent = "recommended" | "neutral" | "destructive" | "quiet";
export type HostActionPlacement = "leading" | "trailing";

export interface HostAction {
  readonly id: string;
  readonly label: string;
  readonly intent: HostActionIntent;
  readonly placement?: HostActionPlacement;
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly defaultFocus?: boolean;
  readonly elementId?: string;
  readonly title?: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

export type HostPanelStateKind = "loading" | "empty" | "stale" | "error" | "permission-required";

export interface HostPanelState {
  readonly kind: HostPanelStateKind;
  readonly title: string;
  readonly detail?: string;
  readonly compact?: boolean;
  readonly actions?: readonly HostAction[];
  readonly attributes?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

export type HostInlineNoticeKind = "info" | "warning" | "error";

export interface HostInlineNotice {
  readonly kind: HostInlineNoticeKind;
  readonly title: string;
  readonly detail?: string;
  readonly loading?: boolean;
  readonly actions?: readonly HostAction[];
  readonly attributes?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

export interface HostDialog {
  readonly id: string;
  readonly title: string;
  /** Trusted host-rendered markup. Plugin contracts never receive this field. */
  readonly bodyHtml: string;
  readonly actions: readonly HostAction[];
  readonly role?: "dialog" | "alertdialog";
  readonly className?: string;
  readonly describedBy?: string;
  readonly includeBackdrop?: boolean;
}

export function renderHostAction(action: HostAction): string {
  validateAction(action);
  const baseClassName = action.intent === "recommended"
    ? "primary-button"
    : action.intent === "destructive"
      ? "danger-button"
      : action.intent === "quiet"
        ? "secondary-button host-action-quiet"
        : "secondary-button";
  const className = `${baseClassName}${action.compact ? " compact" : ""}`;
  const disabled = action.disabled ? " disabled" : "";
  const defaultFocus = action.defaultFocus ? " data-host-default-focus" : "";
  const elementId = action.elementId ? ` id="${escapeAttribute(action.elementId)}"` : "";
  const title = action.title ? ` title="${escapeAttribute(action.title)}"` : "";
  return `<button type="button" class="${className}" data-host-action="${escapeAttribute(action.id)}"${elementId}${title}${defaultFocus}${disabled}${renderAttributes(action.attributes)}>${escapeHtml(action.label)}</button>`;
}

export function renderHostPanelState(state: HostPanelState): string {
  validateActions(state.actions ?? []);
  const role = state.kind === "error" ? "alert" : "status";
  const live = state.kind === "loading" ? ' aria-live="polite"' : "";
  const compact = state.compact ? " compact" : "";
  const progress = state.kind === "loading" ? '<span class="host-state-spinner" aria-hidden="true"></span>' : "";
  const detail = state.detail ? `<p>${escapeHtml(state.detail)}</p>` : "";
  const actions = state.actions?.length
    ? `<div class="host-panel-state-actions">${state.actions.map(renderHostAction).join("")}</div>`
    : "";
  return `<div class="empty-state host-panel-state host-panel-state-${state.kind}${compact}" role="${role}"${live}${renderAttributes(state.attributes)}>${progress}<strong>${escapeHtml(state.title)}</strong>${detail}${actions}</div>`;
}

export function renderHostInlineNotice(notice: HostInlineNotice): string {
  validateActions(notice.actions ?? []);
  const role = notice.kind === "error" ? "alert" : "status";
  const live = notice.loading ? ' aria-live="polite"' : "";
  const progress = notice.loading ? '<span class="host-inline-notice-spinner" aria-hidden="true"></span>' : "";
  const detail = notice.detail ? `<small>${escapeHtml(notice.detail)}</small>` : "";
  const actions = notice.actions?.length
    ? `<div class="host-inline-notice-actions">${notice.actions.map(renderHostAction).join("")}</div>`
    : "";
  return `<div class="host-inline-notice host-inline-notice-${notice.kind}" role="${role}"${live}${renderAttributes(notice.attributes)}>${progress}<span class="host-inline-notice-copy"><strong>${escapeHtml(notice.title)}</strong>${detail}</span>${actions}</div>`;
}

export function renderHostDialog(dialog: HostDialog): string {
  validateStableId(dialog.id, "dialog");
  validateActions(dialog.actions);
  const role = dialog.role ?? "dialog";
  const titleId = `${dialog.id}-title`;
  const describedBy = dialog.describedBy ? ` aria-describedby="${escapeAttribute(dialog.describedBy)}"` : "";
  const className = dialog.className
    ? `dialog ${validatedClassNames(dialog.className)}`
    : "dialog";
  const body = `<section class="${escapeAttribute(className)}" role="${role}" aria-modal="true" aria-labelledby="${escapeAttribute(titleId)}"${describedBy}><div class="dialog-heading"><h2 id="${escapeAttribute(titleId)}">${escapeHtml(dialog.title)}</h2></div>${dialog.bodyHtml}${renderHostDialogActions(dialog.actions)}</section>`;
  return dialog.includeBackdrop === false ? body : `<div class="dialog-backdrop host-dialog-backdrop" role="presentation">${body}</div>`;
}

export function renderHostDialogActions(actions: readonly HostAction[]): string {
  validateActions(actions);
  const leading = actions.filter((action) => action.placement === "leading");
  const trailing = actions.filter((action) => action.placement !== "leading");
  let spacer = "";
  if (leading.length && trailing.length) spacer = '<span class="dialog-spacer"></span>';
  return `<div class="dialog-actions">${leading.map(renderHostAction).join("")}${spacer}${trailing.map(renderHostAction).join("")}</div>`;
}

function validateActions(actions: readonly HostAction[]): void {
  if (actions.filter((action) => action.intent === "recommended").length > 1) {
    throw new Error("A host action group may contain only one recommended action.");
  }
  for (const action of actions) validateAction(action);
}

function validateAction(action: HostAction): void {
  validateStableId(action.id, "action");
  if (!action.label.trim()) throw new Error("A host action label cannot be empty.");
}

function validateStableId(value: string, kind: string): void {
  if (!/^[a-z][a-z0-9.-]{0,127}$/u.test(value)) throw new Error(`Invalid host ${kind} ID: ${value}`);
}

function validatedClassNames(value: string): string {
  const names = value.trim().split(/\s+/u).filter(Boolean);
  if (names.some((name) => !/^[a-z][a-z0-9_-]{0,63}$/u.test(name))) {
    throw new Error(`Invalid host class name: ${value}`);
  }
  return names.join(" ");
}

function renderAttributes(attributes: Readonly<Record<string, string | number | boolean | null | undefined>> | undefined): string {
  if (!attributes) return "";
  return Object.entries(attributes).flatMap(([name, value]) => {
    if (!/^(?:aria|data)-[a-z0-9_.:-]+$/u.test(name) || value === null || value === undefined || value === false) return [];
    return value === true ? [` ${name}`] : [` ${name}="${escapeAttribute(String(value))}"`];
  }).join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}
