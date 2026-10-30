import { editorDocumentKey, type ProjectFileDocument } from "../../editor-document.ts";

export interface EditorNavigationSelection {
  tabId: string;
  anchor: number;
  head: number;
  line: number;
}
export interface EditorNavigationUpdate extends EditorNavigationSelection {
  kind: "activation" | "pointer" | "move" | "jump" | "edit";
  mapPosition?: (position: number) => number;
}
export interface EditorNavigationLocation extends EditorNavigationSelection {
  document: ProjectFileDocument;
}
export type NavigationDirection = -1 | 1;
export interface EditorNavigationGateway {
  open(document: ProjectFileDocument): Promise<"opened" | "missing" | "blocked">;
  select(anchor: number, head: number): boolean;
  diagnostic?(direction: NavigationDirection, outcome: "opened" | "blocked" | "empty" | "stale"): void;
}

const equal = (a: EditorNavigationLocation | null, b: EditorNavigationLocation) =>
  a?.tabId === b.tabId && a.anchor === b.anchor && a.head === b.head;

/** Bounded source coordinates only: no editor states, buffers, DOM or persisted history. */
export class EditorNavigationHistory {
  private back: EditorNavigationLocation[] = [];
  private forward: EditorNavigationLocation[] = [];
  private current: EditorNavigationLocation | null = null;
  private root: string | null = null;
  private epoch = 0;
  private busy = false;
  private replayLocation: EditorNavigationLocation | null = null;
  private replayTarget: string | null = null;
  private lastKind: EditorNavigationUpdate["kind"] | null = null;
  private lastAt = 0;
  private movementStart: EditorNavigationLocation | null = null;

  private readonly gateway: EditorNavigationGateway;
  private readonly clock: () => number;
  readonly limit: number;
  constructor(gateway: EditorNavigationGateway, clock = () => performance.now(), limit = 100) {
    if (!Number.isInteger(limit) || limit < 2 || limit > 1000) throw Error("Invalid navigation history bound");
    this.gateway = gateway; this.clock = clock; this.limit = limit;
  }
  get size(): number { return this.back.length + this.forward.length + (this.current ? 1 : 0); }
  installWorkspace(root: string | null): void { if (root !== this.root) this.reset(root); }
  available(direction: NavigationDirection): boolean { return !this.busy && (direction < 0 ? this.back : this.forward).length > 0; }
  reset(root: string | null): void {
    this.epoch++; this.root = root; this.back = []; this.forward = []; this.current = null;
    this.busy = false; this.replayLocation = null; this.replayTarget = null; this.lastKind = null; this.movementStart = null;
  }
  leave(): void {
    if (this.busy || !this.current) return;
    this.push(this.back, this.current); this.current = null; this.lastKind = null; this.movementStart = null;
    this.trim();
  }
  observe(document: ProjectFileDocument, update: EditorNavigationUpdate): void {
    if (document.repositoryRoot !== this.root || update.tabId !== editorDocumentKey(document)) return;
    if (update.mapPosition) this.map(update.tabId, update.mapPosition);
    const location = { document: { ...document }, tabId: update.tabId, anchor: update.anchor, head: update.head, line: update.line };
    if (this.busy) {
      if (update.kind !== "activation" || update.tabId === this.replayTarget) {
        if (update.tabId === this.replayTarget) this.replayLocation = location;
        return;
      }
      // A user-opened third file supersedes an outstanding Back/Forward load.
      this.epoch++; this.busy = false; this.replayLocation = null; this.replayTarget = null;
    }
    const now = this.clock(), previous = this.current;
    if (!previous) {
      if (equal(this.back.at(-1) ?? null, location)) this.back.pop();
    } else if (!equal(previous, location)) {
      const sameFile = previous.tabId === location.tabId;
      const coalesce = sameFile && ((this.lastKind === "activation" && now - this.lastAt < 500)
        || (update.kind === "pointer" && this.lastKind === "pointer" && now - this.lastAt < 500));
      if (sameFile && update.kind === "move") {
        this.movementStart ??= previous;
        if (Math.abs(location.line - this.movementStart.line) >= 5) {
          this.push(this.back, this.movementStart); this.forward = []; this.movementStart = location;
        }
      } else if (!sameFile || (update.kind !== "edit" && !coalesce)) {
        this.push(this.back, previous); this.forward = []; this.movementStart = null;
      }
    }
    this.current = location;
    if (update.kind !== "edit") { this.lastKind = update.kind; this.lastAt = now; }
    this.trim();
  }
  private map(tabId: string, map: (position: number) => number): void {
    const apply = (location: EditorNavigationLocation | null) => {
      if (location?.tabId === tabId) { location.anchor = map(location.anchor); location.head = map(location.head); }
    };
    for (const location of new Set([...this.back, ...this.forward, this.current, this.movementStart])) apply(location);
  }
  async navigate(direction: NavigationDirection): Promise<void> {
    if (!this.available(direction)) return;
    const epoch = this.epoch, source = direction < 0 ? this.back : this.forward;
    const destination = direction < 0 ? this.forward : this.back;
    this.busy = true;
    try {
      while (source.length) {
        const target = source.at(-1)!;
        this.replayTarget = target.tabId;
        this.replayLocation = null;
        const result = await this.gateway.open(target.document);
        if (epoch !== this.epoch) { this.gateway.diagnostic?.(direction, "stale"); return; }
        if (result === "missing") { source.pop(); continue; }
        if (result !== "opened" || !this.gateway.select(target.anchor, target.head)) {
          this.gateway.diagnostic?.(direction, "blocked"); return;
        }
        source.pop();
        if (this.current) this.push(destination, this.current);
        const replayed = this.replayedLocation();
        this.current = replayed?.tabId === target.tabId ? replayed : { ...target };
        this.lastKind = null; this.movementStart = null; this.trim();
        this.gateway.diagnostic?.(direction, "opened"); return;
      }
      this.gateway.diagnostic?.(direction, "empty");
    } finally { if (epoch === this.epoch) { this.busy = false; this.replayLocation = null; this.replayTarget = null; } }
  }
  private push(stack: EditorNavigationLocation[], location: EditorNavigationLocation): void {
    if (!equal(stack.at(-1) ?? null, location)) stack.push({ ...location });
  }
  private replayedLocation(): EditorNavigationLocation | null { return this.replayLocation; }
  private trim(): void {
    while (this.size > this.limit) { if (this.back.length) this.back.shift(); else this.forward.shift(); }
  }
}
