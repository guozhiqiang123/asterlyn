import type { ErrorCopy, RemoteCopy } from "../../localization/catalog.ts";
import { localizedOperationError } from "../../localization/error-message.ts";
import { EN_US } from "../../localization/en-US.ts";
import type { RemoteAuthenticationStatus } from "../../models.ts";

export interface RemoteAuthenticationGateway {
  readRemoteAuthentication(
    repositoryRoot: string,
    remote: string,
  ): Promise<RemoteAuthenticationStatus>;
  storeRemoteHttpsCredential(
    repositoryRoot: string,
    remote: string,
    username: string,
    token: string,
  ): Promise<RemoteAuthenticationStatus>;
  configureRemoteSsh(
    repositoryRoot: string,
    remote: string,
    sshUrl: string,
  ): Promise<RemoteAuthenticationStatus>;
}

export interface RemoteAuthenticationState {
  checking: boolean;
  dialog: {
    repositoryRoot: string;
    status: RemoteAuthenticationStatus;
  } | null;
  saving: "https" | "ssh" | null;
  error: string | null;
}

export type RemoteAuthenticationResult = "ready" | "required" | "failure" | "stale";

type Listener = () => void;

export class RemoteAuthenticationController {
  readonly state: RemoteAuthenticationState = {
    checking: false,
    dialog: null,
    saving: null,
    error: null,
  };

  private readonly listeners = new Set<Listener>();
  private sequence = 0;
  private disposed = false;
  private readonly gateway: RemoteAuthenticationGateway;
  private remoteMessages: RemoteCopy;
  private errorMessages: ErrorCopy;

  constructor(
    gateway: RemoteAuthenticationGateway,
    remoteMessages: RemoteCopy = EN_US.remote,
    errorMessages: ErrorCopy = EN_US.errors,
  ) {
    this.gateway = gateway;
    this.remoteMessages = remoteMessages;
    this.errorMessages = errorMessages;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMessages(remoteMessages: RemoteCopy, errorMessages: ErrorCopy): void {
    this.remoteMessages = remoteMessages;
    this.errorMessages = errorMessages;
  }

  async check(
    repositoryRoot: string,
    remote: string,
    forceDialog = false,
  ): Promise<RemoteAuthenticationResult> {
    const sequence = ++this.sequence;
    const keepDialog =
      this.state.dialog?.repositoryRoot === repositoryRoot &&
      this.state.dialog.status.remote === remote;
    this.state.checking = true;
    if (!keepDialog) this.state.dialog = null;
    this.state.saving = null;
    this.state.error = null;
    this.emit();
    try {
      const status = await this.gateway.readRemoteAuthentication(repositoryRoot, remote);
      if (!this.matches(sequence)) return "stale";
      this.state.checking = false;
      if (!forceDialog && authenticationCanProceed(status)) {
        this.emit();
        return "ready";
      }
      this.state.dialog = { repositoryRoot, status };
      this.emit();
      return "required";
    } catch (error) {
      if (!this.matches(sequence)) return "stale";
      this.state.checking = false;
      this.state.error = localizedOperationError(error, this.errorMessages);
      this.emit();
      return "failure";
    }
  }

  async storeHttpsCredential(username: string, token: string): Promise<RemoteAuthenticationResult> {
    const dialog = this.state.dialog;
    if (!dialog || dialog.status.transport !== "https" || this.state.saving) return "stale";
    if (!username.trim() || !token.trim()) {
      this.state.error = this.remoteMessages.authenticationFieldsRequired;
      this.emit();
      return "failure";
    }
    const sequence = ++this.sequence;
    this.state.saving = "https";
    this.state.error = null;
    this.emit();
    try {
      const status = await this.gateway.storeRemoteHttpsCredential(
        dialog.repositoryRoot,
        dialog.status.remote,
        username,
        token,
      );
      if (!this.matches(sequence)) return "stale";
      this.state.saving = null;
      if (!authenticationCanProceed(status)) {
        this.state.dialog = { repositoryRoot: dialog.repositoryRoot, status };
        this.state.error = this.remoteMessages.credentialNotRetained;
        this.emit();
        return "failure";
      }
      this.state.dialog = null;
      this.emit();
      return "ready";
    } catch (error) {
      if (!this.matches(sequence)) return "stale";
      this.state.saving = null;
      this.state.error = this.authenticationError(error);
      this.emit();
      return "failure";
    }
  }

  async configureSsh(sshUrl: string): Promise<RemoteAuthenticationResult> {
    const dialog = this.state.dialog;
    if (!dialog || this.state.saving) return "stale";
    if (!sshUrl.trim()) {
      this.state.error = this.remoteMessages.sshUrlRequired;
      this.emit();
      return "failure";
    }
    const sequence = ++this.sequence;
    this.state.saving = "ssh";
    this.state.error = null;
    this.emit();
    try {
      const status = await this.gateway.configureRemoteSsh(
        dialog.repositoryRoot,
        dialog.status.remote,
        sshUrl,
      );
      if (!this.matches(sequence)) return "stale";
      this.state.saving = null;
      if (!authenticationCanProceed(status)) {
        this.state.dialog = { repositoryRoot: dialog.repositoryRoot, status };
        this.state.error = this.remoteMessages.sshIdentityMissing;
        this.emit();
        return "failure";
      }
      this.state.dialog = null;
      this.emit();
      return "ready";
    } catch (error) {
      if (!this.matches(sequence)) return "stale";
      this.state.saving = null;
      this.state.error = this.authenticationError(error);
      this.emit();
      return "failure";
    }
  }

  close(): void {
    if (
      !this.state.checking &&
      !this.state.dialog &&
      !this.state.saving &&
      !this.state.error
    ) return;
    this.sequence += 1;
    this.state.checking = false;
    this.state.dialog = null;
    this.state.saving = null;
    this.state.error = null;
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sequence += 1;
    this.listeners.clear();
  }

  private matches(sequence: number): boolean {
    return !this.disposed && sequence === this.sequence;
  }

  private authenticationError(error: unknown): string {
    if (error && typeof error === "object") {
      const value = error as Record<string, unknown>;
      if (value.kind === "invalidInput" && value.field === "credential helper") {
        return this.remoteMessages.credentialHelperUnavailable;
      }
      if (value.kind === "invalidInput" && value.field === "SSH remote URL") {
        return this.remoteMessages.invalidSshUrl;
      }
    }
    return localizedOperationError(error, this.errorMessages);
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}

function authenticationCanProceed(status: RemoteAuthenticationStatus): boolean {
  return status.credentialAvailable || status.transport === "local" || status.transport === "other";
}
