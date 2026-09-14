import type { TerminalEvent, TerminalStarted } from "../../models.ts";
import type { TerminalBridge } from "../../protocol/terminal.ts";

const MAX_INPUT_CHUNK_BYTES = 64 * 1024;
const MAX_STARTUP_OUTPUT_BYTES = 256 * 1024;

export type TerminalStatus = "idle" | "starting" | "running" | "exited" | "error";

export interface TerminalState {
  readonly root: string | null;
  readonly status: TerminalStatus;
  readonly sessionId: string | null;
  readonly shell: string | null;
  readonly cwd: string | null;
  readonly exitCode: number | null;
  readonly error: string | null;
}

export interface TerminalChange {
  readonly reason: "workspace" | "starting" | "started" | "exited" | "closed" | "error";
  readonly state: TerminalState;
}

type TerminalGateway = Pick<
  TerminalBridge,
  | "startTerminal"
  | "writeTerminal"
  | "resizeTerminal"
  | "closeTerminal"
  | "subscribeTerminal"
>;

type StateListener = (change: TerminalChange) => void;
type OutputListener = (bytes: Uint8Array) => void;

/** Owns one bounded terminal session without publishing high-frequency output to application state. */
export class TerminalController {
  private readonly gateway: TerminalGateway;
  private value: TerminalState = emptyState(null);
  private readonly stateListeners = new Set<StateListener>();
  private readonly outputListeners = new Set<OutputListener>();
  private subscriptionPromise: Promise<void> | null = null;
  private releaseSubscription: (() => void) | null = null;
  private generation = 0;
  private lastOutputSequence = 0;
  private startupEvents: TerminalEvent[] = [];
  private startupOutputBytes = 0;
  private inputQueue: string[] = [];
  private inputFlushQueued = false;
  private inputTail = Promise.resolve();
  private pendingResize: { cols: number; rows: number } | null = null;
  private resizeFlushQueued = false;
  private lastSize: { cols: number; rows: number } | null = null;
  private disposed = false;

  constructor(gateway: TerminalGateway) {
    this.gateway = gateway;
  }

  get state(): TerminalState {
    return this.value;
  }

