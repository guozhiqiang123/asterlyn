import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const architectureBaseline = JSON.parse(
  await readFile(new URL("./rust-architecture-baseline.json", import.meta.url), "utf8"),
);

test("every oversized production Rust source has non-growing ownership", async () => {
  const files = await rustFiles([
    path.join(repositoryRoot, "crates"),
    path.join(repositoryRoot, "src-tauri", "src"),
  ]);
  const reviewed = architectureBaseline.sourceOwnership;
  const oversized = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = portablePath(path.relative(repositoryRoot, file));
    const lines = lineCount(source);
    if (lines <= architectureBaseline.sourceReviewThreshold) continue;
    oversized.set(relative, lines);
    const review = reviewed[relative];
    assert.ok(review, `${relative} reached ${lines} lines without a named ownership review`);
    assert.ok(review.owner?.trim(), `${relative} has no named owner`);
    assert.ok(review.disposition?.trim(), `${relative} has no review disposition`);
    assert.ok(
      lines <= review.maximumLines,
      `${relative} grew from its reviewed ${review.maximumLines}-line ceiling to ${lines} lines`,
    );
  }
  assert.deepEqual(
    [...Object.keys(reviewed)].sort(),
    [...oversized.keys()].sort(),
    "the Rust ownership baseline must exactly match current files above the review trigger",
  );
});

test("Git credential policy stays outside the repository orchestration module", async () => {
  const repository = await readFile(
    path.join(repositoryRoot, "crates/asterlyn-git/src/repository.rs"),
    "utf8",
  );
  const credential = await readFile(
    path.join(repositoryRoot, "crates/asterlyn-git/src/credential.rs"),
    "utf8",
  );
  assert.doesNotMatch(repository, /fn credential_input|fn credential_output_has_secret/);
  assert.match(repository, /CredentialService::discover/);
  assert.match(credential, /struct CredentialService/);
  assert.match(credential, /remote_with_credential_helper/);
});

async function rustFiles(roots) {
  const files = [];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) files.push(...await rustFiles([target]));
      else if (entry.isFile() && entry.name.endsWith(".rs")) files.push(target);
    }
  }
  return files;
}

function lineCount(source) {
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}
