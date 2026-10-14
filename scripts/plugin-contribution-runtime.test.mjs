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

function plugin(id, activate) {
  return { id, version: "1.0.0", matches: () => true, activate };
}
