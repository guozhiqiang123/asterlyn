import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const gitSourceRoot = new URL("../crates/asterlyn-git/src/", import.meta.url);
const directGitCommand = /(?:std::process::)?Command::new\s*\(\s*"git"\s*\)/g;
const directSpawn = /\.spawn\s*\(\s*\)/g;

test("production Git subprocesses stay behind the process boundary", async () => {
  const entries = await readdir(gitSourceRoot, { withFileTypes: true });
  const rustFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rs"))
    .map((entry) => entry.name)
    .sort();

  for (const file of rustFiles) {
    const source = await readFile(new URL(file, gitSourceRoot), "utf8");
    const productionSource = source.split(/\n#\[cfg\(test\)\]\s*\n/u, 1)[0];
    if (file === "process.rs") {
      assert.equal(
        productionSource.match(directGitCommand)?.length ?? 0,
        1,
        "process.rs must keep one auditable Git executable construction point",
      );
      assert.equal(
        productionSource.match(directSpawn)?.length ?? 0,
        1,
        "process.rs must keep one auditable subprocess spawn point",
      );
      continue;
    }

    assert.doesNotMatch(
      productionSource,
      directGitCommand,
      `${file} constructs Git outside process.rs`,
    );
    assert.doesNotMatch(
      productionSource,
      directSpawn,
      `${file} spawns a subprocess outside process.rs`,
    );
  }
});
