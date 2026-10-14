import assert from "node:assert/strict";
import test from "node:test";

import { TasksController } from "../src/features/tasks/tasks-controller.ts";
import { renderTasksView } from "../src/features/tasks/tasks-view.ts";

const identity = { root: "/repo", generation: 1 };
const task = (id, quickAction) => ({ id, label: id, group: "Build tasks", runnable: true, androidQuickAction: quickAction });

test("normalizes bounded Android quick metadata and drops invalid metadata", () => {
  const controller = new TasksController();
  controller.activate(identity);
  controller.acceptProviders(identity, [{ id: "gradle", label: "Gradle", snapshot: { status: "ready", tasks: [
    task(":app:assembleDebug", { kind: "assemble", module: ":app", variant: "Debug" }),
    task(":bad", { kind: "unknown", module: ":bad", variant: "Debug" }),
    task(":unsafe", { kind: "assemble", module: ":../app", variant: "debug" }),
    task(":app:clean", { kind: "install", module: ":app", variant: "Debug" }),
  ] } }]);
  assert.deepEqual(controller.state.entries[0].task.androidQuickAction, { kind: "assemble", module: ":app", variant: "Debug" });
  assert.equal(controller.state.entries[1].task.androidQuickAction, undefined);
  assert.equal(controller.state.entries[2].task.androidQuickAction, undefined);
  assert.equal(controller.state.entries[3].task.androidQuickAction, undefined);
});

test("renders every module candidate with exact task keys and accessible labels", () => {
  const html = renderTasksView({ identity, status: "ready", query: "", selectedIndex: 0, error: null, unavailableReason: null,
    providers: [], entries: [
      { key: "gradle::app:installDebug", providerId: "gradle", providerLabel: "Gradle", task: task(":app:installDebug", { kind: "install", module: ":app", variant: "Debug" }) },
      { key: "gradle::demo:installDebug", providerId: "gradle", providerLabel: "Gradle", task: task(":demo:installDebug", { kind: "install", module: ":demo", variant: "Debug" }) },
    ], visibleEntries: [],
  });
  assert.match(html, /Android quick actions/u);
  assert.match(html, /data-task-key="gradle::app:installDebug"/u);
  assert.match(html, /data-task-key="gradle::demo:installDebug"/u);
  assert.match(html, /Module: :app/u);
  assert.match(html, /Module: :demo/u);
  assert.match(html, /aria-label="Install Debug, Module: :app, Variant: Debug"/u);
});
