import type { IDisposable, ITheme, Terminal as XtermTerminal } from "@xterm/xterm";
import type { FitAddon as XtermFitAddon } from "@xterm/addon-fit";

export interface TerminalViewActions {
  readonly ready: (cols: number, rows: number) => void;
  readonly input: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly failure: (error: unknown) => void;
}

export class TerminalView {
  private parent: HTMLElement | null = null;
  private terminal: XtermTerminal | null = null;
  private fitAddon: XtermFitAddon | null = null;
  private inputDisposable: IDisposable | null = null;
  private observer: ResizeObserver | null = null;
  private windowResize: (() => void) | null = null;
  private fitFrame: number | null = null;
  private generation = 0;
  private ready = false;
  private actions: TerminalViewActions | null = null;

  mount(parent: HTMLElement, actions: TerminalViewActions): void {
    this.actions = actions;
    if (this.terminal && this.parent === parent) {
      this.requestFit();
      return;
    }
    if (this.parent === parent && !this.terminal) return;
    this.disposeRuntime();
    this.parent = parent;
    const generation = ++this.generation;
    parent.setAttribute("aria-busy", "true");
    void import("./lazy-terminal-runtime.ts")
      .then(({ loadTerminalRuntime }) => loadTerminalRuntime())
      .then(({ Terminal, FitAddon }) => {
        if (generation !== this.generation || !parent.isConnected) return;
        const terminal = new Terminal({
          allowProposedApi: false,
          allowTransparency: false,
          cursorBlink: true,
          cursorInactiveStyle: "outline",
          fontFamily: editorFontFamily(),
          fontSize: 13,
          letterSpacing: 0,
          lineHeight: 1.2,
          minimumContrastRatio: 4.5,
          rightClickSelectsWord: true,
          screenReaderMode: true,
          scrollback: 5_000,
          theme: terminalTheme(),
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        parent.replaceChildren();
        terminal.open(parent);
        parent.removeAttribute("aria-busy");
        this.terminal = terminal;
        this.fitAddon = fitAddon;
        this.inputDisposable = terminal.onData((data) => this.actions?.input(data));
        if (typeof ResizeObserver === "function") {
          this.observer = new ResizeObserver(() => this.requestFit());
          this.observer.observe(parent);
        } else {
          this.windowResize = () => this.requestFit();
          window.addEventListener("resize", this.windowResize);
        }
        this.requestFit();
      })
      .catch((error) => {
        if (generation !== this.generation) return;
        parent.removeAttribute("aria-busy");
        this.parent = null;
        this.actions?.failure(error);
      });
  }

  reveal(): void {
    this.requestFit();
    this.terminal?.focus();
  }

  dimensions(): { cols: number; rows: number } | null {
    if (!this.terminal || this.terminal.cols < 2 || this.terminal.rows < 2) return null;
    return { cols: this.terminal.cols, rows: this.terminal.rows };
  }

  write(bytes: Uint8Array): void {
    this.terminal?.write(bytes);
  }

  clear(): void {
    this.terminal?.clear();
  }

  reset(): void {
    this.terminal?.reset();
    this.terminal?.clear();
    this.ready = false;
  }

  refreshAppearance(): void {
    if (!this.terminal) return;
    this.terminal.options.fontFamily = editorFontFamily();
    this.terminal.options.theme = terminalTheme();
    this.requestFit();
  }

  dispose(): void {
    this.generation += 1;
    this.disposeRuntime();
    this.parent = null;
    this.actions = null;
  }

  private requestFit(): void {
    if (!this.parent || this.parent.classList.contains("hidden") || this.parent.clientWidth < 20 || this.parent.clientHeight < 20) {
      return;
    }
    if (this.fitFrame !== null) return;
    this.fitFrame = window.requestAnimationFrame(() => {
      this.fitFrame = null;
      if (!this.fitAddon || !this.terminal || !this.parent || this.parent.classList.contains("hidden")) return;
      try {
        this.fitAddon.fit();
        const { cols, rows } = this.terminal;
        if (cols < 2 || rows < 2) return;
        if (!this.ready) {
          this.ready = true;
          this.actions?.ready(cols, rows);
        } else {
          this.actions?.resize(cols, rows);
        }
      } catch (error) {
        this.actions?.failure(error);
      }
    });
  }

  private disposeRuntime(): void {
    if (this.fitFrame !== null) window.cancelAnimationFrame(this.fitFrame);
    this.fitFrame = null;
    this.observer?.disconnect();
    this.observer = null;
    if (this.windowResize) window.removeEventListener("resize", this.windowResize);
    this.windowResize = null;
    this.inputDisposable?.dispose();
    this.inputDisposable = null;
    this.fitAddon?.dispose();
    this.fitAddon = null;
    this.terminal?.dispose();
    this.terminal = null;
    this.ready = false;
  }
}

function editorFontFamily(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--editor-font-family").trim() ||
    '"JetBrains Mono Variable", "JetBrains Mono", monospace';
}

function terminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: color("--surface-inset", "#18191c"),
    foreground: color("--text", "#dfe1e5"),
    cursor: color("--editor-caret", "#a8c7fa"),
    cursorAccent: color("--surface-inset", "#18191c"),
    selectionBackground: color("--editor-selection", "#214283"),
    black: color("--surface-inset-strong", "#17181b"),
    red: color("--red", "#db5c5c"),
    green: color("--green", "#59a869"),
    yellow: color("--yellow", "#d6ae58"),
    blue: color("--file-modified", "#75a7e8"),
    magenta: "#b78bd8",
    cyan: color("--file-renamed", "#52b7c7"),
    white: color("--text", "#dfe1e5"),
    brightBlack: color("--text-faint", "#6f737b"),
    brightRed: color("--danger-text", "#f0a5a5"),
    brightGreen: color("--success-text", "#9bd7a8"),
    brightYellow: color("--warning-text", "#efc77c"),
    brightBlue: color("--info-text", "#a8c7fa"),
    brightMagenta: "#d7a8f0",
    brightCyan: color("--file-renamed", "#52b7c7"),
    brightWhite: color("--text-bright", "#d8dee9"),
  };
}
