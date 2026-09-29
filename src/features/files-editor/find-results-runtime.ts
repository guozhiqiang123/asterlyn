import type { LocaleCatalog } from "../../localization/catalog.ts";
import type { ProjectFile, WorkspaceTextSearchMatch, WorkspaceTextSearchReport } from "../../models.ts";
import type { NavigationMode } from "./navigation.ts";
import { FindResultsController } from "./find-results-controller.ts";
import { renderFindHeaderActions, renderFindResults } from "./find-results-view.ts";

interface FindResultsSource {
  readonly mode: NavigationMode | null;
  readonly repositoryRoot: string | null;
  readonly query: string;
  readonly files: readonly ProjectFile[];
  readonly searchRepositoryRoot: string | null;
  readonly report: WorkspaceTextSearchReport | null;
  readonly searchCurrent: boolean;
}

export interface FindResultsRuntimeOptions {
  readonly copy: () => LocaleCatalog;
  readonly source: () => FindResultsSource;
  readonly activeRepositoryRoot: () => string | null;
  readonly activeFilePath: () => string | null;
  readonly locateCurrentFile: () => void;
  readonly openSearch: () => void;
  readonly openPanel: () => void;
  readonly openFile: (repositoryRoot: string, file: ProjectFile) => Promise<void>;
  readonly openMatch: (repositoryRoot: string, match: WorkspaceTextSearchMatch) => Promise<void>;
  readonly wrongWorkspace: () => void;
}

export class FindResultsRuntime {
  private readonly controller = new FindResultsController();

  constructor(
    private readonly root: HTMLElement,
    private readonly options: FindResultsRuntimeOptions,
  ) {}

  bindCommandSurface(): void {
    this.root.querySelector<HTMLButtonElement>("#command-surface-open-find")
      ?.addEventListener("click", () => this.openFromSearch());
  }

  clear(): void {
    this.controller.clear();
  }

  render(): void {
    const host = this.query<HTMLElement>("#find-tool-host");
    host.innerHTML = renderFindResults(this.controller.state, this.options.copy());
    this.renderHeaderActions();
    this.bindResults(host);
  }

  private openFromSearch(): void {
    const source = this.options.source();
    const { mode, repositoryRoot } = source;
    let installed = false;
    if (repositoryRoot && (mode === "files" || mode === "recent")) {
      installed = this.controller.installFiles(mode, repositoryRoot, source.query, source.files);
    } else if (
      repositoryRoot && mode === "workspace" && source.searchRepositoryRoot === repositoryRoot &&
      source.report && source.searchCurrent
    ) {
      installed = this.controller.install(repositoryRoot, source.query, source.report);
    }
    if (!installed) return;
    this.options.openPanel();
    queueMicrotask(() => this.focusSelection());
  }

