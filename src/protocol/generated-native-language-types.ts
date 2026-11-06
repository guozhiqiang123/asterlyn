// Generated from native serde models by scripts/generate-native-language-contract.mjs. Do not edit.
export type JavaRequirement = {
  readonly "maximumMajorExclusive"?: number | null;
  readonly "minimumMajor": number;
};

export type LanguageFailureCode = "backend-exited" | "protocol-failed" | "resource-limit" | "authority-revoked" | "model-unavailable" | "toolchain-unavailable" | "cancelled" | "unavailable";

export type LanguageResourcePolicy = {
  readonly "budgetMiB": number;
  readonly "choicesMiB": ReadonlyArray<number>;
  readonly "compilerMaxMiB"?: number | null;
  readonly "maxHeapMiB": number;
  readonly "physicalMiB": number;
  readonly "schema": number;
};

export type ManagedArtifact = {
  readonly "archiveDigest": string;
  readonly "contentDigest": string;
  readonly "recipeDigest": string;
  readonly "server": ManagedServerId;
  readonly "target": string;
  readonly "version": string;
};

export type ManagedArtifactOwnership = "managed" | "external";

export type ManagedArtifactStatus = {
  readonly "artifact": ManagedInstalledArtifact;
  readonly "useCount": number;
  readonly "verification": ManagedArtifactVerification;
};

export type ManagedArtifactVerification = "required" | "verified";

export type ManagedInstallationIndex = {
  readonly "artifacts": ReadonlyArray<ManagedInstalledArtifact>;
  readonly "revision": number;
  readonly "schemaVersion": number;
  readonly "selections": ReadonlyArray<ManagedServerSelection>;
};

export type ManagedInstallationSnapshot = {
  readonly "artifacts": ReadonlyArray<ManagedArtifactStatus>;
  readonly "epoch": string;
  readonly "indexRevision": number;
  readonly "operations": ReadonlyArray<ManagedInstallOperation>;
  readonly "protocolVersion": number;
  readonly "revision": number;
  readonly "selections": ReadonlyArray<ManagedServerSelection>;
};

export type ManagedInstalledArtifact = {
  readonly "id": string;
  readonly "identity": ManagedArtifact;
  readonly "ownership": ManagedArtifactOwnership;
};

export type ManagedInstallError = "invalid-request" | "unsupported-schema" | "permission-denied" | "stale-review" | "expired-review" | "not-found" | "busy" | "resource-limit" | "integrity-mismatch" | "storage-failed" | "protected-artifact" | "external-artifact" | "in-use" | "cancelled" | "invalid-transition" | "unverified" | "state-changed";

export type ManagedInstallOperation = {
  readonly "artifactId": string;
  readonly "completedBytes": number;
  readonly "failure"?: (ManagedInstallError) | (null);
  readonly "id": string;
  readonly "kind": ManagedOperationKind;
  readonly "phase": ManagedOperationPhase;
  readonly "server": ManagedServerId;
  readonly "totalBytes": number;
};

export type ManagedOperationKind = "install" | "remove";

export type ManagedOperationPhase = "acquiring" | "verifying" | "committing" | "waiting-for-uses" | "completed" | "cancelled" | "failed";

export type ManagedServerId = {
  readonly "pluginId": string;
  readonly "serverId": string;
};

export type ManagedServerSelection = {
  readonly "current"?: string | null;
  readonly "rollback"?: string | null;
  readonly "server": ManagedServerId;
};

export type NativeLanguageServiceFailure = {
  readonly "code": LanguageFailureCode;
  readonly "message": string;
  readonly "project"?: (ProjectFailure) | (null);
  readonly "requestId"?: string | null;
  readonly "retryable": boolean;
};

export type NativeLanguageServiceReview = {
  readonly "executableIdentity": string;
  readonly "expiresAt": number;
  readonly "packageDigest": string;
  readonly "pluginId": string;
  readonly "pluginVersion": string;
  readonly "remembered": boolean;
  readonly "resourceDigest": string;
  readonly "reviewId": string;
  readonly "serverId": string;
  readonly "toolchains": ReadonlyArray<ToolchainSnapshot>;
};

export type ProjectFailure = {
  readonly "dependency"?: string | null;
  readonly "kind": ProjectFailureKind;
  readonly "module"?: string | null;
  readonly "remaining"?: number;
};

export type ProjectFailureKind = "dependency-offline" | "dependency-unavailable" | "dependency-tls" | "dependency-dns" | "repository-credentials-missing" | "android-sdk-missing" | "project-configuration-failed" | "project-script-failed" | "model-selected-variant-missing" | "model-dependency-variant-missing" | "model-dependency-variant-ambiguous";

export type SymbolCandidate = {
  readonly "extractorId": string;
  readonly "kind": SymbolKind;
  readonly "name": string;
  readonly "overlay": boolean;
  readonly "range": SymbolRange;
  readonly "revision": string;
  readonly "workspacePath": string;
};

export type SymbolKind = "class" | "interface" | "enum" | "struct" | "object" | "function" | "constant" | "variable" | "module" | "type";

export type SymbolOverlay = {
  readonly "text"?: string | null;
  readonly "workspacePath": string;
};

export type SymbolPosition = {
  readonly "character": number;
  readonly "line": number;
};

export type SymbolQueryReport = {
  readonly "filesScanned": number;
  readonly "filesTotal": number;
  readonly "identity": string;
  readonly "matches": ReadonlyArray<SymbolCandidate>;
  readonly "partial": boolean;
  readonly "reasons": ReadonlyArray<string>;
  readonly "reusedFiles": number;
  readonly "scopeToken"?: string | null;
  readonly "skippedFiles": number;
};

export type SymbolRange = {
  readonly "end": SymbolPosition;
  readonly "start": SymbolPosition;
};

export type ToolchainRole = "build-runtime" | "build-model" | "language-server";

export type ToolchainSnapshot = {
  readonly "executable": string;
  readonly "home": string;
  readonly "id": string;
  readonly "identity": string;
  readonly "major": number;
  readonly "requirement": JavaRequirement;
  readonly "role": ToolchainRole;
  readonly "selectionReason": string;
  readonly "source": ToolchainSource;
  readonly "version": string;
};

export type ToolchainSource = "installed" | "environment" | "project" | "user" | "command-line";
