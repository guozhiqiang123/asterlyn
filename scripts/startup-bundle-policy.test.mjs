import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStartupBundlePolicy,
  STARTUP_BUNDLE_POLICY,
  startupBundlePolicyErrors,
} from "../build/startup-bundle-policy.ts";

test("accepts the production startup bundle policy", () => {
  assert.deepEqual(startupBundlePolicyErrors(STARTUP_BUNDLE_POLICY), []);
  assert.doesNotThrow(() => assertStartupBundlePolicy());
});

test("rejects execution-order settings that can produce cyclic startup chunks", () => {
  const unsafePolicy = {
    ...STARTUP_BUNDLE_POLICY,
    preserveEntrySignatures: false,
    strictExecutionOrder: false,
  };

  assert.deepEqual(startupBundlePolicyErrors(unsafePolicy), [
    'preserveEntrySignatures must be "allow-extension"',
    "strictExecutionOrder must be enabled",
  ]);
  assert.throws(
    () => assertStartupBundlePolicy(unsafePolicy),
    /Unsafe startup bundle policy.*preserveEntrySignatures.*strictExecutionOrder/u,
  );
});

test("rejects recursive feature grouping and invalid chunk limits", () => {
  assert.deepEqual(
    startupBundlePolicyErrors({
      ...STARTUP_BUNDLE_POLICY,
      featureChunk: {
        maxSize: 0,
        includeDependenciesRecursively: true,
      },
    }),
    [
      "feature chunks must keep recursive dependency grouping disabled",
      "feature chunk maxSize must be a positive number",
    ],
  );
});
