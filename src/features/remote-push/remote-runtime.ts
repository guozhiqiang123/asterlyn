import type { ErrorCopy, RemoteCopy } from "../../localization/catalog.ts";
import type { RemoteManagementCopy } from "../../localization/git-reviewed-copy.ts";
import {
  RemoteAuthenticationController,
  type RemoteAuthenticationGateway,
} from "./remote-authentication-controller.ts";
import {
  RemotePushController,
  type RemotePushChange,
  type RemotePushGateway,
} from "./remote-push-controller.ts";
import { RemoteManagementBinding } from "./remote-management-binding.ts";
import { RemoteManagementController, type RemoteManagementGateway } from "./remote-management-controller.ts";

export interface RemoteRuntimeGateways {
  readonly push: RemotePushGateway;
  readonly authentication: RemoteAuthenticationGateway;
  readonly management?: RemoteManagementGateway;
}

export interface RemoteRuntimeNotifications {
  pushChanged(change: RemotePushChange): void;
  authenticationChanged(): void;
}

export interface RemoteRuntimeMessages {
  readonly remote: RemoteCopy;
  readonly errors: ErrorCopy;
}

/** Owns Remote's controllers, subscriptions, and disposal as one feature runtime. */
export class RemoteRuntime {
  readonly push: RemotePushController;
  readonly authentication: RemoteAuthenticationController;
  readonly management: RemoteManagementController | null;

  private readonly releases: readonly (() => void)[];
  private readonly managementBinding: RemoteManagementBinding | null;
  private disposed = false;

  constructor(
    gateways: RemoteRuntimeGateways,
    messages: RemoteRuntimeMessages,
    notifications: RemoteRuntimeNotifications,
    root?: HTMLElement,
    managementCopy: () => RemoteManagementCopy = () => messages.remote.management,
    storage?: Pick<Storage, "getItem" | "setItem">,
  ) {
    this.push = new RemotePushController(gateways.push, {
      messages: messages.remote,
      errorMessages: messages.errors,
      storage,
    });
    this.authentication = new RemoteAuthenticationController(
      gateways.authentication,
      messages.remote,
      messages.errors,
    );
    this.management = gateways.management ? new RemoteManagementController(gateways.management) : null;
    this.managementBinding = this.management && root
      ? new RemoteManagementBinding(root, this.management, managementCopy)
      : null;
    this.releases = [
      this.push.subscribe((change) => notifications.pushChanged(change)),
      this.authentication.subscribe(() => notifications.authenticationChanged()),
    ];
  }

  refreshCopy(): void { this.managementBinding?.refreshCopy(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases) release();
    this.push.dispose();
    this.authentication.dispose();
    this.managementBinding?.dispose();
    this.management?.dispose();
  }
}
