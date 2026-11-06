import type { ManagedArtifact, ManagedInstallationSnapshot, ManagedServerId } from "./generated-native-language-types.ts";
import { isNativeLanguageModel } from "./native-language-validation.ts";

const digest = (value: string): boolean => /^sha256:[a-f0-9]{64}$/u.exec(value)?.[0] === value;
const identifier = (value: string, max: number): boolean => value.length <= max && /^[a-z][a-z0-9.-]*$/u.exec(value)?.[0] === value;
const opaque = (value: string, max: number): boolean => value.length <= max && /^[A-Za-z0-9._-]+$/u.exec(value)?.[0] === value;
const serverValid = (server: ManagedServerId): boolean => identifier(server.pluginId, 160) && identifier(server.serverId, 128);
const sameServer = (left: ManagedServerId, right: ManagedServerId): boolean => left.pluginId === right.pluginId && left.serverId === right.serverId;
const serverKey = (server: ManagedServerId): string => JSON.stringify([server.pluginId, server.serverId]);

function identityValid(identity: ManagedArtifact): boolean {
  return serverValid(identity.server) && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.exec(identity.version)?.[0] === identity.version
    && /^[a-z0-9][a-z0-9._-]{0,79}$/u.exec(identity.target)?.[0] === identity.target
    && [identity.recipeDigest, identity.archiveDigest, identity.contentDigest].every(digest);
}

/** Validate projection shape/references. Native storage still verifies identities and actual bytes. */
export function validateManagedInstallationSnapshot(value: unknown): asserts value is ManagedInstallationSnapshot {
  const invalid = (): never => { throw new Error("Invalid managed language installation snapshot"); };
  if (!isNativeLanguageModel("ManagedInstallationSnapshot", value, [], true)) invalid();
  const snapshot = value as ManagedInstallationSnapshot;
  if (!opaque(snapshot.epoch, 64)) invalid();
  const ids = new Set<string>();
  for (const { artifact } of snapshot.artifacts) {
    if (!digest(artifact.id) || !identityValid(artifact.identity) || ids.has(artifact.id)) invalid();
    ids.add(artifact.id);
  }
  if (snapshot.artifacts.reduce((count, item) => count + item.useCount, 0) > 128) invalid();
  const selections = new Set<string>();
  for (const selection of snapshot.selections) {
    const key = serverKey(selection.server);
    if (!serverValid(selection.server) || selections.has(key) || !selection.current && !selection.rollback
      || selection.current != null && selection.current === selection.rollback) invalid();
    selections.add(key);
    for (const id of [selection.current, selection.rollback]) {
      if (id != null && !snapshot.artifacts.some(item => item.artifact.id === id && sameServer(item.artifact.identity.server, selection.server))) invalid();
    }
  }
  const operations = new Set<string>(), activeServers = new Set<string>();
  for (const operation of snapshot.operations) {
    if (!opaque(operation.id, 128) || operations.has(operation.id) || !serverValid(operation.server) || !digest(operation.artifactId)
      || operation.completedBytes > operation.totalBytes || (operation.failure != null) !== (operation.phase === "failed")
      || operation.kind === "install" && (operation.phase === "waiting-for-uses" || operation.totalBytes === 0)
      || operation.kind === "install" && ["verifying", "committing", "completed"].includes(operation.phase) && operation.completedBytes !== operation.totalBytes
      || operation.kind === "remove" && (operation.totalBytes !== 0 || ["acquiring", "verifying"].includes(operation.phase))) invalid();
    operations.add(operation.id);
    if (!["completed", "cancelled", "failed"].includes(operation.phase)) {
      const key = serverKey(operation.server);
      if (activeServers.has(key)) invalid();
      activeServers.add(key);
      if (operation.kind === "remove" && !snapshot.artifacts.some(item => item.artifact.id === operation.artifactId
        && sameServer(item.artifact.identity.server, operation.server) && item.artifact.ownership === "managed")) invalid();
    }
  }
  if (activeServers.size > 8 || snapshot.operations.length - activeServers.size > 16) invalid();
}