  private renderHeaderActions(): void {
    const actions = this.query<HTMLElement>("#terminal-header-actions");
    const html = renderFindHeaderActions(
      this.controller.state,
      this.options.copy(),
      this.options.activeFilePath(),
    );
    actions.innerHTML = html;
    actions.classList.toggle("hidden", html.length === 0);
    if (actions.dataset.findBound === "true") return;
    actions.dataset.findBound = "true";
    actions.addEventListener("click", (event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-find-action]");
      if (!button || !actions.contains(button)) return;
      this.activateHeaderAction(button.dataset.findAction ?? "");
    });
  }

  private activateHeaderAction(action: string): void {
    if (action === "locate") {
      this.options.locateCurrentFile();
      return;
    }
    if (action === "view" && this.controller.toggleFileView()) {
      this.renderAndReveal(this.controller.state.fileSelection?.path ?? null);
      return;
    }
    if ((action === "expand" || action === "collapse") &&
      this.controller.setSelectedSubtreeExpanded(action === "expand")) {
      this.renderAndReveal(this.controller.state.fileSelection?.path ?? null);
    }
  }

  private bindResults(host: HTMLElement): void {
    host.querySelector<HTMLButtonElement>("[data-find-search]")
      ?.addEventListener("click", this.options.openSearch);
    host.querySelectorAll<HTMLButtonElement>("[data-find-result]").forEach((button) => {
      button.addEventListener("mousemove", () => this.selectText(button, false));
      button.addEventListener("click", () => {
        this.selectText(button, false);
        void this.openSelected();
      });
    });
    host.querySelectorAll<HTMLButtonElement>("[data-find-path]").forEach((button) => {
      button.addEventListener("mousemove", () => this.selectFile(button, false));
      button.addEventListener("click", () => {
        this.selectFile(button, false);
        if (button.dataset.findKind === "directory") {
          if (this.controller.toggleDirectory(button.dataset.findPath ?? "")) {
            this.renderAndReveal(button.dataset.findPath ?? null);
          }
        } else {
          void this.openSelected();
        }
      });
    });
    host.querySelector<HTMLElement>(".find-results-list")?.addEventListener("keydown", (event) => {
      if (this.controller.state.snapshot?.kind === "workspace") this.handleTextKey(event);
      else this.handleFileKey(event);
    });
  }

  private handleTextKey(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const previous = this.controller.state.selectedIndex;
    if (this.controller.move(event.key === "ArrowDown" ? 1 : -1)) this.syncTextSelection(previous, true);
  }

  private handleFileKey(event: KeyboardEvent): void {
    const list = event.currentTarget as HTMLElement;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>("[data-find-path]"));
    const selected = rows.findIndex((row) => row.classList.contains("selected"));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const base = selected >= 0 ? selected : event.key === "ArrowDown" ? -1 : 0;
      const next = (base + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      const row = rows[next];
      if (row) this.selectFile(row, true);
      return;
    }
    const row = rows[selected];
    if (!row) return;
    if (event.key === "Enter") {
      event.preventDefault();
      row.click();
      return;
    }
    if (row.dataset.findKind !== "directory" || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    const expanded = row.getAttribute("aria-expanded") === "true";
    if ((event.key === "ArrowRight" && !expanded) || (event.key === "ArrowLeft" && expanded)) {
      event.preventDefault();
      if (this.controller.toggleDirectory(row.dataset.findPath ?? "")) {
        this.renderAndReveal(row.dataset.findPath ?? null);
      }
    }
  }

  private selectText(button: HTMLButtonElement, reveal: boolean): void {
    const previous = this.controller.state.selectedIndex;
    if (this.controller.select(Number(button.dataset.findResult))) this.syncTextSelection(previous, reveal);
  }

  private syncTextSelection(previous: number, reveal: boolean): void {
    const selected = this.controller.state.selectedIndex;
    const previousRow = this.root.querySelector<HTMLElement>(`#find-result-${previous}`);
    const selectedRow = this.root.querySelector<HTMLElement>(`#find-result-${selected}`);
    syncRowSelection(previousRow, selectedRow, this.root.querySelector(".find-results-list"));
    if (reveal) revealAndFocus(selectedRow);
  }

  private selectFile(button: HTMLButtonElement, reveal: boolean): void {
    const previous = this.controller.state.fileSelection?.path ?? null;
    const kind = button.dataset.findKind === "directory" ? "directory" : "file";
    if (!this.controller.selectFile(button.dataset.findPath ?? "", kind)) return;
    const previousRow = this.fileRow(previous);
    syncRowSelection(previousRow, button, this.root.querySelector(".find-results-list"));
    this.renderHeaderActions();
    if (reveal) revealAndFocus(button);
  }

  private renderAndReveal(path: string | null): void {
    const current = this.root.querySelector<HTMLElement>(".find-results-list");
    const scroll = [current?.scrollTop ?? 0, current?.scrollLeft ?? 0] as const;
    this.render();
    const next = this.root.querySelector<HTMLElement>(".find-results-list");
    if (next) [next.scrollTop, next.scrollLeft] = scroll;
    queueMicrotask(() => revealAndFocus(this.fileRow(path)));
  }

  private focusSelection(): void {
    const state = this.controller.state;
    const target = state.snapshot?.kind === "workspace"
      ? this.root.querySelector<HTMLElement>(`#find-result-${state.selectedIndex}`)
      : this.fileRow(state.fileSelection?.path ?? null);
    revealAndFocus(target);
  }

  private fileRow(path: string | null): HTMLButtonElement | null {
    if (!path) return null;
    return Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-find-path]"))
      .find((row) => row.dataset.findPath === path) ?? null;
  }

  private async openSelected(): Promise<void> {
    const snapshot = this.controller.state.snapshot;
    if (!snapshot || this.options.activeRepositoryRoot() !== snapshot.repositoryRoot) {
      this.options.wrongWorkspace();
      return;
    }
    if (snapshot.kind === "workspace") {
      const match = this.controller.selectedMatch();
      if (match) await this.options.openMatch(snapshot.repositoryRoot, match);
      return;
    }
    const file = this.controller.selectedFile();
    if (file) await this.options.openFile(snapshot.repositoryRoot, file);
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Find results element: ${selector}`);
    return element;
  }
}

function syncRowSelection(
  previous: HTMLElement | null,
  selected: HTMLElement | null,
  list: Element | null,
): void {
  if (previous !== selected) {
    previous?.classList.remove("selected");
    previous?.setAttribute("aria-selected", "false");
  }
  selected?.classList.add("selected");
  selected?.setAttribute("aria-selected", "true");
  list?.setAttribute("aria-activedescendant", selected?.id ?? "");
}

function revealAndFocus(row: HTMLElement | null): void {
  row?.scrollIntoView({ block: "nearest" });
  row?.focus();
}
