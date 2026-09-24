import assert from "node:assert/strict";
import test from "node:test";
import { isValidGitBranchName, validateGitBranchName } from "../src/features/remote-push/git-branch-name.ts";

test("isValidGitBranchName accepts valid git branch names", () => {
  assert.equal(isValidGitBranchName("main"), true);
  assert.equal(isValidGitBranchName("feature/cool-stuff"), true);
  assert.equal(isValidGitBranchName("user/feat_123.test"), true);
  assert.equal(isValidGitBranchName("release-v1.0.0"), true);
  assert.equal(isValidGitBranchName("origin"), true);
});

test("isValidGitBranchName rejects invalid git branch names", () => {
  assert.equal(isValidGitBranchName(""), false);
  assert.equal(isValidGitBranchName("   "), false);
  assert.equal(isValidGitBranchName("HEAD"), false);
  assert.equal(isValidGitBranchName("-abc"), false);
  assert.equal(isValidGitBranchName("abc..def"), false);
  assert.equal(isValidGitBranchName("abc def"), false);
  assert.equal(isValidGitBranchName("abc~1"), false);
  assert.equal(isValidGitBranchName("abc/def."), false);
  assert.equal(isValidGitBranchName("abc.lock"), false);
  assert.equal(isValidGitBranchName("abc/.lock"), false);
  assert.equal(isValidGitBranchName("/abc"), false);
  assert.equal(isValidGitBranchName("abc/"), false);
  assert.equal(isValidGitBranchName("abc//def"), false);
  assert.equal(isValidGitBranchName("abc:def"), false);
  assert.equal(isValidGitBranchName("abc?def"), false);
  assert.equal(isValidGitBranchName("abc*def"), false);
  assert.equal(isValidGitBranchName("abc[def"), false);
  assert.equal(isValidGitBranchName("abc\\def"), false);
  assert.equal(isValidGitBranchName("abc@{def"), false);
  assert.equal(isValidGitBranchName(".abc"), false);
  assert.equal(isValidGitBranchName("abc/.def"), false);
});
