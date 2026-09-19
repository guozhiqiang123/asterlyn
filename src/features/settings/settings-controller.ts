import {
  type AppPreferences,
} from "../../preferences.ts";
import {
  PreferenceStore,
  createSilentPreferenceSync,
  type PreferenceSyncPort,
} from "./preference-store.ts";

export type SettingsSection = "general" | "appearance" | "editor" | "version-control" | "code";

export interface SettingsState {
  section: SettingsSection;
  preferences: AppPreferences;
}

export interface SettingsChange {
  reason: "section" | "preferences";
  sectionChanged?: boolean;
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
    if (this.state.section === section) return;
    this.state.section = section;
    this.emit({ reason: "section", sectionChanged: true });
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
