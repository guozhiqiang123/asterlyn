import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./desktop-command-adapter.ts";

type DiagnosticLevel = "info" | "warning" | "error";

let installed = false;

export function installFrontendDiagnostics(target: Window = window): void {
  if (installed || !isTauriRuntime) return;
  installed = true;
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
  if (!isTauriRuntime) return;
  const normalized = normalizeError(error);
  void invoke("write_frontend_diagnostic", {
    level,
    event,
    message: normalized.message,
    stack: normalized.stack,
  }).catch(() => undefined);
}

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === "string") return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}
