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
