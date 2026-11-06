import type { ManagedLanguageEnvironment } from "../../protocol/managed-language-environment.ts";
import { validateManagedLanguageEnvironment } from "../../protocol/managed-language-environment.ts";
import { invokeDesktopCommandUnvalidated } from "./desktop-command-adapter.ts";

export async function readManagedLanguageEnvironment(): Promise<ManagedLanguageEnvironment> {
  return validateManagedLanguageEnvironment(
    await invokeDesktopCommandUnvalidated("read_managed_language_environment", {}),
  );
}
