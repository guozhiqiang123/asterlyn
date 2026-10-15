import {
  type AppPreferences,
} from "../../preferences.ts";
import {
  PreferenceStore,
  createSilentPreferenceSync,
  type PreferenceSyncPort,
} from "./preference-store.ts";

export type SettingsSection = "general" | "appearance" | "editor" | "keybindings" | "version-control" | "code" | "updates" | "plugins";
type OrdinarySettingsSection = Exclude<SettingsSection, "plugins">;

export type SettingsRoute =
  | { readonly section: "plugins"; readonly pluginId?: string; readonly focus?: string }
  | { readonly section: OrdinarySettingsSection };

export interface SettingsState {
  section: SettingsSection;
  pluginId?: string;
  focus?: string;
  preferences: AppPreferences;
}

export interface SettingsChange {
  reason: "section" | "preferences";
  sectionChanged?: boolean;
  routeChanged?: boolean;
  pluginIdChanged?: boolean;
  focusChanged?: boolean;
  preferencesChanged?: boolean;
  previousPreferences?: AppPreferences;
  source?: "local" | "external";
}

type Listener = (change: SettingsChange) => void;

export class SettingsController {
  readonly state: SettingsState;

  private readonly listeners = new Set<Listener>();
  private readonly preferencesStore: PreferenceStore;
  private readonly releasePreferences: () => void;
  private disposed = false;

  constructor(storage: Storage, sync: PreferenceSyncPort = createSilentPreferenceSync()) {
    this.preferencesStore = new PreferenceStore(storage, sync);
    this.state = {
      section: "general",
      preferences: this.preferencesStore.preferences,
    };
    this.releasePreferences = this.preferencesStore.subscribe((change) => {
      this.state.preferences = change.preferences;
      this.emit({
        reason: "preferences",
        preferencesChanged: true,
        previousPreferences: change.previous,
        source: change.source,
      });
    });
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  selectSection(section: SettingsSection): void {
    this.navigate({ section } as SettingsRoute);
  }

  navigate(route: SettingsRoute): void {
    validateSettingsRoute(route);
    const nextPluginId = route.section === "plugins" ? route.pluginId : undefined;
    const nextFocus = route.section === "plugins" ? route.focus : undefined;
    const sectionChanged = this.state.section !== route.section;
    const pluginIdChanged = this.state.pluginId !== nextPluginId;
    const focusChanged = this.state.focus !== nextFocus;
    if (!sectionChanged && !pluginIdChanged && !focusChanged) return;
    this.state.section = route.section;
    this.state.pluginId = nextPluginId;
    this.state.focus = nextFocus;
    this.emit({
      reason: "section",
      sectionChanged,
      routeChanged: true,
      pluginIdChanged,
      focusChanged,
    });
  }

  selectPlugin(pluginId?: string, focus?: string): void {
    this.navigate({ section: "plugins", pluginId, focus });
  }

  update(update: Partial<AppPreferences>): boolean {
    return this.preferencesStore.update(update);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releasePreferences();
    this.preferencesStore.dispose();
    this.listeners.clear();
  }

  private emit(change: SettingsChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

const SETTINGS_IDENTIFIER = /^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/;

export function validateSettingsRoute(route: SettingsRoute): void {
  if (!route || typeof route !== "object" || !isSettingsSection(route.section)) {
    throw new Error("Invalid settings route");
  }
  const keys = Object.keys(route);
  if (route.section !== "plugins") {
    if (keys.some((key) => key !== "section")) {
      throw new Error("Plugin target is only valid for the plugins settings section");
    }
    return;
  }
  if (keys.some((key) => !["section", "pluginId", "focus"].includes(key))) {
    throw new Error("Invalid settings route target");
  }
  if (route.pluginId !== undefined && (typeof route.pluginId !== "string" || !SETTINGS_IDENTIFIER.test(route.pluginId))) {
    throw new Error("Invalid settings plugin ID");
  }
  if (route.focus !== undefined && (typeof route.focus !== "string" || !SETTINGS_IDENTIFIER.test(route.focus))) {
    throw new Error("Invalid settings focus");
  }
}

function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && [
    "general", "appearance", "editor", "keybindings", "version-control", "code", "updates", "plugins",
  ].includes(value);
}
