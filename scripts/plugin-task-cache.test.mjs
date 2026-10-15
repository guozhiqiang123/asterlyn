import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePluginTaskCacheCleanup,
  parsePluginTaskCacheMutation,
  parsePluginTaskCacheRead,
  parseWorkspaceFingerprint,
} from "../src/protocol/plugin-task-cache.ts";
import { validateDesktopResult } from "../src/protocol/validate-desktop-result.ts";

const digest = "a".repeat(64);
const payload = Buffer.from("snapshot").toString("base64");

test("parses bounded workspace fingerprints and cache outcomes", () => {
  const fingerprint = {
    protocolVersion: 1,
    workspaceRoot: "/repo",
    algorithm: "sha256",
    digest,
    files: [
      { path: "build.gradle", status: "present", byteLength: 3, digest, modifiedAtEpochMs: 10 },
      { path: "gradle.properties", status: "missing", byteLength: 0, digest: null, modifiedAtEpochMs: null },
    ],
    truncated: false,
    reason: null,
    status: "ready",
    os: "linux",
    arch: "x86_64",
    javaHomeDigest: null,
  };
  fingerprint.files[0].modifiedAtEpochMs = 10;
  assert.deepEqual(parseWorkspaceFingerprint(fingerprint), fingerprint);
  const read = { protocolVersion: 1, status: "fresh", pluginId: "dev.plugin", providerId: "tasks", fingerprint, payloadBase64: payload, updatedAtEpochMs: 10, lastAccessEpochMs: 11, staleReason: null, dirtyReason: null };
  assert.deepEqual(parsePluginTaskCacheRead(read), read);
  assert.equal(parsePluginTaskCacheMutation({ protocolVersion: 1, status: "stored", pluginId: "dev.plugin", providerId: "tasks", fingerprint, payloadBase64: payload, updatedAtEpochMs: 10, lastAccessEpochMs: 11, dirtyReason: null }).status, "stored");
  assert.equal(parsePluginTaskCacheCleanup({ protocolVersion: 1, status: "cleaned", entries: 1, totalBytes: 8 }).entries, 1);
});

test("rejects unsafe paths, malformed payloads, and oversized snapshots", () => {
  const base = { protocolVersion: 1, workspaceRoot: "/repo", algorithm: "sha256", digest, files: [], truncated: false, reason: null, status: "ready", os: "linux", arch: "x86_64", javaHomeDigest: null };
  for (const path of ["../build.gradle", "/tmp/build.gradle", "build\\gradle"]) {
    assert.throws(() => parseWorkspaceFingerprint({ ...base, files: [{ path, status: "missing", byteLength: 0, digest: null, modifiedAtEpochMs: null }] }), /relative|normalized/u);
  }
  assert.throws(() => parsePluginTaskCacheRead({ protocolVersion: 1, status: "fresh", pluginId: "dev.plugin", providerId: "tasks", fingerprint: base, payloadBase64: "bad", updatedAtEpochMs: 10, lastAccessEpochMs: 10, staleReason: null, dirtyReason: null }), /base64/u);
  assert.throws(() => parsePluginTaskCacheRead({ protocolVersion: 1, status: "fresh", pluginId: "dev.plugin", providerId: "tasks", fingerprint: base, payloadBase64: Buffer.alloc(16 * 1024 * 1024 + 1).toString("base64"), updatedAtEpochMs: 10, lastAccessEpochMs: 10, staleReason: null, dirtyReason: null }), /limit/u);
  assert.throws(() => parsePluginTaskCacheRead({ protocolVersion: 2, status: "miss", pluginId: "dev.plugin", providerId: "tasks", fingerprint: null, payloadBase64: null, updatedAtEpochMs: null, lastAccessEpochMs: null, staleReason: null, dirtyReason: null }), /protocol version/u);
  assert.throws(() => parsePluginTaskCacheRead({ protocolVersion: 1, status: "fresh", pluginId: "Dev.Plugin", providerId: "tasks", fingerprint: base, payloadBase64: payload, updatedAtEpochMs: 10, lastAccessEpochMs: 10, staleReason: null, dirtyReason: null }), /pluginId/u);
  assert.equal(parsePluginTaskCacheRead({ protocolVersion: 1, status: "dirty", pluginId: "dev.plugin", providerId: "tasks", fingerprint: base, payloadBase64: payload, updatedAtEpochMs: 10, lastAccessEpochMs: 11, staleReason: null, dirtyReason: "watcher-ambiguous" }).dirtyReason, "watcher-ambiguous");
});

test("desktop result validation routes cache protocol validators", () => {
  assert.equal(validateDesktopResult("cleanup_plugin_task_cache", { protocolVersion: 1, status: "cleaned", entries: 0, totalBytes: 0 }).status, "cleaned");
  assert.equal(validateDesktopResult("read_plugin_task_cache", { protocolVersion: 1, status: "miss", pluginId: "dev.plugin", providerId: "tasks", fingerprint: null, payloadBase64: null, updatedAtEpochMs: null, lastAccessEpochMs: null, staleReason: null, dirtyReason: null }).status, "miss");
});
