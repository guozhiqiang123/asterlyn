import type { ManagedArtifactStatus, ManagedInstallOperation } from "../../protocol/generated-native-language-types.ts";
import type { CatalogSelection } from "./catalog-selection.ts";
import type { Immutable, InstallationFacts } from "./installation-facts.ts";

/** Future native recipe admission evidence. Catalog presence alone never supplies this value. */
export interface ManagedRecipeAvailability {
  readonly providerKey: string;
  readonly target: string;
  readonly available: boolean;
}

type CatalogReason = Exclude<CatalogSelection["kind"], "selected">;
export type ManagedInstallationRecommendation =
  | { readonly kind: "none"; readonly reason: CatalogReason }
  | { readonly kind: "checking" }
  | { readonly kind: "unavailable"; readonly reason: "installation-facts" | "target" | "recipe" }
  | { readonly kind: "installing" | "removing"; readonly operation: Immutable<ManagedInstallOperation> }
  | { readonly kind: "verification-required" | "installed"; readonly status: Immutable<ManagedArtifactStatus> }
  | { readonly kind: "recovery-available"; readonly artifactIds: readonly string[] }
  | { readonly kind: "install-available"; readonly providerKey: string };

/** Pure display decision. No returned variant is a download, process launch or execution grant. */
export function recommendManagedInstallation(
  selection: CatalogSelection,
  facts: InstallationFacts,
  nativeTarget: string,
  recipe: ManagedRecipeAvailability | null,
): ManagedInstallationRecommendation {
  if (selection.kind !== "selected") return { kind: "none", reason: selection.kind };
  if (facts.kind === "checking") return { kind: "checking" };
  if (facts.kind !== "available") return { kind: "unavailable", reason: "installation-facts" };
  if (/^[a-z0-9][a-z0-9._-]{0,79}$/u.exec(nativeTarget)?.[0] !== nativeTarget) return { kind: "unavailable", reason: "target" };
  const { pluginId, server, key } = selection.provider;
  const matches = (value: { readonly pluginId: string; readonly serverId: string }): boolean => value.pluginId === pluginId && value.serverId === server.id;
  const active = facts.snapshot.operations.find(operation => matches(operation.server) && !["completed", "cancelled", "failed"].includes(operation.phase));
  if (active) return { kind: active.kind === "install" ? "installing" : "removing", operation: active };
  const choice = facts.snapshot.selections.find(item => matches(item.server));
  const artifacts = facts.snapshot.artifacts.filter(item => matches(item.artifact.identity.server));
  const current = artifacts.find(item => item.artifact.id === choice?.current);
  if (current) {
    if (current.artifact.identity.target !== nativeTarget) return { kind: "unavailable", reason: "target" };
    return { kind: current.verification === "verified" ? "installed" : "verification-required", status: current };
  }
  // Unselected history, rollback and external content need inspection, not a duplicate install.
  const recoverable = artifacts.filter(item => item.artifact.identity.target === nativeTarget);
  if (recoverable.length) return { kind: "recovery-available", artifactIds: Object.freeze(recoverable.map(item => item.artifact.id)) };
  if (artifacts.length) return { kind: "unavailable", reason: "target" };
  if (!recipe?.available || recipe.providerKey !== key || recipe.target !== nativeTarget) return { kind: "unavailable", reason: "recipe" };
  return { kind: "install-available", providerKey: key };
}
