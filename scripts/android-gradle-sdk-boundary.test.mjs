import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = ["detector.ts", "discovery.ts", "execution.ts", "index.ts", "plugin.ts", "quick-actions.ts", "sdk-compat.ts", "task-cache.ts"];

test("Android Gradle plugin has no host deep imports", async () => {
  for (const file of files) {
    const source = await readFile(new URL(`../src/plugins/android-gradle/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*\/(?:application|features|models|protocol)\//u, file);
    assert.doesNotMatch(source, /from ["']\.\.\/\.\.\/models\.ts["']/u, file);
  }
});
