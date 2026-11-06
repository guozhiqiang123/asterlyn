import assert from "node:assert/strict";
import test from "node:test";
import { validateManagedLanguageEnvironment } from "../src/protocol/managed-language-environment.ts";

const empty = {
  protocolVersion: 1,
  platform: "macos-arm64",
  target: "aarch64-apple-darwin",
  installation: {
    protocolVersion: 1, epoch: "host-1", revision: 0, indexRevision: 0,
    artifacts: [], selections: [], operations: [],
  },
};

test("managed language environment accepts one exact validated native snapshot", () => {
  assert.equal(validateManagedLanguageEnvironment(empty), empty);
});

test("managed language environment rejects unknown platforms, targets and fields", () => {
  assert.throws(() => validateManagedLanguageEnvironment({ ...empty, platform: "darwin-arm64" }));
  assert.throws(() => validateManagedLanguageEnvironment({ ...empty, target: "AARCH64 Apple" }));
  assert.throws(() => validateManagedLanguageEnvironment({ ...empty, extra: true }));
  assert.throws(() => validateManagedLanguageEnvironment({ ...empty, installation: { ...empty.installation, epoch: "" } }));
});
