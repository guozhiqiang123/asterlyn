import { icon } from "../icons.ts";
import type { CollectionViewMode } from "./hierarchical-collection.ts";

export interface CollectionToolbarCommand {
  readonly id: string;
  readonly elementId?: string;
  readonly label: string;
  readonly title?: string;
  readonly icon: Parameters<typeof icon>[0];
  readonly iconSize?: number;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly active?: boolean;
  readonly separatorBefore?: boolean;
}

export interface CollectionToolbarState {
  readonly mode: CollectionViewMode;
  readonly ariaLabel: string;
  readonly className?: string;
  /** Host-owned summary/actions rendered before the standard collection controls. */
  readonly leadingHtml?: string;
  readonly commands: readonly CollectionToolbarCommand[];
}

export function renderHierarchicalCollectionToolbar(state: CollectionToolbarState): string {
  const className = state.className ? `hierarchical-collection-toolbar ${state.className}` : "hierarchical-collection-toolbar";
  return `<div class="${escapeHtml(className)}" role="toolbar" aria-label="${escapeHtml(state.ariaLabel)}" data-collection-mode="${state.mode}">${state.leadingHtml ?? ""}${state.commands.map(renderCommand).join("")}</div>`;
}

function renderCommand(command: CollectionToolbarCommand): string {
  const pressed = command.pressed === undefined ? "" : ` aria-pressed="${command.pressed}"`;
  const disabled = command.disabled ? " disabled" : "";
  const elementId = command.elementId ? ` id="${escapeHtml(command.elementId)}"` : "";
  const active = command.active ? " active" : "";
  const separator = command.separatorBefore ? '<span class="toolbar-separator" aria-hidden="true"></span>' : "";
  return `${separator}<button type="button" class="compact-icon-button hierarchical-collection-toolbar-command${active}"${elementId} data-collection-command="${escapeHtml(command.id)}" aria-label="${escapeHtml(command.label)}" title="${escapeHtml(command.title ?? command.label)}"${pressed}${disabled}>${icon(command.icon, command.iconSize ?? 14)}</button>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
