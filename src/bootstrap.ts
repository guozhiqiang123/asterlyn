import "./styles.css";
import "./startup-failure.css";
import {
  installFrontendDiagnostics,
  reportFrontendDiagnostic,
} from "./adapters/tauri/frontend-diagnostics.ts";
import { renderStartupFailure } from "./startup-failure.ts";

installFrontendDiagnostics();

async function bootstrap(): Promise<void> {
  const { startDesktopApplication } = await import("./startup-runtime.ts");
  await startDesktopApplication();
}

void bootstrap().catch((error: unknown) => {
  reportFrontendDiagnostic("error", "application.startup_failed", error);
  console.error("Asterlyn startup failed.", error);
  renderStartupFailure(document, window.navigator.languages);
});
