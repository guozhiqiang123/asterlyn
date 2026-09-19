import type { SettingsChange } from "../features/settings/settings-controller.ts";
import { SettingsController } from "../features/settings/settings-controller.ts";
import {
  PresentationEnvironment,
  type NativeAppearancePort,
  type PresentationSnapshot,
  type SystemPresentationPort,
} from "../presentation/presentation-environment.ts";
import type { PreferenceSyncPort } from "../features/settings/preference-store.ts";

export interface SettingsPresentationRuntimeOptions {
  readonly storage: Storage;
  readonly preferenceSync: PreferenceSyncPort;
  readonly systemPresentation: SystemPresentationPort;
  readonly document: Document;
  readonly nativeAppearance: NativeAppearancePort;
  readonly reportError?: (error: unknown) => void;
  readonly settingsChanged: (change: SettingsChange) => void;
  readonly presentationChanged: (
    snapshot: PresentationSnapshot,
    previous: PresentationSnapshot,
  ) => void;
}

/** Coordinates Settings persistence with the window presentation environment. */
export class SettingsPresentationRuntime {
  readonly settings: SettingsController;
  readonly presentation: PresentationEnvironment;

  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(options: SettingsPresentationRuntimeOptions) {
    this.settings = new SettingsController(options.storage, options.preferenceSync);
    this.presentation = new PresentationEnvironment(
      this.settings.state.preferences,
      options.systemPresentation,
      options.document,
      options.nativeAppearance,
      options.reportError,
    );
    this.releases = [
      this.settings.subscribe(options.settingsChanged),
      this.presentation.subscribe(options.presentationChanged),
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases) release();
    this.settings.dispose();
    this.presentation.dispose();
  }
}
