import assert from "node:assert/strict";
import test from "node:test";

import { PluginRuntime } from "../src/application/plugins/index.ts";
import { PluginContributionRuntime } from "../src/composition/plugin-contribution-runtime.ts";

const identity = { root: "/repo", generation: 2 };

test("plugin commands and providers are projected and removed with activation", async () => {
  const runtime = new PluginRuntime();
  const commands = new Map();
  const providerSnapshots = [];
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: (descriptor) => {
      commands.set(descriptor.id, descriptor);
      return () => commands.delete(descriptor.id);
    },
    replaceProviders: (_identity, providers) => providerSnapshots.push(providers),
    reportError: (error) => { throw error; },
  });
  adapter.activateWorkspace(identity);
  let executed = 0;
  await runtime.activate(identity, {}, [plugin("android", (context) => {
    context.contribute({
      kind: "command", id: "refresh", title: () => "Refresh", detail: () => "Refresh tasks",
      execute: () => { executed += 1; },
    });
    context.contribute({
      kind: "provider", id: "tasks", label: "Gradle",
      snapshot: () => ({ status: "ready", tasks: [{ id: ":app:assemble", label: "assemble", group: "Build", runnable: false }] }),
    });
  })]);
  assert.equal(commands.has("android.refresh"), true);
  await commands.get("android.refresh").execute("palette");
  assert.equal(executed, 1);
  assert.equal(providerSnapshots.at(-1)[0].id, "android.tasks");
  await runtime.deactivate();
  assert.equal(commands.size, 0);
  assert.deepEqual(providerSnapshots.at(-1), []);
  adapter.dispose();
});

test("provider settings owners are host-qualified and resolve null, one, or many", async () => {
  const runtime = new PluginRuntime();
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined, replaceProviders: () => undefined, reportError: (error) => { throw error; },
  });
  adapter.activateWorkspace(identity);
  assert.equal(adapter.pluginSettingsTargets(), null);
  await runtime.activate(identity, {}, [plugin("android", (context) => {
    context.contribute({ kind: "provider", id: "tasks", label: "Gradle", settingsFocus: "taskPresentation", snapshot: () => ({ status: "ready", tasks: [] }) });
    context.contribute({ kind: "provider", id: "quick-actions", label: "Quick actions", settingsFocus: "taskPresentation", snapshot: () => ({ status: "ready", tasks: [] }) });
  })]);
  assert.deepEqual(adapter.pluginSettingsTargets(), { pluginId: "android", focus: "taskPresentation" });
  await runtime.activate(identity, {}, [
    plugin("android", (context) => context.contribute({ kind: "provider", id: "tasks", label: "Gradle", settingsFocus: "taskPresentation", snapshot: () => ({ status: "ready", tasks: [] }) })),
    plugin("other", (context) => context.contribute({ kind: "provider", id: "tasks", label: "Other", settingsFocus: "general", snapshot: () => ({ status: "ready", tasks: [] }) })),
  ]);
  assert.deepEqual(adapter.pluginSettingsTargets(), [
    { pluginId: "android", focus: "taskPresentation" }, { pluginId: "other", focus: "general" },
  ]);
  adapter.dispose();
});

test("provider snapshot failures are isolated as error projections", async () => {
  const runtime = new PluginRuntime();
  const errors = [];
  let providers = [];
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, next) => { providers = next; },
    reportError: (error) => errors.push(error),
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("broken", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Broken", snapshot: () => { throw new Error("boom"); },
  }))]);
  assert.equal(providers[0].snapshot.status, "error");
  assert.equal(providers[0].snapshot.error, "boom");
  assert.equal(errors.length, 1);
  adapter.dispose();
  await runtime.dispose();
});

