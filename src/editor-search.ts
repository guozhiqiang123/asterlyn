import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { type EditorView, type Panel, type ViewUpdate } from "@codemirror/view";

export type EditorSearchOption = "caseSensitive" | "wholeWord" | "regexp";
const MAXIMUM_SEARCH_FIELD_HEIGHT = 124;
const literalQueryMarker = () => true;
const newLineQueryMarker = () => true;

export function asterlynSearch(): Extension {
  return search({
    top: true,
    literal: true,
    createPanel: (view) => new AsterlynSearchPanel(view),
  });
}

export function toggleEditorSearchOption(
  query: SearchQuery,
  option: EditorSearchOption,
): SearchQuery {
  return editorSearchQuery(query, { [option]: !query[option] });
}

/** The New line control edits the query at the caret, like workspace search. */
export function insertEditorSearchLineBreak(
  query: SearchQuery,
  from: number,
  to: number,
): { query: SearchQuery; caret: number } {
  const caret = from + 1;
  return {
    query: editorSearchQuery(query, {
      search: `${query.search.slice(0, from)}\n${query.search.slice(to)}`,
    }),
    caret,
  };
}

function editorSearchQuery(
  query: SearchQuery,
  changes: Partial<{
    search: string;
    replace: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    regexp: boolean;
  }>,
): SearchQuery {
  const searchText = changes.search ?? query.search;
  const hasLineBreak = /[\r\n]/u.test(searchText);
  return new SearchQuery({
    search: searchText,
    replace: changes.replace ?? query.replace,
    caseSensitive: changes.caseSensitive ?? query.caseSensitive,
    wholeWord: changes.wholeWord ?? query.wholeWord,
    regexp: changes.regexp ?? query.regexp,
    literal: !hasLineBreak,
    test: hasLineBreak ? newLineQueryMarker : literalQueryMarker,
  });
}

class AsterlynSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private readonly view: EditorView;
  private readonly searchField: HTMLTextAreaElement;
  private readonly replaceField: HTMLInputElement | null;
  private readonly optionButtons = new Map<EditorSearchOption, HTMLButtonElement>();

  constructor(view: EditorView) {
    this.view = view;
    const query = getSearchQuery(view.state);
    this.dom = element("form", "asterlyn-search-panel cm-search");
    this.dom.addEventListener("submit", (event) => event.preventDefault());

    const searchShell = element("div", "asterlyn-search-input-shell");
    this.searchField = searchTextArea(view.state.phrase("Find"), query.search);
    this.searchField.setAttribute("main-field", "true");
    searchShell.append(this.searchField, this.options(query));
    this.dom.append(searchShell, this.navigationActions());

    this.replaceField = view.state.readOnly ? null : input(view.state.phrase("Replace"), query.replace);
    if (this.replaceField) this.dom.append(this.replacementRow(this.replaceField));
    this.bindFields();
  }

  mount(): void {
    this.syncSearchFieldHeight();
    this.searchField.select();
  }

  update(update: ViewUpdate): void {
    const query = getSearchQuery(update.state);
    if (this.searchField.value !== query.search) {
      this.searchField.value = query.search;
      this.syncSearchFieldHeight();
    }
    if (this.replaceField && this.replaceField.value !== query.replace) {
      this.replaceField.value = query.replace;
    }
    this.syncOptions(query);
  }

  private options(query: SearchQuery): HTMLElement {
    const strip = element("span", "asterlyn-search-option-strip");
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", this.view.state.phrase("search options"));
    const newLine = action("↵", this.view.state.phrase("new line"));
    newLine.dataset.searchInsert = "new-line";
    newLine.addEventListener("click", () => this.insertLineBreak());
    strip.append(newLine);
    const definitions: Array<[EditorSearchOption, string, string]> = [
      ["caseSensitive", "Cc", this.view.state.phrase("match case")],
      ["wholeWord", "W", this.view.state.phrase("by word")],
      ["regexp", ".*", this.view.state.phrase("regexp")],
    ];
    for (const [option, label, title] of definitions) {
      const button = action(label, title);
      button.dataset.searchOption = option;
      button.addEventListener("click", () => this.setQuery(toggleEditorSearchOption(getSearchQuery(this.view.state), option)));
      this.optionButtons.set(option, button);
      strip.append(button);
    }
    this.syncOptions(query);
    return strip;
  }

  private navigationActions(): HTMLElement {
    const actions = element("span", "asterlyn-search-actions");
    const previous = action("↑", this.view.state.phrase("previous"));
    previous.addEventListener("click", () => findPrevious(this.view));
    const next = action("↓", this.view.state.phrase("next"));
    next.addEventListener("click", () => findNext(this.view));
    const all = action(this.view.state.phrase("all"), this.view.state.phrase("all"));
    all.addEventListener("click", () => selectMatches(this.view));
    const close = action("×", this.view.state.phrase("close"));
    close.addEventListener("click", () => closeSearchPanel(this.view));
    actions.append(previous, next, all, close);
    return actions;
  }

  private replacementRow(field: HTMLInputElement): HTMLElement {
    const row = element("div", "asterlyn-search-replace-row");
    const shell = element("div", "asterlyn-search-replace-shell");
    shell.append(field);
    const replace = action(this.view.state.phrase("replace"), this.view.state.phrase("replace"));
    replace.addEventListener("click", () => replaceNext(this.view));
    const all = action(this.view.state.phrase("replace all"), this.view.state.phrase("replace all"));
    all.addEventListener("click", () => replaceAll(this.view));
    row.append(shell, replace, all);
    return row;
  }

  private bindFields(): void {
    this.searchField.addEventListener("input", () => {
      this.setQuery(editorSearchQuery(getSearchQuery(this.view.state), { search: this.searchField.value }));
      this.syncSearchFieldHeight();
    });
    this.searchField.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        (event.shiftKey ? findPrevious : findNext)(this.view);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSearchPanel(this.view);
      }
    });
    this.replaceField?.addEventListener("input", () => {
      this.setQuery(editorSearchQuery(getSearchQuery(this.view.state), { replace: this.replaceField?.value ?? "" }));
    });
  }

  private setQuery(query: SearchQuery): void {
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private insertLineBreak(): void {
    const from = this.searchField.selectionStart ?? this.searchField.value.length;
    const to = this.searchField.selectionEnd ?? from;
    const result = insertEditorSearchLineBreak(getSearchQuery(this.view.state), from, to);
    this.searchField.value = result.query.search;
    this.searchField.focus();
    this.searchField.setSelectionRange(result.caret, result.caret);
    this.syncSearchFieldHeight();
    this.setQuery(result.query);
  }

  private syncSearchFieldHeight(): void {
    this.searchField.style.height = "auto";
    const height = Math.min(this.searchField.scrollHeight, MAXIMUM_SEARCH_FIELD_HEIGHT);
    this.searchField.style.height = `${height}px`;
    this.searchField.style.overflowY = this.searchField.scrollHeight > height ? "auto" : "hidden";
  }

  private syncOptions(query: SearchQuery): void {
    const active: Record<EditorSearchOption, boolean> = {
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
    };
    for (const [option, button] of this.optionButtons) {
      button.setAttribute("aria-pressed", String(active[option]));
    }
  }
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function input(label: string, value: string): HTMLInputElement {
  const field = document.createElement("input");
  field.type = "text";
  field.value = value;
  field.placeholder = label;
  field.setAttribute("aria-label", label);
  field.autocomplete = "off";
  field.spellcheck = false;
  return field;
}

function searchTextArea(label: string, value: string): HTMLTextAreaElement {
  const field = document.createElement("textarea");
  field.value = value;
  field.rows = 1;
  field.placeholder = label;
  field.setAttribute("aria-label", label);
  field.autocomplete = "off";
  field.spellcheck = false;
  return field;
}

function action(label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  return button;
}
