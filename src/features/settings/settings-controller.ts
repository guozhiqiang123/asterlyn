import {
  loadAppPreferences,
  saveAppPreferences,
  updateAppPreferences,
  type AppPreferences,
} from "../../workbench/preferences.ts";

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
}

type Listener = (change: SettingsChange) => void;

export class SettingsController {
  readonly state: SettingsState;

  private readonly listeners = new Set<Listener>();
  private readonly storage: Storage;
  private disposed = false;

  constructor(storage: Storage) {
    this.storage = storage;
    this.state = {
      section: "general",
      preferences: loadAppPreferences(storage),
    };
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
    const previous = this.state.preferences;
    const next = updateAppPreferences(previous, update);
    if (samePreferences(previous, next)) return false;
    this.state.preferences = next;
    saveAppPreferences(this.storage, next);
    this.emit({
      reason: "preferences",
      preferencesChanged: true,
      previousPreferences: previous,
    });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }

  private emit(change: SettingsChange): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener(change);
  }
}

function samePreferences(left: AppPreferences, right: AppPreferences): boolean {
  return (Object.keys(left) as Array<keyof AppPreferences>).every(
    (key) => left[key] === right[key],
  );
}
