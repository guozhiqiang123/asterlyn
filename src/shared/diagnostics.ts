export type DiagnosticLevel = "info" | "warning" | "error";
export interface DiagnosticEntry {
  level: DiagnosticLevel;
  event: string;
  message: string;
  stack: string | null;
  traceId: string;
  command: string | null;
  durationMs: number | null;
  suppressed: number;
  bridgeFailures: number;
}
type Sink = (entry: DiagnosticEntry) => Promise<unknown>;
type Context = { traceId?: string; command?: string; durationMs?: number };
const MAX_TEXT = 4_096;

/** Framework-independent error reporting. The concrete transport is installed at bootstrap. */
export function createDiagnosticReporter(sink: Sink, now: () => number = Date.now) {
  const identities = new WeakMap<object, string>();
  const primitiveIdentities = new Map<unknown, string>();
  let nonce = 0;
  let windowStart = 0;
  let count = 0;
  let suppressed = 0;
  let bridgeFailures = 0;
  const instanceId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  const newTrace = () => `ui-${instanceId}-${now()}-${++nonce}`;
  function identify(error: unknown, traceId?: string): string {
    if (error === "" || error === null || error === undefined) return traceId ?? newTrace();
    const objects = (typeof error === "object" && error !== null) || typeof error === "function";
    if (objects) {
      const id = traceId ?? identities.get(error as object) ?? newTrace();
      identities.set(error as object, id);
      return id;
    }
    const key = typeof error === "string" ? error.slice(0, MAX_TEXT) : error;
    const id = traceId ?? primitiveIdentities.get(key) ?? newTrace();
    if (primitiveIdentities.size >= 64) primitiveIdentities.delete(primitiveIdentities.keys().next().value);
    primitiveIdentities.set(key, id);
    return id;
  }
  function report(level: DiagnosticLevel, event: string, error: unknown, context: Context = {}): void {
    try {
      const time = now();
      if (time < windowStart || time - windowStart >= 1_000) { windowStart = time; count = 0; }
      // Preserve a small reserve for failures during a noisy successful-operation burst.
      if (count >= (level === "error" ? 120 : 100)) { suppressed++; return; }
      count++;
      const normalized = normalizeDiagnosticError(error);
      const entry: DiagnosticEntry = {
        level, event: /^[a-zA-Z0-9_.-]{1,128}$/u.test(event) ? event : "invalid_event",
        message: normalized.message, stack: normalized.stack,
        traceId: identify(error, context.traceId),
        command: context.command?.slice(0, 128) ?? null,
        durationMs: context.durationMs === undefined ? null : Math.max(0, Math.round(context.durationMs)),
        suppressed, bridgeFailures,
      };
      // A broken diagnostics bridge must never become another unhandled rejection.
      // Counters are cumulative, so concurrent acknowledgements cannot erase new failures.
      void sink(entry).catch(() => { bridgeFailures++; });
    } catch { bridgeFailures++; }
  }
  return { report, identify, newTrace, health: () => ({ suppressed, bridgeFailures }) };
}

export function normalizeDiagnosticError(error: unknown): { message: string; stack: string | null } {
  try {
    if (error instanceof Error) return { message: (error.message || error.name).slice(0, MAX_TEXT), stack: error.stack?.slice(0, MAX_TEXT) ?? null };
    if (typeof error === "string") return { message: error.slice(0, MAX_TEXT), stack: null };
    // Rejected objects can be process results, callback payloads or credentials. Never stringify them.
    const code = error && typeof error === "object"
      ? "code" in error ? error.code : "kind" in error ? error.kind : null
      : null;
    return { message: typeof code === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u.test(code)
      ? `Operation failed (${code})` : `Operation failed (${error === null ? "null" : typeof error})`, stack: null };
  } catch { return { message: "Operation failed (unreadable error)", stack: null }; }
}

let transport: Sink = async () => {};
export const diagnostics = createDiagnosticReporter((entry) => transport(entry));
export function installDiagnosticSink(sink: Sink): void { transport = sink; }
