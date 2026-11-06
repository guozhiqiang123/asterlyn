import "../../src/styles.css";
import "../../src/features/language-services/managed-language-status.css";
import { ManagedLanguageRecommendationPreferences } from
  "../../src/application/language-services/recommendation-preferences.ts";
import { ManagedLanguageStatusRuntime } from
  "../../src/composition/managed-language-status-runtime.ts";
import { EN_US_LANGUAGE_SERVICE_COPY } from
  "../../src/localization/language-service-copy.ts";

const catalog = {
  schemaVersion: 1 as const,
  languages: [{ id: "rust", labelKey: "language.rust", extensions: [".rs"], fileNames: [] }],
  servers: [],
};
const entry = {
  id: "dev.asterlyn.lsp",
  version: "0.3.19",
  origin: "installed" as const,
  nameKey: "name",
  descriptionKey: "description",
  localization: {
    defaultLocale: "en-US",
    locales: { "en-US": { name: "Language services", description: "Language services", "language.rust": "Rust" } },
  },
  languageServerCatalog: catalog,
  enabled: true,
  matched: true,
  active: true,
  settingDescriptors: [],
  settings: {},
  diagnostics: [],
};
let management = { schemaVersion: 1 as const, entries: [entry] };
let managementListener = (_snapshot: typeof management): void => undefined;
let workspaceRoot = "/repo";
let source: { workspacePath: string; kind: "editable-source" | "read-only-source" } | null = {
  workspacePath: "src/main.rs",
  kind: "editable-source",
};
const opened: Array<string | null> = [];
if (sessionStorage.getItem("managed-language-status-fixture.initialized") !== "true") {
  localStorage.removeItem("asterlyn.managedLanguageRecommendations.v1");
  sessionStorage.setItem("managed-language-status-fixture.initialized", "true");
}
const preferences = new ManagedLanguageRecommendationPreferences(localStorage, window);
const editor = document.querySelector<HTMLInputElement>("#editor")!;
const runtime = new ManagedLanguageStatusRuntime(document.body, {
  read: async () => ({
    protocolVersion: 1,
    platform: "macos-arm64",
    target: "aarch64-apple-darwin",
    installation: {
      protocolVersion: 1,
      epoch: "fixture-host",
      revision: 0,
      indexRevision: 0,
      artifacts: [],
      selections: [],
      operations: [],
    },
  }),
}, {
  workspaceRoot: () => workspaceRoot,
  context: () => ({
    source,
    hasWorkspace: true,
    rootMarkers: new Set(["Cargo.toml"]),
    rootMarkersComplete: true,
  }),
  locale: () => "en-US",
  copy: () => EN_US_LANGUAGE_SERVICE_COPY.management,
  preferences,
  openManagement: (pluginId) => opened.push(pluginId),
  restoreEditorFocus: () => editor.focus(),
  reportError: (error) => { throw error; },
}).connectManagement({
  get pluginManagementSnapshot() { return management; },
  subscribePluginManagement(listener) {
    managementListener = listener;
    return () => { managementListener = () => undefined; };
  },
});

(window as typeof window & { managedLanguageStatusFixture: unknown }).managedLanguageStatusFixture = {
  setSource(kind: "editable-source" | "read-only-source" | "none", root = workspaceRoot) {
    workspaceRoot = root;
    source = kind === "none" ? null : { workspacePath: "src/main.rs", kind };
    runtime.refresh();
  },
  setEnabled(enabled: boolean) {
    management = { schemaVersion: 1, entries: [{ ...entry, enabled, active: enabled }] };
    managementListener(management);
  },
  resetRecommendations(root = workspaceRoot) {
    preferences.clear(root, entry.id);
  },
  snapshot() {
    return {
      opened: [...opened],
      workspaceRoot,
      suppressed: preferences.count(workspaceRoot, entry.id),
      activeElement: document.activeElement?.id || document.activeElement?.getAttribute("data-managed-language-action"),
    };
  },
  dispose() {
    runtime.dispose();
    preferences.dispose();
  },
};
