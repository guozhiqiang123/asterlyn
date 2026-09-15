import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPathCopyGroup,
  commitCopyAction,
  copyCommandItem,
  referenceCopyAction,
  textForCopyAction,
  workspacePathCopyActions,
} from "../src/shared/context-menu/context-menu-copy-actions.ts";
import { writeClipboardText } from "../src/application/text-clipboard.ts";
import {
  createBrowserTextClipboardAdapter,
} from "../src/adapters/browser/browser-text-clipboard-adapter.ts";

const labels = {
  copy: "Copy",
  fileName: "File name",
  relativePath: "Relative path",
  absolutePath: "Absolute path",
};

test("path copy actions derive three exact values without filesystem access", () => {
  const unix = workspacePathCopyActions(
    "files",
    { workspaceRoot: "/work/project/", workspacePath: "/src/app.ts/" },
    labels,
  );
  assert.deepEqual(unix.map(({ actionId, text }) => [actionId, text]), [
    ["files.copy-name", "app.ts"],
    ["files.copy-relative-path", "src/app.ts"],
    ["files.copy-absolute-path", "/work/project/src/app.ts"],
  ]);
  assert.equal(textForCopyAction(unix, "files.copy-relative-path"), "src/app.ts");
  assert.equal(textForCopyAction(unix, "files.unknown"), null);

  const windows = workspacePathCopyActions(
    "files",
    { workspaceRoot: "C:\\work\\project\\", workspacePath: "src/api.ts" },
    labels,
  );
  assert.equal(windows[2]?.text, "C:\\work\\project\\src\\api.ts");
  assert.deepEqual(buildPathCopyGroup("files.copy", labels, unix).children, unix.map(copyCommandItem));
});

test("ref and commit builders preserve full unambiguous identities", () => {
  const ref = referenceCopyAction("branches", "Copy branch", "refs/remotes/origin/main");
  const commit = commitCopyAction("history", "Copy commit ID", "a".repeat(40));
  assert.equal(ref.text, "refs/remotes/origin/main");
  assert.equal(commit.text, "a".repeat(40));
  assert.equal(copyCommandItem(commit).actionId, "history.copy-commit-id");
});

test("text clipboard reports success and retains the original failure", async () => {
  const values = [];
  assert.deepEqual(await writeClipboardText({
    writeText: async (text) => { values.push(text); },
  }, "exact text"), { status: "copied" });
  assert.deepEqual(values, ["exact text"]);

  const error = new Error("clipboard denied");
  const failure = await writeClipboardText({
    writeText: async () => { throw error; },
  }, "not copied");
  assert.equal(failure.status, "failure");
  assert.equal(failure.reason, "write-failed");
  assert.equal(failure.error, error);
  assert.deepEqual(await createBrowserTextClipboardAdapter({}).writeText("text"), {
    status: "failure",
    reason: "unavailable",
  });
});
