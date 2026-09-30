export interface StartupBundlePolicyCandidate {
  preserveEntrySignatures: unknown;
  strictExecutionOrder: unknown;
  featureChunk: {
    maxSize: unknown;
    includeDependenciesRecursively: unknown;
  };
}

export const STARTUP_BUNDLE_POLICY = Object.freeze({
  preserveEntrySignatures: "allow-extension" as const,
  strictExecutionOrder: true,
  featureChunk: Object.freeze({
    maxSize: 300_000,
    includeDependenciesRecursively: false,
  }),
});

export function startupBundlePolicyErrors(
  policy: StartupBundlePolicyCandidate,
): string[] {
  const errors: string[] = [];
  if (policy.featureChunk.includeDependenciesRecursively !== false) {
    errors.push("feature chunks must keep recursive dependency grouping disabled");
  }
  if (policy.preserveEntrySignatures !== "allow-extension") {
    errors.push('preserveEntrySignatures must be "allow-extension"');
  }
  if (policy.strictExecutionOrder !== true) {
    errors.push("strictExecutionOrder must be enabled");
  }
  if (
    typeof policy.featureChunk.maxSize !== "number" ||
    !Number.isFinite(policy.featureChunk.maxSize) ||
    policy.featureChunk.maxSize <= 0
  ) {
    errors.push("feature chunk maxSize must be a positive number");
  }
  return errors;
}

export function assertStartupBundlePolicy(
  policy: StartupBundlePolicyCandidate = STARTUP_BUNDLE_POLICY,
): void {
  const errors = startupBundlePolicyErrors(policy);
  if (errors.length > 0) {
    throw new Error(`Unsafe startup bundle policy: ${errors.join("; ")}`);
  }
}
