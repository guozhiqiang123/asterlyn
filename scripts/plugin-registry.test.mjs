import assert from "node:assert/strict";
import test from "node:test";
import { PluginRuntime, qualifyContributionId, validatePluginId, validatePluginVersion, validateWorkspaceIdentity } from "../src/application/plugins/plugin-registry.ts";

const identity = { root: "/repo", generation: 1 };
const provider = (id, label = id) => ({
  kind: "provider",
  id,
  label,
  snapshot: () => ({ status: "ready", tasks: [] }),
});

test("validates strict plugin, version, and contribution IDs", () => {
  validatePluginId("dev.asterlyn.android-gradle");
  validatePluginVersion("1.2.3-beta.1");
  assert.equal(qualifyContributionId("dev.asterlyn.android-gradle", "tasks"), "dev.asterlyn.android-gradle.tasks");
  assert.throws(() => validatePluginId("Bad ID"), /Invalid plugin ID/);
  assert.throws(() => validatePluginVersion("1.2"), /Invalid plugin version/);
  assert.throws(() => qualifyContributionId("dev.asterlyn.android-gradle", "bad/id"), /Invalid contribution ID/);
  assert.throws(() => validateWorkspaceIdentity({ root: "  ", generation: 0 }), /Invalid workspace root/);
  assert.throws(() => validateWorkspaceIdentity({ root: "/repo", generation: -1 }), /Invalid workspace generation/);
  assert.throws(() => validateWorkspaceIdentity({ root: "/repo", generation: 1.5 }), /Invalid workspace generation/);
});

test("activates matching plugins in declared order and namespaces contributions", async () => {
  const events = [];
  const runtime = new PluginRuntime();
  const plugins = [
    plugin("first", async (ctx) => { events.push("first"); ctx.contribute(provider("tasks")); }),
    plugin("second", (ctx) => { events.push("second"); ctx.contribute(provider("tasks")); }),
  ];
  const report = await runtime.activate(identity, { kind: "android" }, plugins);
  assert.deepEqual(events, ["first", "second"]);
  assert.deepEqual(report.activated, ["first", "second"]);
  assert.deepEqual(runtime.contributions.list().map((item) => item.qualifiedId), ["first.tasks", "second.tasks"]);
});

test("matches receive immutable cloned workspace evidence", async () => {
  const runtime = new PluginRuntime();
  const source = { kind: "workspace-catalog", files: [{ workspacePath: "settings.gradle" }] };
  let observed;
  const activation = runtime.activate(identity, source, [{
    ...plugin("snapshot", () => undefined),
    matches: (context) => {
      observed = context;
      assert.equal(Object.isFrozen(context.evidence), true);
      assert.equal(Object.isFrozen(context.evidence.files), true);
      assert.equal(Object.isFrozen(context.evidence.files[0]), true);
      return true;
    },
  }]);
  source.files[0].workspacePath = "changed.gradle";
  await activation;
  assert.equal(observed.evidence.files[0].workspacePath, "settings.gradle");
  assert.equal(Object.isFrozen(source), false);
});

test("rejects duplicate plugin IDs before activation", async () => {
  const runtime = new PluginRuntime();
  const duplicate = plugin("same", () => undefined);
  await assert.rejects(runtime.activate(identity, {}, [duplicate, duplicate]), /Duplicate plugin ID/);
});

test("isolates an activation failure and reports it", async () => {
  const diagnostics = [];
  const runtime = new PluginRuntime(undefined, (diagnostic) => diagnostics.push(diagnostic));
  const report = await runtime.activate(identity, {}, [
    plugin("broken", () => { throw new Error("boom"); }),
    plugin("healthy", (ctx) => { ctx.contribute(provider("tasks")); }),
  ]);
  assert.deepEqual(report.activated, ["healthy"]);
  assert.equal(report.diagnostics[0].message, "boom");
  assert.equal(diagnostics.length, 1);
  assert.equal(runtime.contributions.get("healthy.tasks")?.pluginId, "healthy");
});

test("replacement disposes the old activation before installing the new one", async () => {
  const events = [];
  const runtime = new PluginRuntime();
  const old = plugin("old", (ctx) => {
    ctx.contribute(provider("tasks"));
    return { dispose: () => { events.push("old-dispose"); } };
  });
  const next = plugin("next", (ctx) => { events.push("next-activate"); ctx.contribute(provider("tasks")); });
  await runtime.activate(identity, {}, [old]);
  await runtime.activate({ root: "/other", generation: 2 }, {}, [next]);
  assert.deepEqual(events, ["old-dispose", "next-activate"]);
  assert.equal(runtime.contributions.get("old.tasks"), null);
});

