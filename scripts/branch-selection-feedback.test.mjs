import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");

test("branch selection feedback is committed before an asynchronous History query starts", () => {
  const start = appSource.indexOf("private applyHistoryQuery");
  const end = appSource.indexOf("private clearWorkingDiff", start);
  const method = appSource.slice(start, end);
  const selection = method.indexOf("updateBranchSelectionRows");
  const read = method.indexOf("loadQuery");

  assert.ok(start >= 0 && end > start);
  assert.ok(selection >= 0);
  assert.ok(read >= 0);
  assert.ok(selection < read);
});
