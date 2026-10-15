import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeAndroidGradleCachePayload,
  encodeAndroidGradleCachePayload,
  fingerprintPaths,
  intersectsFingerprintPaths,
} from "../src/plugins/android-gradle/task-cache.ts";

const task = { id: ":app:assembleDebug", label: ":app:assembleDebug", group: "Build tasks", projectPath: ":app", description: "assemble", runnable: true, runState: "succeeded" };

test("cache codec round-trips declarative tasks and strips run state", () => {
  const quickTask = { ...task, androidQuickAction: { kind: "assemble", module: ":app", variant: "Debug" } };
  const encoded = encodeAndroidGradleCachePayload([quickTask], "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks");
  const decoded = decodeAndroidGradleCachePayload(encoded, "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks");
  assert.deepEqual(decoded, [{ id: task.id, label: task.label, group: task.group, projectPath: task.projectPath, description: task.description, runnable: false, androidQuickAction: quickTask.androidQuickAction }]);
  assert.equal(decodeAndroidGradleCachePayload(encoded, "other", "0.1.0", "gradle-tasks"), null);
});

test("cache codec rejects schema identity, malformed payload, and oversized task metadata", () => {
  const encoded = encodeAndroidGradleCachePayload([task], "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks");
  assert.equal(decodeAndroidGradleCachePayload(`${encoded.slice(0, -2)}!!`, "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks"), null);
  assert.equal(decodeAndroidGradleCachePayload(btoa(JSON.stringify({ schemaVersion: 2, tasks: [] })), "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks"), null);
  const duplicate = JSON.parse(atob(encoded));
  duplicate.tasks.push(duplicate.tasks[0]);
  assert.equal(decodeAndroidGradleCachePayload(btoa(JSON.stringify(duplicate)), "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks"), null);
  const liveState = JSON.parse(atob(encoded));
  liveState.tasks[0].runState = "succeeded";
  assert.equal(decodeAndroidGradleCachePayload(btoa(JSON.stringify(liveState)), "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks"), null);
});

test("fingerprint catalog is bounded to Gradle and Android configuration paths", () => {
  const paths = fingerprintPaths([
    { workspacePath: "settings.gradle.kts" },
    { workspacePath: "app/build.gradle" },
    { workspacePath: "gradle/libs.versions.toml" },
    { workspacePath: "gradle/custom.versions.toml" },
    { workspacePath: "buildSrc/src/main/kotlin/Versions.kt" },
    { workspacePath: "app/src/main/AndroidManifest.xml" },
    { workspacePath: "src/MainActivity.kt" },
    { workspacePath: "../outside.gradle" },
  ], "posix");
  assert.deepEqual(paths, ["app/build.gradle", "app/src/main/AndroidManifest.xml", "buildSrc/src/main/kotlin/Versions.kt", "gradle/custom.versions.toml", "gradle/libs.versions.toml", "settings.gradle.kts"]);
  assert.equal(intersectsFingerprintPaths(paths, ["src/MainActivity.kt"], "posix"), false);
  assert.equal(intersectsFingerprintPaths(paths, ["app/build.gradle"], "posix"), true);
  assert.equal(intersectsFingerprintPaths(paths, ["gradle/new.versions.toml"], "posix"), true);
});
