import assert from "node:assert/strict";
import test from "node:test";

import { deriveGradleQuickActions, gradleTaskArtifactHints, resolveGradleQuickAction } from "../src/plugins/android-gradle/quick-actions.ts";

const ready = (tasks) => ({ status: "ready", tasks });
const task = (id, runnable = true) => ({ id, label: id, group: "Build tasks", projectPath: id.slice(0, id.lastIndexOf(":")) || ":", runnable });

test("derives exact root and module actions without inventing tasks", () => {
  const result = deriveGradleQuickActions(ready([
    task(":assembleDebug"), task(":bundleRelease"), task(":installDebug"), task(":uninstallDebug"),
    task(":app:assembleRelease"), task(":app:bundleRelease"), task(":app:installRelease"), task(":app:uninstallRelease"),
    task(":assemble"), task(":app:compileDebugKotlin"), task(":app:assembleDebug", false),
  ]));
  assert.deepEqual(result.actions.map(({ taskId, module, variant, kind }) => ({ taskId, module, variant, kind })), [
    { taskId: ":app:assembleRelease", module: ":app", variant: "Release", kind: "assemble" },
    { taskId: ":app:bundleRelease", module: ":app", variant: "Release", kind: "bundle" },
    { taskId: ":app:installRelease", module: ":app", variant: "Release", kind: "install" },
    { taskId: ":app:uninstallRelease", module: ":app", variant: "Release", kind: "uninstall" },
    { taskId: ":assembleDebug", module: ":", variant: "Debug", kind: "assemble" },
    { taskId: ":bundleRelease", module: ":", variant: "Release", kind: "bundle" },
    { taskId: ":installDebug", module: ":", variant: "Debug", kind: "install" },
    { taskId: ":uninstallDebug", module: ":", variant: "Debug", kind: "uninstall" },
  ]);
});

test("non-ready and non-runnable snapshots are empty", () => {
  assert.deepEqual(deriveGradleQuickActions({ status: "loading", tasks: [] }), { status: "ready", actions: [], selections: [] });
  assert.equal(deriveGradleQuickActions(ready([task(":app:assembleDebug", false)])).actions.length, 0);
});

test("same variant across modules returns candidates and never guesses", () => {
  const result = deriveGradleQuickActions(ready([task(":app:installDebug"), task(":demo:installDebug"), task(":installDebug")]));
  assert.equal(result.selections.length, 1);
  assert.deepEqual(resolveGradleQuickAction(result, "install", "Debug"), { status: "ambiguous", candidates: result.selections[0].candidates });
  assert.equal(resolveGradleQuickAction(result, "install", "Debug", ":app").status, "resolved");
  assert.equal(resolveGradleQuickAction(result, "install", "Release").status, "not-found");
});

test("deduplicates, sorts deterministically, and bounds ambiguous candidates", () => {
  const tasks = Array.from({ length: 700 }, (_, index) => task(`:m${String(index).padStart(3, "0")}:assembleDebug`));
  tasks.push(task(":m001:assembleDebug"));
  const result = deriveGradleQuickActions(ready(tasks));
  assert.equal(result.actions.length, 32);
  assert.equal(result.selections[0].candidates.length, 32);
  assert.equal(new Set(result.actions.map((action) => action.id)).size, result.actions.length);
  assert.deepEqual(result.actions.slice(0, 3).map((action) => action.taskId), [":m000:assembleDebug", ":m001:assembleDebug", ":m002:assembleDebug"]);
});

test("reserves bounded capacity for every quick-action kind", () => {
  const tasks = [
    ...Array.from({ length: 600 }, (_, index) => task(`:m${String(index).padStart(3, "0")}:assembleVariant${index}`)),
    task(":app:bundleDebug"),
    task(":app:installDebug"),
    task(":app:uninstallDebug"),
  ];
  const result = deriveGradleQuickActions(ready(tasks));
  assert.equal(result.actions.filter((action) => action.kind === "assemble").length, 128);
  assert.deepEqual(result.actions.filter((action) => action.kind !== "assemble").map((action) => action.kind), ["bundle", "install", "uninstall"]);
});

test("build actions derive only their exact conventional bounded output directory", () => {
  assert.deepEqual(gradleTaskArtifactHints(":assembleDebug"), ["build/outputs/apk"]);
  assert.deepEqual(gradleTaskArtifactHints(":app:bundleRelease"), ["app/build/outputs/bundle"]);
  assert.deepEqual(gradleTaskArtifactHints(":features:demo:assembleDebug"), ["features/demo/build/outputs/apk"]);
  assert.deepEqual(gradleTaskArtifactHints(":app:installDebug"), []);
  assert.deepEqual(gradleTaskArtifactHints(":../app:assembleDebug"), []);
});