test("provider collections are validated, qualified, and isolated from task snapshots", async () => {
  const runtime = new PluginRuntime();
  const errors = [];
  let providers = [];
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, next) => { providers = next; },
    reportError: (error) => errors.push(error),
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle",
    snapshot: () => ({ status: "ready", tasks: [{ id: ":app:assemble", label: "assemble", group: "Build", runnable: true }] }),
    collections: () => [{
      providerId: "tasks", truncated: false, nodes: [
        { id: "app", parentId: null, label: "app", kind: "group", order: 0 },
        { id: "app.build", parentId: "app", label: "Build", kind: "group", order: 0 },
        { id: "app.assemble", parentId: "app.build", label: "assemble", kind: "task", order: 0, taskId: ":app:assemble" },
      ],
    }],
  }))]);
  assert.equal(providers[0].collection.providerId, "android.tasks");
  assert.deepEqual(providers[0].collection.nodes.map((node) => [node.id, node.parentId]), [
    ["android.tasks:collection:app", null],
    ["android.tasks:collection:app.build", "android.tasks:collection:app"],
    ["android.tasks:collection:app.assemble", "android.tasks:collection:app.build"],
  ]);
  assert.equal(errors.length, 0);
  await runtime.deactivate();
  await runtime.activate(identity, {}, [plugin("broken", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Broken",
    snapshot: () => ({ status: "ready", tasks: [] }),
    collections: () => [{ providerId: "other", truncated: false, nodes: [] }],
  }))]);
  assert.equal(providers[0].snapshot.status, "ready");
  assert.equal(providers[0].collection, undefined);
  assert.match(String(errors.at(-1)), /Expected one collection/u);
  adapter.dispose();
  await runtime.dispose();
});

test("provider refresh exposes only a typed execution plan and deduplicates concurrent requests", async () => {
  const runtime = new PluginRuntime();
  const plans = [];
  let executions = 0;
  let snapshot = { status: "unavailable", tasks: [], unavailableReason: "discovery-not-supported" };
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, next) => { snapshot = next[0]?.snapshot ?? snapshot; },
    reportError: (error) => { throw error; },
    executeTaskRefresh: async (_identity, plan) => {
      executions += 1;
      plans.push(plan);
      return { status: "succeeded", outputs: [], truncated: false, error: null };
    },
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle", snapshot: () => snapshot,
    refresh: () => ({ request: { pluginId: "android", providerId: "tasks", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] }, apply: (result) => { if (result.status === "succeeded") snapshot = { status: "ready", tasks: [] }; } }),
  }))]);
  await Promise.all([adapter.refreshProviders(identity), adapter.refreshProviders(identity)]);
  assert.equal(executions, 1);
  assert.equal(plans[0].request.executablePath, "gradlew");
  assert.equal(snapshot.status, "ready");
  adapter.dispose();
});

test("provider execution failures leave loading state through the plan error boundary", async () => {
  const runtime = new PluginRuntime();
  const errors = [];
  let snapshot = { status: "unavailable", tasks: [], unavailableReason: "discovery-not-supported" };
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportError: (error) => errors.push(error),
    executeTaskRefresh: async () => { throw new Error("event stream failed"); },
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle", snapshot: () => snapshot,
    refresh: () => {
      snapshot = { status: "loading", tasks: [] };
      return {
        request: { pluginId: "android", providerId: "tasks", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] },
        apply: (result) => { snapshot = { status: result.status === "succeeded" ? "ready" : "error", tasks: [], error: result.error }; },
      };
    },
  }))]);
  await adapter.refreshProviders(identity);
  assert.equal(snapshot.status, "error");
  assert.match(snapshot.error, /event stream failed/u);
  assert.equal(errors.length, 1);
  adapter.dispose();
  await runtime.dispose();
});

test("provider deactivation aborts an in-flight host refresh and drops the stale result", async () => {
  const runtime = new PluginRuntime();
  const snapshots = [];
  let aborted = 0;
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, providers) => snapshots.push(providers),
    reportError: (error) => { throw error; },
    executeTaskRefresh: async (_identity, _plan, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        aborted += 1;
        resolve({ status: "cancelled", outputs: [], truncated: false, error: null });
      }, { once: true });
    }),
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle",
    snapshot: () => ({ status: "loading", tasks: [] }),
    refresh: () => ({
      request: { pluginId: "android", providerId: "tasks", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] },
      apply: () => { throw new Error("stale plan was applied"); },
    }),
  }))]);
  const refresh = adapter.refreshProviders(identity);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await runtime.deactivate();
  await refresh;
  assert.equal(aborted, 1);
  assert.deepEqual(snapshots.at(-1), []);
  adapter.dispose();
});

test("the Tasks surface can explicitly cancel the current workspace refresh", async () => {
  const runtime = new PluginRuntime();
  let aborted = 0;
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportError: (error) => { throw error; },
    executeTaskRefresh: async (_identity, _plan, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        aborted += 1;
        resolve({ status: "cancelled", outputs: [], truncated: false, error: null });
      }, { once: true });
    }),
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle",
    snapshot: () => ({ status: "loading", tasks: [] }),
    refresh: () => ({
      request: { pluginId: "android", providerId: "tasks", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] },
      apply: () => undefined,
    }),
  }))]);
  const refresh = adapter.refreshProviders(identity);
  await new Promise((resolve) => setTimeout(resolve, 0));
  adapter.cancelTask({ root: "/other", generation: identity.generation });
  assert.equal(aborted, 0);
  adapter.cancelTask(identity);
  await refresh;
  assert.equal(aborted, 1);
  adapter.dispose();
  await runtime.dispose();
});