test("late stale activation is disposed and cannot publish contributions", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let started;
  const activationStarted = new Promise((resolve) => { started = resolve; });
  const events = [];
  const runtime = new PluginRuntime();
  const stale = plugin("stale", async (ctx) => {
    ctx.contribute(provider("tasks"));
    started();
    await pending;
    return { dispose: () => { events.push("stale-dispose"); } };
  });
  const first = runtime.activate(identity, {}, [stale]);
  await activationStarted;
  const second = runtime.activate({ root: "/new", generation: 2 }, {}, []);
  await Promise.resolve();
  assert.deepEqual(runtime.contributions.list(), []);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["stale-dispose"]);
  assert.equal(runtime.contributions.get("stale.tasks"), null);
});

test("workspace transitions wait for prior disposal before activating", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const events = [];
  const runtime = new PluginRuntime();
  await runtime.activate(identity, {}, [plugin("old-serial", () => ({
    dispose: async () => { events.push("dispose-start"); await pending; events.push("dispose-end"); },
  }))]);
  const first = runtime.activate({ root: "/first", generation: 2 }, {}, []);
  await Promise.resolve();
  const second = runtime.activate({ root: "/second", generation: 3 }, {}, [
    plugin("new-serial", () => { events.push("new-activate"); }),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["dispose-start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["dispose-start", "dispose-end", "new-activate"]);
});

test("duplicate contribution is isolated and disposal is complete and idempotent", async () => {
  const runtime = new PluginRuntime();
  let disposed = 0;
  const report = await runtime.activate(identity, {}, [
    plugin("owner", (ctx) => {
      ctx.contribute(provider("tasks"));
      ctx.contribute(provider("tasks"));
    }),
    plugin("other", (ctx) => {
      ctx.contribute(provider("tasks"));
      return { dispose: () => { disposed += 1; } };
    }),
  ]);
  assert.deepEqual(report.activated, ["other"]);
  assert.deepEqual(report.diagnostics.map((item) => item.kind), ["duplicate-contribution"]);
  await runtime.dispose();
  await runtime.dispose();
  assert.equal(disposed, 1);
  assert.deepEqual(runtime.contributions.list(), []);
});

test("invalid contributions are classified without blocking healthy plugins", async () => {
  const runtime = new PluginRuntime();
  const report = await runtime.activate(identity, {}, [
    plugin("invalid-owner", (ctx) => { ctx.contribute(provider("bad/id")); }),
    plugin("valid-owner", (ctx) => { ctx.contribute(provider("tasks")); }),
  ]);
  assert.deepEqual(report.activated, ["valid-owner"]);
  assert.deepEqual(report.diagnostics.map((item) => item.kind), ["invalid-contribution"]);
  assert.equal(runtime.contributions.get("valid-owner.tasks")?.pluginId, "valid-owner");
});

test("diagnostic observers cannot break activation isolation", async () => {
  const runtime = new PluginRuntime(undefined, () => { throw new Error("observer failed"); });
  const report = await runtime.activate(identity, {}, [
    plugin("broken-observer", () => { throw new Error("plugin failed"); }),
    plugin("healthy-observer", (ctx) => { ctx.contribute(provider("tasks")); }),
  ]);
  assert.deepEqual(report.activated, ["healthy-observer"]);
  assert.equal(runtime.contributions.get("healthy-observer.tasks")?.pluginId, "healthy-observer");
});

test("registry subscribers observe commit and deactivation", async () => {
  const runtime = new PluginRuntime();
  const sizes = [];
  const release = runtime.contributions.subscribe(() => sizes.push(runtime.contributions.list().length));
  await runtime.activate(identity, {}, [plugin("observed", (ctx) => { ctx.contribute(provider("tasks")); })]);
  await runtime.deactivate();
  release();
  assert.deepEqual(sizes, [1, 0]);
});

test("no-match activation leaves the registry empty", async () => {
  const runtime = new PluginRuntime();
  const report = await runtime.activate(identity, { kind: "plain" }, [
    { ...plugin("android", (ctx) => ctx.contribute(provider("tasks"))), matches: ({ evidence }) => evidence.kind === "android" },
  ]);
  assert.deepEqual(report.skipped, ["android"]);
  assert.deepEqual(runtime.contributions.list(), []);
});

function plugin(id, activate) {
  return {
    id,
    version: "1.0.0",
    manifest: {
      id,
      version: "1.0.0",
      nameKey: "name",
      descriptionKey: "description",
      localization: { defaultLocale: "en-US", locales: { "en-US": { name: id, description: `${id} description` } } },
      settings: [],
    },
    matches: () => true,
    activate,
  };
}
