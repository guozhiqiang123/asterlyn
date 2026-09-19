import type { ErrorCopy, RemoteCopy } from "../../localization/catalog.ts";
import {
  RemoteAuthenticationController,
  type RemoteAuthenticationGateway,
} from "./remote-authentication-controller.ts";
import {
  RemotePushController,
  type RemotePushChange,
  type RemotePushGateway,
} from "./remote-push-controller.ts";

export interface RemoteRuntimeGateways {
  readonly push: RemotePushGateway;
  readonly authentication: RemoteAuthenticationGateway;
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

  private readonly releases: readonly (() => void)[];
  private disposed = false;

  constructor(
    gateways: RemoteRuntimeGateways,
    messages: RemoteRuntimeMessages,
    notifications: RemoteRuntimeNotifications,
  ) {
    this.push = new RemotePushController(gateways.push, {
      messages: messages.remote,
      errorMessages: messages.errors,
    });
    this.authentication = new RemoteAuthenticationController(
      gateways.authentication,
      messages.remote,
      messages.errors,
    );
    this.releases = [
      this.push.subscribe((change) => notifications.pushChanged(change)),
      this.authentication.subscribe(() => notifications.authenticationChanged()),
    ];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const release of this.releases) release();
    this.push.dispose();
    this.authentication.dispose();
  }
}
