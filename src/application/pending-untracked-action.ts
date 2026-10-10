import type { Localization } from "../localization/localization.ts";
import { remotePolicy } from "../remote-policy.ts";
import type { WindowSession } from "./window-session.ts";

export async function recoverPendingRemoteAction(
  kind: "pull" | "push",
  session: WindowSession,
  selectedRemote: string | null,
  localization: Localization,
  busy: boolean,
): Promise<boolean> {
  const snapshot = session.repository.state.snapshot;
  if (
    kind !== "pull" ||
    busy ||
    !snapshot ||
    snapshot.untrackedState !== "pending" ||
    remotePolicy(snapshot, selectedRemote, localization).pull.detail !==
      localization.catalog.remote.policy.waitForScan
  ) return true;

  const generation = session.generation;
  await session.ensureUntrackedScan(snapshot.root, generation, true, "manualRefresh");
  return session.matches(generation, snapshot.root);
}
