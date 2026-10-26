import type { EditorLanguageServiceLocation } from "../../protocol/editor-language-service.ts";
import type { LanguageServiceCopy } from "../../localization/language-service-copy.ts";

let nextId = 0;
/** Read-only location choices; constructing/filtering this UI never reads files or starts LSP. */
export class LanguageLocationPicker {
  private release: (() => void) | null = null;
  close(restoreFocus = true): void { const release = this.release; this.release = null; release?.(); if (restoreFocus) this.restore?.(); this.restore = null; }
  private restore: (() => void) | null = null;
  open(document: Document, anchor: { x: number; y: number }, locations: readonly EditorLanguageServiceLocation[], options: {
    title: string; limited: boolean; copy: LanguageServiceCopy; current(): boolean;
    select(location: EditorLanguageServiceLocation): void; dismissed(): void; restoreFocus(): void;
  }): void {
    this.close(false); if (!options.current()) { options.dismissed(); return; }
    const window = document.defaultView!, controller = new AbortController(), id = `language-locations-${++nextId}`;
    const root = document.createElement("section"); root.className = "language-location-picker";
    root.setAttribute("role", "dialog"); root.setAttribute("aria-label", options.title);
    const title = document.createElement("strong"), input = document.createElement("input"), list = document.createElement("div"), status = document.createElement("div");
    title.textContent = `${options.title} (${locations.length}${options.limited ? "+" : ""})`;
    input.type = "search"; input.placeholder = options.copy.filterLocations; input.setAttribute("aria-label", options.copy.filterLocations);
    input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "true"); input.setAttribute("aria-controls", id);
    list.id = id; list.className = "language-location-results"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", options.title);
    status.setAttribute("role", "status"); root.append(title, input, list, status);
    const choices = locations.map((location) => ({ location, path: decodeURIComponent(new URL(location.uri).pathname) }));
    let filtered = choices, selected = 0, buttons: HTMLButtonElement[] = [];
    const choose = (index: number) => { const choice = filtered[index]; if (!choice || !options.current()) { this.close(); return; } this.close(); if (options.current()) options.select(choice.location); };
    const highlight = () => { buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === selected))); const button = buttons[selected]; if (button) { input.setAttribute("aria-activedescendant", button.id); button.scrollIntoView({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant"); };
    const render = () => {
      const query = input.value.toLocaleLowerCase(); filtered = choices.filter((choice) => choice.path.toLocaleLowerCase().includes(query)); selected = 0;
      const fragment = document.createDocumentFragment(); buttons = [];
      for (const [index, choice] of filtered.entries()) {
        const button = document.createElement("button"), name = document.createElement("span"), path = document.createElement("small");
        button.type = "button"; button.tabIndex = -1; button.id = `${id}-${index}`; button.setAttribute("role", "option");
        name.textContent = `${choice.path.split("/").at(-1)?.slice(0, 128)}:${choice.location.range.start.line + 1}:${choice.location.range.start.character + 1}`;
        path.textContent = choice.path.slice(-260); button.append(name, path); button.addEventListener("click", () => choose(index));
        button.addEventListener("pointermove", () => { if (selected !== index) { selected = index; highlight(); } }); buttons.push(button); fragment.append(button);
      }
      list.replaceChildren(fragment); status.textContent = !filtered.length ? options.copy.noMatchingLocations : options.limited ? options.copy.limitedLocations.replace("{count}", String(locations.length)) : "";
      highlight();
    };
    this.release = () => { controller.abort(); root.remove(); options.dismissed(); };
    this.restore = options.restoreFocus;
    input.addEventListener("input", render);
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(); return; }
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); choose(selected); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); selected = !filtered.length ? 0 : event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : (selected + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length; highlight();
      }
      if (event.key === "Tab") this.close();
    });
    document.addEventListener("pointerdown", (event) => { if (!root.contains(event.target as Node)) this.close(false); }, { capture: true, signal: controller.signal });
    window.addEventListener("blur", () => this.close(false), { signal: controller.signal });
    window.addEventListener("resize", () => this.close(), { signal: controller.signal });
    root.style.left = "12px"; root.style.top = "12px"; document.body.append(root); render();
    const bounds = root.getBoundingClientRect(); root.style.left = `${Math.max(12, Math.min(anchor.x, window.innerWidth - bounds.width - 12))}px`; root.style.top = `${Math.max(12, Math.min(anchor.y, window.innerHeight - bounds.height - 12))}px`;
    input.focus();
  }
}
