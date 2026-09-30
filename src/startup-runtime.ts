import { nativeAppearance } from "./adapters/tauri/tauri-appearance-adapter.ts";
import { loadLocale } from "./localization/locale-loader.ts";
import {
  applyPresentationToDocument,
  createBrowserSystemPresentationPort,
  resolvePresentationSnapshot,
} from "./presentation/presentation-environment.ts";
import { loadAppPreferences } from "./preferences.ts";

export async function startDesktopApplication(): Promise<void> {
  const preferences = loadAppPreferences(window.localStorage);
  const system = createBrowserSystemPresentationPort(window);
  const presentation = resolvePresentationSnapshot(preferences, system);
  applyPresentationToDocument(document, presentation);
  void nativeAppearance.setTheme(preferences.theme).catch((error: unknown) => {
    console.error("Unable to synchronize the native appearance.", error);
  });

  const catalog = await loadLocale(presentation.locale);
  const { startApplication } = await import("./main.ts");
  await startApplication(catalog);
}
