import { icon } from "../../../icons.ts";
import type { DiffLayout } from "../../../diff-presentation.ts";
import type { DiffReviewCapabilities } from "./diff-review-model.ts";

export type DiffReviewToolbarNamespace = "editor" | "push";

export interface DiffReviewToolbarCopy {
  readonly toolbar: string;
  readonly navigation: string;
  readonly previousBlock: string;
  readonly nextBlock: string;
  readonly previousFile: string;
  readonly nextFile: string;
  readonly openSource: string;
  readonly collapseUnchanged: string;
  readonly expandUnchanged: string;
  readonly presentation: string;
  readonly unified: string;
  readonly unifiedTitle: string;
  readonly split: string;
  readonly splitTitle: string;
  readonly whitespace: string;
  readonly whitespaceTitle: string;
}

export interface DiffReviewToolbarViewModel {
  readonly namespace: DiffReviewToolbarNamespace;
  readonly capabilities: DiffReviewCapabilities;
  readonly ready: boolean;
  readonly image?: boolean;
  readonly layoutLocked?: boolean;
  readonly layout?: DiffLayout;
  readonly showWhitespace?: boolean;
  readonly expandedUnchanged?: boolean;
  readonly previousFileAvailable?: boolean;
  readonly nextFileAvailable?: boolean;
  readonly sourceAvailable?: boolean;
  readonly summary?: string | null;
  readonly className?: string;
  readonly copy: DiffReviewToolbarCopy;
}

export function renderDiffReviewToolbar(model: DiffReviewToolbarViewModel): string {
  const action = model.namespace === "push" ? "data-push-diff-action" : "data-diff-action";
  const layout = model.namespace === "push" ? "data-push-diff-layout" : "data-diff-layout";
  const whitespace = model.namespace === "push" ? "data-push-diff-whitespace" : "data-diff-whitespace";
  const copy = model.copy;
  const expanded = model.expandedUnchanged ?? false;
  const unchanged = expanded ? copy.collapseUnchanged : copy.expandUnchanged;
  const navigation = [
    model.capabilities.navigateBlocks
      ? iconButton(action, "previous-change", "up", copy.previousBlock, model.ready)
      : "",
    model.capabilities.navigateBlocks
      ? iconButton(action, "next-change", "down", copy.nextBlock, model.ready)
      : "",
    model.capabilities.navigateFiles ? '<span class="diff-control-separator" aria-hidden="true"></span>' : "",
    model.capabilities.navigateFiles
      ? iconButton(action, "previous-file", "back", copy.previousFile, model.previousFileAvailable ?? false)
      : "",
    model.capabilities.navigateFiles
      ? iconButton(action, "next-file", "forward", copy.nextFile, model.nextFileAvailable ?? false)
      : "",
    model.capabilities.openSource
      ? iconButton(action, "open-source", "locate", copy.openSource, model.sourceAvailable ?? false)
      : "",
    model.capabilities.toggleUnchanged
      ? `<button class="compact-icon-button ${expanded ? "active" : ""}" type="button" ${action}="toggle-unchanged" aria-label="${escapeAttribute(unchanged)}" title="${escapeAttribute(unchanged)}" aria-pressed="${expanded}" ${model.ready ? "" : "disabled"}>${icon(expanded ? "collapse" : "expand", 15)}</button>`
      : "",
  ].join("");
  const presentation = !model.image && (
    model.capabilities.toggleLayout || model.capabilities.toggleWhitespace
  ) ? `<div class="diff-controls" role="group" aria-label="${escapeAttribute(copy.presentation)}">
      ${model.capabilities.toggleLayout ? `<button type="button" ${layout}="unified" aria-pressed="${model.layout === "unified"}" title="${escapeAttribute(copy.unifiedTitle)}" ${model.layoutLocked ? "disabled" : ""}>${escapeHtml(copy.unified)}</button>
      <button type="button" ${layout}="split" aria-pressed="${model.layout === "split"}" title="${escapeAttribute(copy.splitTitle)}" ${model.layoutLocked ? "disabled" : ""}>${escapeHtml(copy.split)}</button>` : ""}
      ${model.capabilities.toggleWhitespace ? `<button type="button" ${whitespace} aria-pressed="${model.showWhitespace ?? false}" title="${escapeAttribute(copy.whitespaceTitle)}">${escapeHtml(copy.whitespace)}</button>` : ""}
    </div>` : "";
  return `<div class="diff-toolbar diff-review-toolbar ${escapeAttribute(model.className ?? "")}" aria-label="${escapeAttribute(copy.toolbar)}">
    <div class="diff-navigation-controls" role="group" aria-label="${escapeAttribute(copy.navigation)}">${navigation}</div>
    ${model.summary ? `<span class="diff-review-summary" role="status">${escapeHtml(model.summary)}</span>` : ""}
    ${presentation}
  </div>`;
}

function iconButton(
  attribute: string,
  action: string,
  iconName: "up" | "down" | "back" | "forward" | "locate",
  label: string,
  enabled: boolean,
): string {
  return `<button class="compact-icon-button" type="button" ${attribute}="${action}" aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}" ${enabled ? "" : "disabled"}>${icon(iconName, 15)}</button>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

