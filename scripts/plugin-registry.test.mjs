import assert from "node:assert/strict";
import test from "node:test";
import { PluginContributionRegistry, PluginRuntime, qualifyContributionId, validatePluginId, validatePluginVersion, validateWorkspaceIdentity } from "../src/application/plugins/plugin-registry.ts";

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

test("registers external contribution batches atomically and releases them as one unit", () => {
  const registry = new PluginContributionRegistry();
  const observed = [];
  const releaseObserver = registry.subscribe(() => observed.push(registry.list().length));
  const release = registry.registerExternalBatch(
    { id: "external", version: "1.0.0" },
    [provider("tasks"), provider("quick-actions")],
  );
  assert.deepEqual(registry.list().map((entry) => entry.qualifiedId), [
    "external.tasks",
    "external.quick-actions",
  ]);
  assert.throws(
    () => registry.registerExternalBatch(
      { id: "external", version: "1.0.1" },
      [provider("new"), provider("tasks")],
    ),
    /Duplicate contribution ID/u,
  );
  assert.equal(registry.get("external.new"), null);
  release.dispose();
  release.dispose();
  releaseObserver();
  assert.deepEqual(observed, [2, 0]);
});

const languageService = () => ({
  kind: "language-service", id: "typescript-javascript", label: "TypeScript / JavaScript",
  serverId: "typescript", languageIds: ["typescript", "javascript"],
  extensions: [".ts", ".js"], rootMarkers: ["tsconfig.json", "package.json"],
});

