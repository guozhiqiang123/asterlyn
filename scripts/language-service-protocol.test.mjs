import assert from "node:assert/strict";
import test from "node:test";
import { validateDesktopResult } from "../src/protocol/validate-desktop-result.ts";

const review = {
  reviewId: "review-1", pluginId: "dev.asterlyn.lsp", serverId: "typescript", pluginVersion: "1.0.0",
  packageDigest: "sha256:package", resourceDigest: "sha256:resources", executableIdentity: "/usr/local/bin/node@22.22.2", expiresAt: 1_800_000_000_000,
};
const envelope = { sessionId: "session-1", uri: "file:///repo/main.ts", version: 3, result: { contents: "safe" } };

test("accepts complete language-service review and result envelope", () => {
  assert.deepEqual(validateDesktopResult("prepare_language_service", review), review);
  assert.deepEqual(validateDesktopResult("request_language_service", envelope), envelope);
});

test("rejects malformed review identity and bounds", () => {
  for (const value of [
    { ...review, pluginId: "other.plugin" },
    { ...review, serverId: "invalid/server" },
    { ...review, reviewId: "" },
    { ...review, expiresAt: 0 },
    { ...review, executableIdentity: "node\u0000" },
  ]) assert.throws(() => validateDesktopResult("prepare_language_service", value));
});

test("accepts generic packaged server identifiers after native admission", () => {
  const packaged = {...review, serverId: "android-jvm"};
  assert.deepEqual(validateDesktopResult("prepare_language_service", packaged), packaged);
});

test("rejects result envelopes with invalid identity, version, or missing result", () => {
  for (const value of [
    { ...envelope, sessionId: "" },
    { ...envelope, uri: "" },
    { ...envelope, version: 0 },
    { sessionId: envelope.sessionId, uri: envelope.uri, version: envelope.version },
  ]) assert.throws(() => validateDesktopResult("request_language_service", value));
});

test("rejects result payloads over four mebibytes", () => {
  const oversized = { ...envelope, result: { text: "x".repeat(4 * 1024 * 1024) } };
  assert.throws(() => validateDesktopResult("request_language_service", oversized));
});
