import assert from "node:assert/strict";
import test from "node:test";

import {
  ANDROID_GRADLE_DETECTOR_LIMITS,
  detectAndroidGradleEvidence,
} from "../src/plugins/android-gradle/detector.ts";

const detect = (paths, platform = "posix") => detectAndroidGradleEvidence({
  workspaceRoot: "/workspace/project",
  generation: 7,
  platform,
  files: paths.map((workspacePath) => ({ workspacePath })),
});

test("detects Android Gradle evidence and returns stable sorted paths", () => {
  const result = detect([
    "app/src/main/AndroidManifest.xml",
    "gradlew",
    "build.gradle.kts",
    "settings.gradle.kts",
    "gradle/wrapper/gradle-wrapper.properties",
  ]);
  assert.equal(result.gradle, true);
  assert.equal(result.android, true);
  assert.equal(result.wrapper, "gradlew");
  assert.deepEqual(result.evidence, [
    "app/src/main/AndroidManifest.xml",
    "build.gradle.kts",
    "gradle/wrapper/gradle-wrapper.properties",
    "gradlew",
    "settings.gradle.kts",
  ]);
  assert.equal(result.generation, 7);
});

test("distinguishes ordinary Gradle from Android", () => {
  const result = detect(["settings.gradle", "build.gradle", "gradlew.bat"]);
  assert.equal(result.gradle, true);
  assert.equal(result.android, false);
  assert.equal(result.wrapper, "gradlew.bat");
});

test("does not infer Gradle or Android from unrelated files", () => {
  assert.equal(detect(["README.md", "src/main/AndroidManifest.xml"]).android, false);
  assert.equal(detect(["README.md"]).gradle, false);
});

test("requires a root wrapper when wrapper metadata is present only in a module", () => {
  const result = detect(["app/gradlew", "app/gradle/wrapper/gradle-wrapper.properties"]);
  assert.equal(result.wrapper, null);
  assert.equal(result.gradle, false);
});

test("supports KTS and multi-module Android manifests", () => {
  const result = detect([
    "settings.gradle.kts",
    "build.gradle.kts",
    "feature/login/src/main/AndroidManifest.xml",
    "library/src/main/java/com/example/Thing.kt",
  ]);
  assert.equal(result.android, true);
});

test("requires the literal src/main/AndroidManifest.xml suffix", () => {
  const result = detect(["settings.gradle", "foo/main/AndroidManifest.xml"]);
  assert.equal(result.gradle, true);
  assert.equal(result.android, false);
});

test("POSIX paths keep backslashes as ordinary filename characters", () => {
  const result = detect(["settings.gradle", "app\\src\\main\\AndroidManifest.xml"]);
  assert.equal(result.gradle, true);
  assert.equal(result.android, false);
});

test("normalizes Windows paths but stays fail-closed for traversal and absolute paths", () => {
  const result = detect([
    "SETTINGS.GRADLE.KTS",
    "APP\\SRC\\MAIN\\ANDROIDMANIFEST.XML",
    "GRADLEW.BAT",
    "..\\settings.gradle",
    "C:\\project\\build.gradle",
    "/workspace/build.gradle",
    "app//src/main/AndroidManifest.xml",
  ], "windows");
  assert.equal(result.gradle, true);
  assert.equal(result.android, true);
  assert.equal(result.wrapper, "gradlew.bat");
  assert.deepEqual(result.evidence, [
    "app/src/main/androidmanifest.xml",
    "gradlew.bat",
    "settings.gradle.kts",
  ]);
});

test("deduplicates paths deterministically", () => {
  const result = detect(["gradlew", "gradlew", "settings.gradle", "settings.gradle"]);
  assert.deepEqual(result.evidence, ["gradlew", "settings.gradle"]);
});

test("ignores malformed paths and rejects over-limit catalogs instead of guessing", () => {
  const malformed = detect(["settings.gradle", "bad\0path"]);
  assert.equal(malformed.bounded, true);
  assert.equal(malformed.gradle, true);
  const tooMany = detect(Array.from({ length: ANDROID_GRADLE_DETECTOR_LIMITS.maxPaths + 1 }, (_, i) => `f${i}`));
  assert.equal(tooMany.bounded, false);
  assert.equal(tooMany.android, false);
});

test("rejects overlong paths", () => {
  const result = detect(["settings.gradle", "x".repeat(ANDROID_GRADLE_DETECTOR_LIMITS.maxPathLength + 1)]);
  assert.equal(result.bounded, true);
  assert.equal(result.gradle, true);
});