test("a provider can publish an unsupported refresh without starting execution", async () => {
  const runtime = new PluginRuntime();
  let latest = null;
  let executions = 0;
  let snapshot = { status: "loading", tasks: [] };
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, providers) => { latest = providers[0]?.snapshot ?? null; },
    reportError: (error) => { throw error; },
    executeTaskRefresh: async () => { executions += 1; throw new Error("must not execute"); },
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle", snapshot: () => snapshot,
    refresh: () => {
      snapshot = { status: "unavailable", tasks: [], unavailableReason: "discovery-not-supported" };
      return null;
    },
  }))]);
  await adapter.refreshProviders(identity);
  assert.equal(executions, 0);
  assert.equal(latest.status, "unavailable");
  adapter.dispose();
  await runtime.dispose();
});

test("a provider refresh command is localized by the host and targets its declared provider", async () => {
  const runtime = new PluginRuntime();
  const commands = new Map();
  let executions = 0;
  let snapshot = { status: "unavailable", tasks: [], unavailableReason: "discovery-not-supported" };
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: (descriptor) => { commands.set(descriptor.id, descriptor); return () => commands.delete(descriptor.id); },
    replaceProviders: () => undefined,
    reportError: (error) => { throw error; },
    providerRefreshTitle: (provider) => `Refresh tasks: ${provider}`,
    executeTaskRefresh: async () => {
      executions += 1;
      return { status: "succeeded", outputs: [], truncated: false, error: null };
    },
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => {
    context.contribute({
      kind: "provider", id: "tasks", label: "Gradle", snapshot: () => snapshot,
      refresh: () => ({
        request: { pluginId: "android", providerId: "tasks", taskId: "discover", label: "Gradle", executablePath: "gradlew", args: [] },
        apply: () => { snapshot = { status: "ready", tasks: [] }; },
      }),
    });
    context.contribute({
      kind: "command", id: "refresh", providerId: "tasks", title: () => "Gradle",
      detail: () => "Gradle", execute: () => { throw new Error("host must own refresh execution"); },
    });
  })]);
  const command = commands.get("android.refresh");
  assert.equal(command.title(), "Refresh tasks: Gradle");
  await command.execute("palette");
  assert.equal(executions, 1);
  assert.equal(snapshot.status, "ready");
  adapter.dispose();
  await runtime.dispose();
});

test("task execution uses the current provider identity and reports concurrent requests as busy", async () => {
  const runtime = new PluginRuntime();
  let snapshot = { status: "ready", tasks: [{ id: ":app:assembleDebug", label: "assembleDebug", group: "Build", runnable: true, runState: "idle" }] };
  let finishExecution;
  let applied = 0;
  const projections = [];
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, providers) => projections.push(providers),
    reportError: (error) => { throw error; },
    executeTaskRefresh: async () => { throw new Error("not used"); },
    executeTaskRun: async () => new Promise((resolve) => { finishExecution = resolve; }),
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle", snapshot: () => snapshot,
    run: (taskId) => {
      if (taskId !== ":app:assembleDebug") return null;
      snapshot = { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, runState: "queued" })) };
      return {
        request: { pluginId: "android", providerId: "tasks", taskId, label: "assembleDebug", executablePath: "gradlew", args: [taskId] },
        apply: (result) => { applied += 1; snapshot = { ...snapshot, tasks: snapshot.tasks.map((task) => ({ ...task, runState: result.status })) }; },
      };
    },
  }))]);
  const running = adapter.runTask("android.tasks::app:assembleDebug", identity);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(projections.at(-1)[0].snapshot.tasks[0].runState, "queued");
  await assert.rejects(adapter.runTask("android.tasks::app:assembleDebug", identity), { name: "PluginTaskBusyError" });
  finishExecution({ status: "succeeded", outputs: [], truncated: false, error: null });
  await running;
  assert.equal(applied, 1);
  assert.equal(projections.at(-1)[0].snapshot.tasks[0].runState, "succeeded");
  adapter.dispose();
  await runtime.dispose();
});

