import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { TasksController } from "../src/features/tasks/tasks-controller.ts";
import { renderTasksView, TASKS_RENDER_BATCH_SIZE } from "../src/features/tasks/tasks-view.ts";
import { parseGradleTasksOutput } from "../src/plugins/android-gradle/discovery.ts";
import { runnableGradleSnapshot } from "../src/plugins/android-gradle/execution.ts";
import { deriveGradleQuickActions } from "../src/plugins/android-gradle/quick-actions.ts";
import {
  decodeAndroidGradleCachePayload,
  encodeAndroidGradleCachePayload,
  fingerprintPaths,
} from "../src/plugins/android-gradle/task-cache.ts";

const workspaceRoot = resolve(process.argv[2] ?? "");
const outputPath = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("Usage: node scripts/benchmark-android-task-cache.mjs <workspace-root> <gradle-tasks-output>");
}

const catalogStarted = performance.now();
const catalog = await projectCatalog(workspaceRoot);
const catalogMs = performance.now() - catalogStarted;
const candidates = fingerprintPaths(catalog.map((workspacePath) => ({ workspacePath })), process.platform === "win32" ? "windows" : "posix");
let fingerprintBytes = 0;
for (const path of candidates) fingerprintBytes += (await stat(join(workspaceRoot, path))).size;

const output = await readFile(outputPath);
const parseStarted = performance.now();
const parsed = parseGradleTasksOutput(output);
const parseMs = performance.now() - parseStarted;
if (parsed.status !== "ready") throw new Error(parsed.error ?? "Gradle task parsing failed.");
const runnable = runnableGradleSnapshot(parsed);
const quickActions = deriveGradleQuickActions(runnable).actions;
const quickByTask = new Map(quickActions.map((action) => [action.taskId, action]));
const tasks = runnable.tasks.map((task) => {
  const quick = quickByTask.get(task.id);
  return quick ? { ...task, androidQuickAction: { kind: quick.kind, module: quick.module, variant: quick.variant } } : task;
});

const encodeStarted = performance.now();
const payloadBase64 = encodeAndroidGradleCachePayload(tasks, "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks");
const encodeMs = performance.now() - encodeStarted;
const decodeStarted = performance.now();
const restored = decodeAndroidGradleCachePayload(payloadBase64, "dev.asterlyn.android-gradle", "0.1.0", "gradle-tasks");
const decodeMs = performance.now() - decodeStarted;
if (!restored || restored.length !== tasks.length) throw new Error("Task cache round-trip did not preserve the task catalog.");

const controller = new TasksController();
const identity = { root: workspaceRoot, generation: 1 };
controller.activate(identity);
const projectionStarted = performance.now();
controller.acceptProviders(identity, [{
  id: "dev.asterlyn.android-gradle.gradle-tasks",
  label: "Gradle",
  snapshot: { status: "ready", tasks, cache: { status: "ready", restoredTaskCount: tasks.length } },
}]);
const projectionMs = performance.now() - projectionStarted;
const renderStarted = performance.now();
const completeHtml = renderTasksView(controller.state);
const renderMs = performance.now() - renderStarted;
const quickRenderStarted = performance.now();
const quickHtml = renderTasksView(controller.state, undefined, TASKS_RENDER_BATCH_SIZE, undefined, "quick-actions-tree");
const quickRenderMs = performance.now() - quickRenderStarted;

console.log(JSON.stringify({
  workspace: workspaceRoot,
  project: basename(workspaceRoot),
  catalog: { files: catalog.length, milliseconds: rounded(catalogMs) },
  fingerprint: { files: candidates.length, bytes: fingerprintBytes },
  discovery: {
    outputBytes: output.byteLength,
    tasks: tasks.length,
    modules: new Set(tasks.map((task) => task.projectPath)).size,
    quickActions: quickActions.length,
    parseMilliseconds: rounded(parseMs),
  },
  cache: {
    payloadBytes: Buffer.byteLength(payloadBase64, "base64"),
    base64Bytes: Buffer.byteLength(payloadBase64),
    encodeMilliseconds: rounded(encodeMs),
    decodeMilliseconds: rounded(decodeMs),
  },
  projection: {
    acceptMilliseconds: rounded(projectionMs),
    completeRenderMilliseconds: rounded(renderMs),
    quickRenderMilliseconds: rounded(quickRenderMs),
    completeHtmlBytes: Buffer.byteLength(completeHtml),
    quickHtmlBytes: Buffer.byteLength(quickHtml),
  },
}, null, 2));

async function projectCatalog(root) {
  const ignored = new Set([".git", ".gradle", ".idea", "build", "node_modules", "target"]);
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) pending.push(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(root, fullPath).replaceAll("\\", "/"));
      }
      if (files.length > 100_000) throw new Error("Project catalog exceeded the benchmark bound.");
    }
  }
  return files.sort();
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}
