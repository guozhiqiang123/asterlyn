import type { TerminalEvent } from "../../models.ts";
import type { TerminalBridge } from "../../protocol/terminal.ts";

type TerminalEventListener = (event: TerminalEvent) => void;
type TerminalEventGateway = Pick<TerminalBridge, "subscribeTerminal">;

/** Shares one native event subscription across the bounded terminal tabs in a window. */
export class TerminalEventRouter {
  private readonly gateway: TerminalEventGateway;
  private readonly listeners = new Set<TerminalEventListener>();
  private subscription: Promise<void> | null = null;
  private releaseNative: (() => void) | null = null;
  private disposed = false;

  constructor(gateway: TerminalEventGateway) { this.gateway = gateway; }

  async subscribeTerminal(listener: TerminalEventListener): Promise<() => void> {
    if (this.disposed) throw new Error("Terminal event router is disposed.");
    this.listeners.add(listener);
    try {
      await this.ensureNativeSubscription();
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.releaseNative?.();
    this.releaseNative = null;
    void this.subscription?.then(() => {
      this.releaseNative?.();
      this.releaseNative = null;
    });
  }

  private ensureNativeSubscription(): Promise<void> {
    if (this.releaseNative) return Promise.resolve();
    if (this.subscription) return this.subscription;
    this.subscription = this.gateway
      .subscribeTerminal((event) => {
        for (const listener of this.listeners) {
          try { listener(event); }
          catch { /* One tab cannot break sibling event delivery. */ }
        }
      })
      .then((release) => {
        if (this.disposed) release();
        else this.releaseNative = release;
      })
      .catch((error) => {
        this.subscription = null;
        throw error;
      });
    return this.subscription;
  }
}
