import type { DesktopBridge } from "../../protocol/desktop-bridge.ts";
import {
  RemoteRuntime,
  type RemoteRuntimeMessages,
  type RemoteRuntimeNotifications,
} from "./remote-runtime.ts";
import type { RemoteManagementGateway } from "./remote-management-controller.ts";
import type { RemoteManagementCopy } from "../../localization/git-reviewed-copy.ts";

export function createRemoteRuntime(
  root: HTMLElement,
  bridge: DesktopBridge,
  messages: RemoteRuntimeMessages,
  management: RemoteManagementGateway,
  notifications: RemoteRuntimeNotifications,
  managementCopy?: () => RemoteManagementCopy,
  storage?: Pick<Storage, "getItem" | "setItem">,
): RemoteRuntime {
  return new RemoteRuntime({
    push: {
      readPushPreview: (...args) => bridge.readPushPreview(...args),
      readCommitDetails: (...args) => bridge.readCommitDetails(...args),
      readPushFileCommit: (...args) => bridge.readPushFileCommit(...args),
      readCommitDiff: (...args) => bridge.readCommitDiff(...args),
      readCommitImageDiff: (...args) => bridge.readCommitImageDiff(...args),
      fetchRemote: (...args) => bridge.fetchRemote(...args),
      pullCurrent: (...args) => bridge.pullCurrent(...args),
      pushCurrent: (...args) => bridge.pushCurrent(...args),
      cancelRemoteOperation: (...args) => bridge.cancelRemoteOperation(...args),
    },
    authentication: {
      readRemoteAuthentication: (...args) => bridge.readRemoteAuthentication(...args),
      storeRemoteHttpsCredential: (...args) => bridge.storeRemoteHttpsCredential(...args),
      configureRemoteSsh: (...args) => bridge.configureRemoteSsh(...args),
    },
    management,
  }, messages, notifications, root, managementCopy, storage);
}
