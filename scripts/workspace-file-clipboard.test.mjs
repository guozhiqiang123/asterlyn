import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceFileClipboard,
  workspaceFileClipboardMatchesPreview,
} from "../src/features/files-editor/workspace-file-clipboard.ts";

function inspection(overrides = {}) {
  return {
    source: {
      workspacePath: "src",
      kind: "directory",
      revision: "revision-1",
      mode: 493,
      byteLength: 12,
    },
    entryCount: 3,
    totalBytes: 12,
    hiddenEntryCount: 1,
    symlinkPaths: [],
    nestedRepositoryPaths: [],
    multipleLinkPaths: [],
    truncated: false,
    fingerprint: "fingerprint-1",
    ...overrides,
  };
}

test("workspace file clipboard is isolated to one exact window workspace generation", () => {
  const clipboard = new WorkspaceFileClipboard();
  const changes = [];
  clipboard.subscribe((entry) => changes.push(entry?.mode ?? null));
  const entry = clipboard.capture("cut", "/workspace", 4, ".", "src", inspection());
  assert.equal(entry.mode, "cut");
  assert.equal(clipboard.current("/workspace", 4), entry);
  assert.equal(clipboard.current("/workspace", 5), null);
  assert.equal(clipboard.current("/other", 4), null);
  clipboard.consume({ ...entry });
  assert.equal(clipboard.entry, entry);
  clipboard.consume(entry);
  assert.equal(clipboard.entry, null);
  assert.deepEqual(changes, ["cut", null]);
});

test("a proven unchanged copy source can advance after successful reconciliation", () => {
  const clipboard = new WorkspaceFileClipboard();
  const entry = clipboard.capture("copy", "/workspace", 4, ".", "src", inspection());
  const advanced = clipboard.advanceGeneration(entry, "/workspace", 5);
  assert.equal(clipboard.current("/workspace", 4), null);
  assert.equal(clipboard.current("/workspace", 5), advanced);
  assert.equal(advanced.inspection.fingerprint, entry.inspection.fingerprint);
});

test("unsafe or incomplete recursive identities never enter the clipboard", () => {
  for (const unsafe of [
    inspection({ truncated: true }),
    inspection({ symlinkPaths: ["src/link"] }),
    inspection({ nestedRepositoryPaths: ["src/nested/.git"] }),
    inspection({ multipleLinkPaths: ["src/hard"] }),
  ]) {
    assert.equal(new WorkspaceFileClipboard().capture("copy", "/workspace", 1, ".", "src", unsafe), null);
  }
});

test("paste accepts only the exact inspected source fingerprint", () => {
  const clipboard = new WorkspaceFileClipboard();
  const source = inspection();
  const entry = clipboard.capture("copy", "/workspace", 1, ".", "src", source);
  assert.equal(workspaceFileClipboardMatchesPreview(entry, {
    source: source.source,
    fingerprint: source.fingerprint,
  }), true);
  assert.equal(workspaceFileClipboardMatchesPreview(entry, {
    source: { ...source.source, revision: "changed" },
    fingerprint: source.fingerprint,
  }), false);
  assert.equal(workspaceFileClipboardMatchesPreview(entry, {
    source: source.source,
    fingerprint: "changed",
  }), false);
});
