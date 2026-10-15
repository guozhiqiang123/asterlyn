import assert from "node:assert/strict";
import test from "node:test";

import { TasksController } from "../src/features/tasks/tasks-controller.ts";
import { renderTasksView } from "../src/features/tasks/tasks-view.ts";
import { buildTaskTree, taskTreeBranchKeys } from "../src/features/tasks/tasks-tree.ts";

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
  const entries = [
    { key: "gradle::app:installDebug", providerId: "gradle", providerLabel: "Gradle", task: task(":app:installDebug", { kind: "install", module: ":app", variant: "Debug" }) },
    { key: "gradle::demo:installDebug", providerId: "gradle", providerLabel: "Gradle", task: task(":demo:installDebug", { kind: "install", module: ":demo", variant: "Debug" }) },
  ];
  const html = renderTasksView({ identity, status: "ready", query: "", selectedIndex: 0, error: null, unavailableReason: null,
    providers: [], entries, visibleEntries: entries,
  }, undefined, 250, undefined, "quick-actions-tree");
  assert.match(html, /data-tasks-presentation="quick-actions-tree"/u);
  assert.match(html, /data-task-key="gradle::app:installDebug"/u);
  assert.match(html, /data-task-key="gradle::demo:installDebug"/u);
  assert.match(html, />install</u);
  assert.match(html, />Debug</u);
  assert.match(html, /role="tree"/u);
});

test("keeps every Android quick-action kind visible in large catalogs", () => {
  const entries = [
    ...Array.from({ length: 200 }, (_, index) => {
      const id = `:app:assembleFlavor${index}`;
      return { key: `gradle:${id}`, providerId: "gradle", providerLabel: "Gradle", task: task(id, { kind: "assemble", module: ":app", variant: `Flavor${index}` }) };
    }),
    ...["bundle", "install", "uninstall"].map((kind) => {
      const id = `:app:${kind}Debug`;
      return { key: `gradle:${id}`, providerId: "gradle", providerLabel: "Gradle", task: task(id, { kind, module: ":app", variant: "Debug" }) };
    }),
  ];
  const html = renderTasksView({ identity, status: "ready", query: "", selectedIndex: 0, error: null, unavailableReason: null,
    providers: [], entries, visibleEntries: entries,
  }, undefined, 250, undefined, "quick-actions-tree");
  assert.equal((html.match(/data-task-key="gradle:/gu) ?? []).length, 203);
  assert.match(html, /data-tasks-presentation="quick-actions-tree"/u);
  assert.match(html, />bundle</u);
  assert.match(html, />install</u);
  assert.match(html, />uninstall</u);
});

test("all-task and quick-action tree projections are mutually exclusive", () => {
  const entries = [
    { key: "gradle::app:assembleDebug", providerId: "gradle", providerLabel: "Gradle", task: task(":app:assembleDebug", { kind: "assemble", module: ":app", variant: "Debug" }) },
    { key: "gradle::app:check", providerId: "gradle", providerLabel: "Gradle", task: task(":app:check", undefined) },
  ];
  const state = { identity, status: "ready", query: "", selectedIndex: 0, error: null, unavailableReason: null, providers: [], entries, visibleEntries: entries };
  const all = renderTasksView(state, undefined, 250, taskTreeBranchKeys(buildTaskTree(entries, identity.root)));
  const quick = renderTasksView(state, undefined, 250, undefined, "quick-actions-tree");
  assert.match(all, /data-tasks-presentation="all-tasks-tree"/u);
  assert.match(all, /data-task-key="gradle::app:check"/u);
  assert.doesNotMatch(all, /data-tasks-presentation="quick-actions-tree"/u);
  assert.match(quick, /data-tasks-presentation="quick-actions-tree"/u);
  assert.match(quick, /data-task-key="gradle::app:assembleDebug"/u);
  assert.doesNotMatch(quick, /data-task-key="gradle::app:check"/u);
});
