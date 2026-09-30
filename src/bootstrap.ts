import "./styles.css";
import "./startup-failure.css";
import { renderStartupFailure } from "./startup-failure.ts";

async function bootstrap(): Promise<void> {
  const { startDesktopApplication } = await import("./startup-runtime.ts");
  await startDesktopApplication();
}

void bootstrap().catch((error: unknown) => {
  console.error("Asterlyn startup failed.", error);
  renderStartupFailure(document, window.navigator.languages);
});
