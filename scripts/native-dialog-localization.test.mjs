import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chooserSources = [
  "src/adapters/tauri/tauri-shell-bridge.ts",
  "src/adapters/demo/demo-desktop-bridge.ts",
];

test("native directory choosers leave their chrome to the operating system locale", async () => {
  for (const sourcePath of chooserSources) {
    const source = await readFile(sourcePath, "utf8");
    const chooser = source.match(
      /chooseRepositoryDirectory[\s\S]*?openDialog\(\{([\s\S]*?)\}\)/,
    );

    assert.ok(chooser, `${sourcePath} must keep using the native directory dialog`);
    assert.match(chooser[1], /directory:\s*true/);
    assert.doesNotMatch(
      chooser[1],
      /title\s*:/,
      `${sourcePath} must not replace the operating system's localized dialog title`,
    );
  }
});
