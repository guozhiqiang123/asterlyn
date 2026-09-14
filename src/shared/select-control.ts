import { icon } from "../icons.ts";

export function renderSelectControl(selectMarkup: string): string {
  return `<span class="select-control">${selectMarkup}<span class="select-control-chevron" aria-hidden="true">${icon("chevron-down", 12)}</span></span>`;
}
