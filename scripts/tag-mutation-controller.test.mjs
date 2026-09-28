import assert from "node:assert/strict";
import test from "node:test";

import { TagMutationController } from "../src/features/git-history/tag-mutation-controller.ts";
import { renderTagMutationDialog } from "../src/features/git-history/tag-mutation-view.ts";
import { EN_US_TAG_MUTATION_COPY } from "../src/localization/tag-mutation-copy.ts";

const target = {
  repositoryRoot: "/repo",
  commitOid: "a".repeat(40),
  commitSubject: "Release candidate",
};

test("new tag requires a name and executes against the exact selected commit", async () => {
  const requests = [];
  const controller = new TagMutationController({
    execute: async (request) => { requests.push(request); return true; },
    errorMessage: String,
  });
  controller.open(target, "create");
  await controller.submit();
  assert.equal(controller.state.error, "tag-name-required");
  controller.updateTagName("v1.0");
  await controller.submit();
  assert.deepEqual(requests, [{
    kind: "create", tagName: "v1.0", commitOid: target.commitOid, remote: null,
  }]);
  assert.equal(controller.state, null);
});

test("local and remote tag deletion remain explicit reviewed actions", async () => {
  const requests = [];
  const controller = new TagMutationController({
    execute: async (request) => { requests.push(request); return true; },
    errorMessage: String,
  });
  controller.open(target, "deleteLocal", "v1.0");
  const local = renderTagMutationDialog(controller.state, EN_US_TAG_MUTATION_COPY);
  assert.match(local, /Delete Local Tag/);
  assert.match(local, /remote is retained/);
  await controller.submit();
  controller.open(target, "deleteRemote", "v1.0", "origin");
  const remote = renderTagMutationDialog(controller.state, EN_US_TAG_MUTATION_COPY);
  assert.match(remote, /Delete Remote Tag/);
  assert.match(remote, /<code>origin<\/code>/);
  await controller.submit();
  assert.deepEqual(requests, [
    { kind: "deleteLocal", tagName: "v1.0", commitOid: target.commitOid, remote: null },
    { kind: "deleteRemote", tagName: "v1.0", commitOid: target.commitOid, remote: "origin" },
  ]);
});

test("failed tag mutations keep the review open with the localized error", async () => {
  const controller = new TagMutationController({
    execute: async () => { throw new Error("remote moved"); },
    errorMessage: (error) => error.message,
  });
  controller.open(target, "deleteRemote", "v1.0", "origin");
  await controller.submit();
  assert.equal(controller.state.error, "remote moved");
  assert.equal(controller.state.busy, false);
});
