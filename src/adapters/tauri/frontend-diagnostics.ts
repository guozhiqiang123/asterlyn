import { invoke } from "@tauri-apps/api/core";
import { diagnostics, installDiagnosticSink, type DiagnosticLevel } from "../../application/diagnostics.ts";

let installed = false;

export function installFrontendDiagnostics(target: Window = window): void {
  if (installed || !("__TAURI_INTERNALS__" in target)) return;
  installed = true;
  installDiagnosticSink((entry) => invoke("write_frontend_diagnostic", entry as unknown as Record<string, unknown>));
  target.addEventListener("error", (event) => {
    reportFrontendDiagnostic("error", "window.error", event.error ?? event.message);
  });
  target.addEventListener("unhandledrejection", (event) => {
    reportFrontendDiagnostic("error", "window.unhandled_rejection", event.reason);
  });
}

export function reportFrontendDiagnostic(
  level: DiagnosticLevel,
  event: string,
  error: unknown,
): void {
  diagnostics.report(level, event, error);
}
