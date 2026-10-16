export const MAX_TERMINAL_TABS = 12;
export const MAX_TERMINAL_SHELL_TABS = 8;

export type TerminalTabKind = "shell" | "task";

export interface TerminalTabRecord {
  readonly id: string;
  readonly kind: TerminalTabKind;
  readonly title: string;
  readonly taskSessionId: string | null;
  readonly taskTerminal: boolean;
  readonly ordinal: number;
}

export type TerminalTabLimit = "shell-limit" | "tab-limit";

export type TerminalTabCreateResult =
  | { readonly ok: true; readonly tab: TerminalTabRecord; readonly evictedId: string | null }
  | { readonly ok: false; readonly reason: TerminalTabLimit };

export interface TerminalTabCloseResult {
  readonly closed: TerminalTabRecord | null;
  readonly selectedId: string | null;
}

/** Pure bounded ordering/selection model; process and xterm resources stay in TerminalPanel. */
export class TerminalTabs {
  private records: TerminalTabRecord[] = [];
  private selected: string | null = null;
  private sequence = 0;

  get tabs(): readonly TerminalTabRecord[] { return this.records; }
  get selectedId(): string | null { return this.selected; }

  createShell(title: string): TerminalTabCreateResult {
    if (this.records.filter((tab) => tab.kind === "shell").length >= MAX_TERMINAL_SHELL_TABS) {
      return { ok: false, reason: "shell-limit" };
    }
    if (this.records.length >= MAX_TERMINAL_TABS) return { ok: false, reason: "tab-limit" };
    const tab = this.create("shell", title, null);
    return { ok: true, tab, evictedId: null };
  }

  createTask(taskSessionId: string, title: string): TerminalTabCreateResult {
    const existing = this.records.find((tab) => tab.taskSessionId === taskSessionId);
    if (existing) {
      this.selected = existing.id;
      return { ok: true, tab: existing, evictedId: null };
    }
    let evictedId: string | null = null;
    if (this.records.length >= MAX_TERMINAL_TABS) {
      const evictable = this.records.find((tab) => tab.kind === "task" && tab.taskTerminal);
      if (!evictable) return { ok: false, reason: "tab-limit" };
      evictedId = evictable.id;
      this.remove(evictable.id);
    }
    const tab = this.create("task", title, taskSessionId);
    return { ok: true, tab, evictedId };
  }

  select(id: string): boolean {
    if (!this.records.some((tab) => tab.id === id)) return false;
    this.selected = id;
    return true;
  }

  update(id: string, patch: Partial<Pick<TerminalTabRecord, "title" | "taskTerminal">>): void {
    this.records = this.records.map((tab) => tab.id === id ? { ...tab, ...patch } : tab);
  }

  close(id: string): TerminalTabCloseResult {
    const closedIndex = this.records.findIndex((tab) => tab.id === id);
    if (closedIndex < 0) return { closed: null, selectedId: this.selected };
    const [closed] = this.records.splice(closedIndex, 1);
    if (this.selected === id) {
      this.selected = this.records[Math.min(closedIndex, this.records.length - 1)]?.id ?? null;
    }
    return { closed: closed ?? null, selectedId: this.selected };
  }

  clear(): readonly TerminalTabRecord[] {
    const previous = this.records;
    this.records = [];
    this.selected = null;
    return previous;
  }

  private create(kind: TerminalTabKind, title: string, taskSessionId: string | null): TerminalTabRecord {
    const ordinal = ++this.sequence;
    const tab: TerminalTabRecord = {
      id: `terminal-tab-${ordinal}`,
      kind,
      title,
      taskSessionId,
      taskTerminal: false,
      ordinal,
    };
    this.records.push(tab);
    this.selected = tab.id;
    return tab;
  }

  private remove(id: string): void {
    const index = this.records.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    this.records.splice(index, 1);
    if (this.selected === id) {
      this.selected = this.records[Math.min(index, this.records.length - 1)]?.id ?? null;
    }
  }
}
