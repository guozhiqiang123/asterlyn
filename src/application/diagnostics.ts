import { diagnostics } from "../shared/diagnostics.ts";
export { createDiagnosticReporter, normalizeDiagnosticError, installDiagnosticSink, diagnostics } from "../shared/diagnostics.ts";
export type { DiagnosticLevel, DiagnosticEntry } from "../shared/diagnostics.ts";

export async function observeDesktopCommand<T>(command: string, action: (traceId: string) => Promise<T>, lifecycle = false, expectedFailure?: (error:unknown)=>boolean): Promise<T> {
  const traceId = diagnostics.newTrace();
  const started = performance.now();
  if (lifecycle) diagnostics.report("info", "command.started", "", { traceId, command });
  try {
    const result = await action(traceId);
    const durationMs = performance.now() - started;
    if (lifecycle || durationMs >= 1_000) diagnostics.report("info", "command.completed", "", { traceId, command, durationMs });
    return result;
  } catch (error) {
    if(expectedFailure?.(error))throw error;
    diagnostics.identify(error, traceId);
    diagnostics.report("error", "command.failed", error, { traceId, command, durationMs: performance.now() - started });
    throw error;
  }
}
