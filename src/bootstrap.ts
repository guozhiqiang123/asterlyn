import { nativeAppearance } from "./adapters/tauri/tauri-appearance-adapter.ts";
import {
  applyPresentationToDocument,
  createBrowserSystemPresentationPort,
  resolvePresentationSnapshot,
} from "./presentation/presentation-environment.ts";
import { loadAppPreferences } from "./preferences.ts";
import { loadLocale } from "./localization/locale-loader.ts";

const preferences = loadAppPreferences(window.localStorage);
const system = createBrowserSystemPresentationPort(window);
const presentation = resolvePresentationSnapshot(preferences, system);
applyPresentationToDocument(document, presentation);
void nativeAppearance.setTheme(preferences.theme).catch(console.error);

const catalog = await loadLocale(presentation.locale);
const { startApplication } = await import("./main.ts");
startApplication(catalog);
