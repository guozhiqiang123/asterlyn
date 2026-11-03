// Generated from native serde models by scripts/generate-native-language-contract.mjs. Do not edit.
export type JavaRequirement = {
  readonly "maximumMajorExclusive"?: number | null;
  readonly "minimumMajor": number;
};

export type LanguageFailureCode = "backend-exited" | "protocol-failed" | "resource-limit" | "authority-revoked" | "model-unavailable" | "toolchain-unavailable" | "cancelled" | "unavailable";

export type NativeLanguageServiceFailure = {
  readonly "code": LanguageFailureCode;
  readonly "message": string;
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
