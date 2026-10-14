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

function plugin(id, activate) {
  return { id, version: "1.0.0", matches: () => true, activate };
}
