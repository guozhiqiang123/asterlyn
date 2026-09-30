import type { SettingsChange } from "../features/settings/settings-controller.ts";
import { SettingsController } from "../features/settings/settings-controller.ts";
import {
  PresentationEnvironment,
  type NativeAppearancePort,
  type PresentationSnapshot,
  type SystemPresentationPort,
} from "../presentation/presentation-environment.ts";
import type { PreferenceSyncPort } from "../features/settings/preference-store.ts";
import { BRAND } from "../brand.ts";
import { AppUpdateController } from "../features/settings/app-update-controller.ts";
import type { AppUpdateBridge } from "../protocol/desktop-bridge.ts";

export interface SettingsPresentationRuntimeOptions {
  readonly storage: Storage;
  readonly preferenceSync: PreferenceSyncPort;
  readonly systemPresentation: SystemPresentationPort;
  readonly document: Document;
  readonly nativeAppearance: NativeAppearancePort;
  readonly appUpdates: AppUpdateBridge;
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
  readonly updates: AppUpdateController;

  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(options: SettingsPresentationRuntimeOptions) {
    this.settings = new SettingsController(options.storage, options.preferenceSync);
    this.updates = new AppUpdateController(options.appUpdates, BRAND.version, BRAND.releaseUrl);
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
    this.updates.dispose();
    this.presentation.dispose();
  }
}