test("task plans cannot substitute another task identity", async () => {
  const runtime = new PluginRuntime();
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportError: () => undefined,
    executeTaskRefresh: async () => { throw new Error("not used"); },
    executeTaskRun: async () => { throw new Error("invalid plans must not execute"); },
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle",
    snapshot: () => ({ status: "ready", tasks: [{ id: "clean", label: "clean", group: "Build", runnable: true }] }),
    run: () => ({
      request: { pluginId: "android", providerId: "tasks", taskId: "assemble", label: "assemble", executablePath: "gradlew", args: ["assemble"] },
      apply: () => undefined,
    }),
  }))]);
  await assert.rejects(adapter.runTask("android.tasks:clean", identity), /Invalid task execution plan/);
  adapter.dispose();
  await runtime.dispose();
});

test("task plans reject unsafe artifact discovery hints before execution", async () => {
  const runtime = new PluginRuntime();
  let executed = 0;
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportError: () => undefined,
    executeTaskRefresh: async () => { throw new Error("not used"); },
    executeTaskRun: async () => { executed += 1; return { status: "succeeded", outputs: [], truncated: false, error: null }; },
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle",
    snapshot: () => ({ status: "ready", tasks: [{ id: ":app:assembleDebug", label: "assembleDebug", group: "Build", runnable: true }] }),
    run: () => ({
      request: { pluginId: "android", providerId: "tasks", taskId: ":app:assembleDebug", label: "assembleDebug", executablePath: "gradlew", args: [":app:assembleDebug"] },
      artifactSearch: { hints: ["../build/outputs/apk"] },
      apply: () => undefined,
    }),
  }))]);
  await assert.rejects(adapter.runTask("android.tasks::app:assembleDebug", identity), /Invalid task execution plan/);
  assert.equal(executed, 0);
  adapter.dispose();
  await runtime.dispose();
});

test("workspace replacement aborts an active task and drops its stale terminal result", async () => {
  const runtime = new PluginRuntime();
  let applied = 0;
  let aborted = 0;
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: () => undefined,
    reportError: (error) => { throw error; },
    executeTaskRefresh: async () => { throw new Error("not used"); },
    executeTaskRun: async (_identity, _plan, signal) => new Promise((resolve) => signal.addEventListener("abort", () => {
      aborted += 1;
      resolve({ status: "cancelled", outputs: [], truncated: false, error: null });
    }, { once: true })),
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle",
    snapshot: () => ({ status: "ready", tasks: [{ id: "clean", label: "clean", group: "Build", runnable: true }] }),
    run: () => ({
      request: { pluginId: "android", providerId: "tasks", taskId: "clean", label: "clean", executablePath: "gradlew", args: ["clean"] },
      apply: () => { applied += 1; },
    }),
  }))]);
  const running = adapter.runTask("android.tasks:clean", identity);
  await new Promise((resolve) => setTimeout(resolve, 0));
  adapter.activateWorkspace({ root: "/next", generation: 3 });
  await running;
  assert.equal(aborted, 1);
  assert.equal(applied, 0);
  adapter.dispose();
  await runtime.dispose();
});

test("workspace invalidation is delivered only to current providers and republishes snapshots", async () => {
  const runtime = new PluginRuntime();
  const snapshots = [];
  const invalidations = [];
  let stale = false;
  const adapter = new PluginContributionRuntime(runtime.contributions, {
    registerCommand: () => () => undefined,
    replaceProviders: (_identity, providers) => snapshots.push(providers),
    reportError: (error) => { throw error; },
  });
  adapter.activateWorkspace(identity);
  await runtime.activate(identity, {}, [plugin("android", (context) => context.contribute({
    kind: "provider", id: "tasks", label: "Gradle",
    snapshot: () => ({ status: "ready", tasks: [], ...(stale ? { cache: { status: "stale", staleReason: "watcher-change" } } : {}) }),
    invalidate: async (value) => { invalidations.push(value); stale = true; },
  }))]);
  await adapter.invalidateWorkspace(identity, { paths: ["app/build.gradle.kts"], recovery: "none" });
  await adapter.invalidateWorkspace({ root: "/stale", generation: 3 }, { paths: ["settings.gradle"], recovery: "none" });
  assert.deepEqual(invalidations, [{ paths: ["app/build.gradle.kts"], recovery: "none" }]);
  assert.equal(Object.isFrozen(invalidations[0]), true);
  assert.equal(snapshots.at(-1)[0].snapshot.cache.status, "stale");
  adapter.dispose();
  await runtime.dispose();
});

function plugin(id, activate) {
  return {
    id,
    version: "1.0.0",
    manifest: {
      id,
      version: "1.0.0",
      nameKey: `plugins.${id}.name`,
      descriptionKey: `plugins.${id}.description`,
      settings: [],
    },
    matches: () => true,
    activate,
  };
}
