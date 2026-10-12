import type { AppUpdateBridge } from "../../protocol/desktop-bridge.ts";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "installing"
  | "error";

export type AppUpdateDialog = "confirm" | "installing" | "error" | null;

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAtEpochMs: number | null;
  assetName: string | null;
  assetSizeBytes: number | null;
  canInstall: boolean;
  error: string | null;
  openingRelease: boolean;
  dialog: AppUpdateDialog;
  installMessage: string | null;
}

export class AppUpdateController {
  readonly state: AppUpdateState;

  private readonly gateway: AppUpdateBridge;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;

  constructor(
    gateway: AppUpdateBridge,
    currentVersion: string,
    releaseUrl: string,
  ) {
    this.gateway = gateway;
    this.state = {
      status: "idle",
      currentVersion,
      latestVersion: null,
      releaseUrl,
      checkedAtEpochMs: null,
      assetName: null,
      assetSizeBytes: null,
      canInstall: false,
      error: null,
      openingRelease: false,
      dialog: null,
      installMessage: null,
    };
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async check(showAvailableDialog = false): Promise<void> {
    if (this.disposed || this.state.status === "checking" || this.state.status === "installing") return;
    const request = ++this.generation;
    this.state.status = "checking";
    this.state.error = null;
    this.state.installMessage = null;
    this.emit();
    try {
      const result = await this.gateway.checkForAppUpdates();
      if (this.disposed || request !== this.generation) return;
      this.state.currentVersion = result.currentVersion;
      this.state.latestVersion = result.latestVersion;
      this.state.releaseUrl = result.releaseUrl;
      this.state.checkedAtEpochMs = result.checkedAtEpochMs;
      this.state.assetName = result.assetName;
      this.state.assetSizeBytes = result.assetSizeBytes;
      this.state.canInstall = result.canInstall;
      this.state.error = result.error;
      this.state.status = result.ok
        ? result.hasUpdate ? "available" : "current"
        : "error";
      if (showAvailableDialog && result.hasUpdate && result.canInstall) {
        this.state.dialog = "confirm";
      }
      this.emit();
    } catch (error) {
      if (this.disposed || request !== this.generation) return;
      this.state.status = "error";
      this.state.checkedAtEpochMs = Date.now();
      this.state.error = errorMessage(error);
      this.emit();
    }
  }

  requestInstall(): void {
    if (
      this.disposed || this.state.status !== "available" ||
      !this.state.canInstall || !this.state.latestVersion || !this.state.assetName
    ) return;
    this.state.dialog = "confirm";
    this.state.error = null;
    this.emit();
  }

  async install(): Promise<void> {
    if (
      this.disposed || this.state.status === "installing" ||
      !this.state.canInstall || !this.state.latestVersion || !this.state.assetName
    ) return;
    const request = ++this.generation;
    this.state.status = "installing";
    this.state.dialog = "installing";
    this.state.error = null;
    this.state.installMessage = null;
    this.emit();
    try {
      const result = await this.gateway.installAppUpdate();
      if (this.disposed || request !== this.generation) return;
      if (!result.ok) throw new Error(result.error ?? result.message);
      this.state.installMessage = result.message;
      this.emit();
    } catch (error) {
      if (this.disposed || request !== this.generation) return;
      this.state.status = "error";
      this.state.dialog = "error";
      this.state.error = errorMessage(error);
      this.emit();
    }
  }

  closeDialog(): void {
    if (this.disposed || this.state.dialog === "installing") return;
    this.state.dialog = null;
    if (this.state.status === "error" && this.state.latestVersion && this.state.canInstall) {
      this.state.status = "available";
    }
    this.emit();
  }

  async openRelease(): Promise<void> {
    if (this.disposed || this.state.openingRelease) return;
    const checkError = this.state.status === "error" ? this.state.error : null;
    this.state.openingRelease = true;
    this.emit();
    try {
      await this.gateway.openAppUpdateRelease(this.state.releaseUrl);
      if (!this.disposed) this.state.error = checkError;
    } catch (error) {
      if (!this.disposed) this.state.error = errorMessage(error);
    } finally {
      if (!this.disposed) {
        this.state.openingRelease = false;
        this.emit();
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.listeners.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
