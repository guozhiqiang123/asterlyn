import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateManagedInstallationSnapshot } from "../src/protocol/managed-language-installation.ts";
import { isNativeLanguageModel } from "../src/protocol/native-language-validation.ts";

const corpus = JSON.parse(readFileSync(new URL("../protocol/fixtures/managed-language-installation.json", import.meta.url), "utf8"));
for (const fixture of corpus.cases) {
  test(`managed installation contract: ${fixture.name}`, () => {
    const snapshot = structuredClone(corpus.base);
    for (const edit of fixture.edits) {
      const parts = edit.path.slice(1).split("/"), key = parts.pop();
      const parent = parts.reduce((value, part) => value[part], snapshot);
      parent[key] = structuredClone(edit.value);
    }
    if (fixture.valid) assert.doesNotThrow(() => validateManagedInstallationSnapshot(snapshot));
    else assert.throws(() => validateManagedInstallationSnapshot(snapshot));
  });
}

test("installation limits reject oversized lists, active jobs and aggregate leases", () => {
  const snapshot = structuredClone(corpus.base);
  assert.throws(() => validateManagedInstallationSnapshot({ ...snapshot, artifacts: Array(65).fill(snapshot.artifacts[0]) }));
  const operation = { id: "job", server: snapshot.selections[0].server, artifactId: snapshot.artifacts[0].artifact.id,
    kind: "install", phase: "cancelled", completedBytes: 0, totalBytes: 16, failure: null };
  assert.throws(() => validateManagedInstallationSnapshot({ ...snapshot, operations: Array.from({ length: 17 }, (_, n) => ({ ...operation, id: `job-${n}` })) }));
  assert.throws(() => validateManagedInstallationSnapshot({ ...snapshot, operations: Array.from({ length: 9 }, (_, n) => ({ ...operation, id: `job-${n}`, phase: "acquiring", server: { ...operation.server, serverId: `server-${n}` } })) }));
  const other = structuredClone(snapshot.artifacts[0]); other.artifact.id = `sha256:${"0".repeat(64)}`;
  other.useCount = 64; snapshot.artifacts[0].useCount = 65;
  assert.throws(() => validateManagedInstallationSnapshot({ ...snapshot, artifacts: [...snapshot.artifacts, other] }));
});

test("strict installation output does not change legacy additive output compatibility", () => {
  const extra = { ...corpus.base, future: true };
  assert.equal(isNativeLanguageModel("ManagedInstallationSnapshot", extra), true);
  assert.equal(isNativeLanguageModel("ManagedInstallationSnapshot", extra, [], true), false);
  const optional = structuredClone(corpus.base); delete optional.selections[0].rollback;
  assert.doesNotThrow(() => validateManagedInstallationSnapshot(optional));
});
