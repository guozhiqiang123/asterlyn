import assert from "node:assert/strict";
import test from "node:test";

import {
  fileIconDescriptor,
  fileTypeIcon,
} from "../src/file-icons.ts";

test("common source, build, configuration, and media files receive stable icon kinds", () => {
  const fixtures = [
    ["src/main.ts", "typescript"],
    ["MainActivity.kt", "kotlin"],
    ["build.gradle", "groovy"],
    ["Jenkinsfile", "groovy"],
    ["pom.xml", "build"],
    ["Cargo.toml", "rust"],
    ["Dockerfile", "docker"],
    [".gitignore", "git"],
    ["docs/README.md", "markdown"],
    ["assets/logo.svg", "image"],
    ["unknown.extension-that-is-not-mapped", "generic"],
  ];
  for (const [path, kind] of fixtures) {
    assert.equal(fileIconDescriptor(path).kind, kind, path);
  }
});

test("file icons use one bounded decorative SVG contract without reflecting paths", () => {
  const source = fileTypeIcon('<unsafe name="true">.ts');
  assert.match(source, /<svg class="file-type-icon file-icon-typescript"/u);
  assert.match(source, /width="16" height="16"/u);
  assert.match(source, /aria-hidden="true"/u);
  assert.doesNotMatch(source, /unsafe/u);
});
