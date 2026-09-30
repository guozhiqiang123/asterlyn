import type { AppUpdateBridge } from "../../protocol/desktop-bridge.ts";

export type AppUpdateStatus = "idle" | "checking" | "current" | "available" | "error";

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAtEpochMs: number | null;
  error: string | null;
  openingRelease: boolean;
}

export class AppUpdateController {
  readonly state: AppUpdateState;

  private readonly gateway: AppUpdateBridge;
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
      error: null,
      openingRelease: false,
    };
  }

  async check(): Promise<void> {
    if (this.disposed || this.state.status === "checking") return;
    const request = ++this.generation;
    this.state.status = "checking";
    this.state.error = null;
    try {
      const result = await this.gateway.checkForAppUpdates();
      if (this.disposed || request !== this.generation) return;
      this.state.currentVersion = result.currentVersion;
      this.state.latestVersion = result.latestVersion;
      this.state.releaseUrl = result.releaseUrl;
      this.state.checkedAtEpochMs = result.checkedAtEpochMs;
      this.state.error = result.error;
      this.state.status = result.ok
        ? result.hasUpdate ? "available" : "current"
        : "error";
    } catch (error) {
      if (this.disposed || request !== this.generation) return;
      this.state.status = "error";
      this.state.checkedAtEpochMs = Date.now();
      this.state.error = error instanceof Error ? error.message : String(error);
    }
  }

  async openRelease(): Promise<void> {
    if (this.disposed || this.state.openingRelease) return;
    const checkError = this.state.status === "error" ? this.state.error : null;
    this.state.openingRelease = true;
    try {
      await this.gateway.openAppUpdateRelease(this.state.releaseUrl);
      if (!this.disposed) this.state.error = checkError;
    } catch (error) {
      if (!this.disposed) {
        this.state.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (!this.disposed) this.state.openingRelease = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
  }
}