test("language profile declarations are bounded, unique and contain no path authority", () => {
  const owner = { id: "dev.asterlyn.lsp", version: "0.1.0" };
  const registry = new PluginContributionRegistry();
  const release = registry.registerExternalBatch(owner, [languageService()]);
  assert.equal(registry.get("dev.asterlyn.lsp.typescript-javascript")?.serverId, "typescript");
  release.dispose();
  const mutations = [
    { serverId: "arbitrary-executable" }, { label: null }, { label: "x".repeat(121) },
    { label: "bad\nlabel" }, { languageIds: ["typescript", 1] },
    { languageIds: ["typescript", "typescript"] }, { languageIds: ["kotlin"] },
    { extensions: [".TS"] }, { extensions: [".ts", ".ts"] }, { extensions: ["../ts"] },
    { rootMarkers: ["../package.json"] }, { rootMarkers: ["/package.json"] },
    { rootMarkers: ["nested/package.json"] }, { rootMarkers: ["."] },
    { rootMarkers: ["a".repeat(129)] }, { rootMarkers: Array.from({ length: 9 }, (_, i) => `file${i}`) },
    { rootMarkers: ["tsconfig.json", null] }, { rootMarkers: [] },
  ];
  for (const mutation of mutations) {
    assert.throws(() => registry.registerExternalBatch(owner, [languageService(), {
      ...languageService(), id: "invalid", ...mutation,
    }]), /Invalid language service contribution/u, JSON.stringify(mutation));
    assert.equal(registry.list().length, 0, "an invalid batch must publish nothing");
  }
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

test("rejects malformed or colliding task authorization declarations", async () => {
  const runtime = new PluginRuntime();
  const malformed = plugin("invalid-auth", () => undefined);
  malformed.manifest.taskAuthorization = {
    workspaceTrust: { id: "bad/id", labelKey: "authorization.workspaceTrust" },
  };
  await assert.rejects(runtime.activate(identity, {}, [malformed]), /Invalid plugin task authorization/u);

  const collision = plugin("colliding-auth", () => undefined);
  collision.manifest.settings = [{
    id: "workspaceTrust",
    kind: "boolean",
    labelKey: "settings.workspaceTrust",
    defaultValue: false,
  }];
  collision.manifest.taskAuthorization = {
    workspaceTrust: { id: "workspaceTrust", labelKey: "authorization.workspaceTrust" },
  };
  await assert.rejects(runtime.activate(identity, {}, [collision]), /Invalid plugin task authorization/u);
});

test("accepts optional workspace tool and bounded target/run contributions", async () => {
  const runtime = new PluginRuntime();
  const report = await runtime.activate(identity, {}, [
    plugin("android", (ctx) => {
      ctx.contribute({
        kind: "execution-target-provider", id: "devices",
        snapshot: () => ({ status: "ready", targets: [], selectedTargetId: null }),
        refresh: async () => undefined,
        select: async () => undefined,
      });
      ctx.contribute({
        kind: "run-configuration-provider", id: "run",
        snapshot: () => ({ status: "ready", configurations: [], selectedConfigurationId: null }),
        select: async () => undefined,
        run: () => null,
      });
    }),
  ]);
  assert.deepEqual(report.activated, ["android"]);
  assert.equal(runtime.contributions.get("android.devices")?.kind, "execution-target-provider");
  assert.equal(runtime.contributions.get("android.run")?.kind, "run-configuration-provider");
});

test("rejects invalid optional workspace tool, process-query, and tool-operation declarations", async () => {
  const runtime = new PluginRuntime();
  const malformedTool = plugin("bad-tool", () => undefined);
  malformedTool.manifest.workspaceTool = {
    id: "android", titleKey: "tool.title", icon: "window",
    views: [{ id: "run", labelKey: "view.run" }], defaultView: "run",
  };
  await assert.rejects(runtime.activate(identity, {}, [malformedTool]), /Invalid plugin workspace tool/u);

  const malformedQuery = plugin("bad-query", () => undefined);
  malformedQuery.manifest.processQueries = [{
    id: "adb.devices", args: ["devices"], timeoutMs: 10_000, maxOutputBytes: 10_000,
    executables: [{ type: "environment", variable: "BAD-NAME", relativePath: "platform-tools/adb" }],
  }];
  await assert.rejects(runtime.activate(identity, {}, [malformedQuery]), /Invalid (?:plugin )?process query/u);

  const malformedOperation = plugin("bad-operation", () => undefined);
  malformedOperation.manifest.toolOperations = [{
    id: "android.adb.launch", intent: "mutation",
    args: [{ type: "parameter", name: "missing" }],
    parameters: [{ name: "target", kind: "executionTargetId" }],
    timeoutMs: 10_000, maxOutputBytes: 10_000,
    executables: [{ type: "path", name: "adb" }],
  }];
  await assert.rejects(runtime.activate(identity, {}, [malformedOperation]), /Unknown plugin tool-operation parameter/u);
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

test("plugin notification capability is optional, scoped, and revoked on deactivation", async () => {
  const published = [];
  let capability;
  const runtime = new PluginRuntime(
    undefined,
    undefined,
    undefined,
    (owner) => ({ publish: (request) => published.push([owner.id, request]) }),
  );
  await runtime.activate(identity, {}, [plugin("notifier", (context) => {
    capability = context.notifications;
    capability?.publish({ kind: "info", messageKey: "name" });
  })]);
  assert.ok(capability);
  assert.deepEqual(published, [["notifier", { kind: "info", messageKey: "name" }]]);
  await runtime.deactivate();
  capability.publish({ kind: "error", messageKey: "description" });
  assert.equal(published.length, 1);

  let unavailable = "unset";
  const olderHost = new PluginRuntime();
  await olderHost.activate(identity, {}, [plugin("old-host", (context) => {
    unavailable = context.notifications;
  })]);
  assert.equal(unavailable, undefined);
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

test("Rust profile accepts only Rust languages and suffixes alongside TypeScript", () => {
  const owner = { id: "dev.asterlyn.lsp", version: "0.2.0" };
  const registry = new PluginContributionRegistry();
  const rust = { kind: "language-service", id: "rust", label: "Rust", serverId: "rust-analyzer", languageIds: ["rust"], extensions: [".rs"], rootMarkers: ["Cargo.toml"] };
  const release = registry.registerExternalBatch(owner, [languageService(), rust]);
  assert.equal(registry.list().length, 2); release.dispose();
  for (const patch of [{ languageIds: ["typescript"] }, { extensions: [".ts"] }, { rootMarkers: ["../Cargo.toml"] }, { serverId: "rustup" }]) {
    assert.throws(() => registry.registerExternalBatch(owner, [languageService(), { ...rust, ...patch }]));
    assert.equal(registry.list().length, 0);
  }
});