  subscribe(listener: StateListener): () => void {
    if (this.disposed) return () => undefined;
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeOutput(listener: OutputListener): () => void {
    if (this.disposed) return () => undefined;
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  installWorkspace(root: string): void {
    if (this.value.root === root) return;
    const staleSession = this.value.sessionId;
    this.generation += 1;
    this.clearPendingTransport();
    this.value = emptyState(root);
    this.emit("workspace");
    if (staleSession) void this.gateway.closeTerminal(staleSession).catch(() => undefined);
  }

  async start(cols: number, rows: number): Promise<void> {
    const root = this.value.root;
    if (!root || this.disposed || this.value.status === "starting" || this.value.status === "running") {
      return;
    }
    const generation = ++this.generation;
    this.clearPendingTransport();
    this.value = { ...emptyState(root), status: "starting" };
    this.emit("starting");
    try {
      await this.ensureSubscription();
      if (!this.isCurrent(generation, root)) return;
      const started = await this.gateway.startTerminal(root, cols, rows);
      if (!this.isCurrent(generation, root)) {
        void this.gateway.closeTerminal(started.sessionId).catch(() => undefined);
        return;
      }
      this.lastSize = { cols, rows };
      this.value = startedState(root, started);
      this.emit("started");
      const startupEvents = this.startupEvents;
      this.startupEvents = [];
      this.startupOutputBytes = 0;
      startupEvents.forEach((event) => this.acceptEvent(event));
    } catch (error) {
      if (this.isCurrent(generation, root)) this.fail(error);
    }
  }

  async restart(cols: number, rows: number): Promise<void> {
    await this.close();
    await this.start(cols, rows);
  }

  sendInput(data: string): void {
    if (!data || this.value.status !== "running" || !this.value.sessionId || this.disposed) return;
    this.inputQueue.push(data);
    if (this.inputFlushQueued) return;
    this.inputFlushQueued = true;
    queueMicrotask(() => this.flushInput());
  }

  resize(cols: number, rows: number): void {
    if (
      this.value.status !== "running" ||
      !this.value.sessionId ||
      this.disposed ||
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      rows < 2 ||
      (this.lastSize?.cols === cols && this.lastSize.rows === rows)
    ) return;
    this.pendingResize = { cols, rows };
    if (this.resizeFlushQueued) return;
    this.resizeFlushQueued = true;
    queueMicrotask(() => this.flushResize());
  }

  async close(): Promise<void> {
    const sessionId = this.value.sessionId;
    const root = this.value.root;
    this.generation += 1;
    this.clearPendingTransport();
    this.value = emptyState(root);
    this.emit("closed");
    if (sessionId) await this.gateway.closeTerminal(sessionId).catch(() => false);
  }

  dispose(): void {
    if (this.disposed) return;
    const sessionId = this.value.sessionId;
    this.disposed = true;
    this.generation += 1;
    this.clearPendingTransport();
    this.stateListeners.clear();
    this.outputListeners.clear();
    this.releaseSubscription?.();
    this.releaseSubscription = null;
    void this.subscriptionPromise?.then(() => this.releaseSubscription?.());
    if (sessionId) void this.gateway.closeTerminal(sessionId).catch(() => false);
  }

  private async ensureSubscription(): Promise<void> {
    if (this.releaseSubscription) return;
    if (this.subscriptionPromise) return this.subscriptionPromise;
    this.subscriptionPromise = this.gateway
      .subscribeTerminal((event) => this.acceptEvent(event))
      .then((release) => {
        if (this.disposed) release();
        else this.releaseSubscription = release;
      })
      .catch((error) => {
        this.subscriptionPromise = null;
        throw error;
      });
    return this.subscriptionPromise;
  }

  private acceptEvent(event: TerminalEvent): void {
    if (this.disposed) return;
    if (this.value.status === "starting" && !this.value.sessionId) {
      const byteLength = event.kind === "output" ? decodedByteLength(event.dataBase64) : 0;
      if (this.startupOutputBytes + byteLength <= MAX_STARTUP_OUTPUT_BYTES) {
        this.startupEvents.push(event);
        this.startupOutputBytes += byteLength;
      }
      return;
    }
    if (event.sessionId !== this.value.sessionId) return;
    if (event.kind === "output") {
      if (event.sequence <= this.lastOutputSequence) return;
      this.lastOutputSequence = event.sequence;
      try {
        const bytes = decodeBase64(event.dataBase64);
        this.outputListeners.forEach((listener) => listener(bytes));
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    if (event.kind === "exited") {
      this.value = {
        ...this.value,
        status: "exited",
        exitCode: event.exitCode,
        error: null,
      };
      this.emit("exited");
      return;
    }
    this.fail(new Error(event.message));
  }

  private flushInput(): void {
    this.inputFlushQueued = false;
    const sessionId = this.value.sessionId;
    if (!sessionId || this.value.status !== "running" || this.inputQueue.length === 0) {
      this.inputQueue = [];
      return;
    }
    const bytes = new TextEncoder().encode(this.inputQueue.join(""));
    this.inputQueue = [];
    for (let offset = 0; offset < bytes.length; offset += MAX_INPUT_CHUNK_BYTES) {
      const encoded = encodeBase64(bytes.subarray(offset, offset + MAX_INPUT_CHUNK_BYTES));
      this.inputTail = this.inputTail
        .then(() => this.gateway.writeTerminal(sessionId, encoded))
        .catch((error) => {
          if (this.value.sessionId === sessionId) this.fail(error);
        });
    }
  }

  private flushResize(): void {
    this.resizeFlushQueued = false;
    const size = this.pendingResize;
    const sessionId = this.value.sessionId;
    this.pendingResize = null;
    if (!size || !sessionId || this.value.status !== "running") return;
    this.lastSize = size;
    void this.gateway.resizeTerminal(sessionId, size.cols, size.rows).catch((error) => {
      if (this.value.sessionId === sessionId) this.fail(error);
    });
  }

  private clearPendingTransport(): void {
    this.lastOutputSequence = 0;
    this.startupEvents = [];
    this.startupOutputBytes = 0;
    this.inputQueue = [];
    this.inputFlushQueued = false;
    this.pendingResize = null;
    this.resizeFlushQueued = false;
    this.lastSize = null;
  }

  private isCurrent(generation: number, root: string): boolean {
    return !this.disposed && this.generation === generation && this.value.root === root;
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.value = { ...this.value, status: "error", error: message };
    this.emit("error");
  }

  private emit(reason: TerminalChange["reason"]): void {
    const change = { reason, state: this.value };
    this.stateListeners.forEach((listener) => listener(change));
  }
}

function emptyState(root: string | null): TerminalState {
  return {
    root,
    status: "idle",
    sessionId: null,
    shell: null,
    cwd: null,
    exitCode: null,
    error: null,
  };
}

function startedState(root: string, started: TerminalStarted): TerminalState {
  return {
    root,
    status: "running",
    sessionId: started.sessionId,
    shell: started.shell,
    cwd: started.cwd,
    exitCode: null,
    error: null,
  };
}

function decodedByteLength(value: string): number {
  if (!value) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const block = 0x4000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  return btoa(binary);
}
