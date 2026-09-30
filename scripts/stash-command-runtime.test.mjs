import test from "node:test";
import assert from "node:assert/strict";

import { CommandRegistry } from "../src/application/commands/command-service.ts";
import { STASH_COMMANDS } from "../src/application/commands/stash-command-ids.ts";
import { registerStashCommands } from "../src/composition/stash-command-runtime.ts";
import { StashRuntime } from "../src/features/git-stash/stash-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { DEFAULT_LOCALIZATION } from "../src/localization/localization.ts";

function oid(seed) { return seed.repeat(40).slice(0, 40); }
function entry() {
  return {
    repositoryId: ".", reference: "stash@{0}", oid: oid("a"), parentOid: oid("p"),
    authoredAt: 1_700_000_000, subject: "work",
  };
}

test("Stash command descriptors keep localized metadata and delegate live policy", async () => {
  const registry = new CommandRegistry();
  const actions = [];
  let enabled = true;
  const release = registerStashCommands(registry, {
    catalog: () => EN_US,
    stashCommandAvailability: (action) => enabled
      ? { enabled: true }
      : { enabled: false, reason: `${action} unavailable` },
    executeStashCommand: (action) => actions.push(action),
  });

  assert.match(registry.get(STASH_COMMANDS.refresh).title(), /Refresh.*Stash/);
  assert.equal(registry.get(STASH_COMMANDS.apply).title(), EN_US.stash.apply);
  assert.equal(registry.get(STASH_COMMANDS.openFileDiff).availability().enabled, true);
  await registry.get(STASH_COMMANDS.openFileDiff).execute("keyboard");
  await registry.get(STASH_COMMANDS.pop).execute("palette");
  assert.deepEqual(actions, ["open-diff", "pop"]);
  enabled = false;
  assert.deepEqual(registry.get(STASH_COMMANDS.apply).availability(), {
    enabled: false, reason: "apply unavailable",
  });
  release();
  assert.deepEqual(registry.list(), []);
});

test("Stash feature commands revalidate selection and preserve mutation routes", async () => {
  const listeners = new Map();
  const root = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    querySelector() { return null; },
  };
  const events = [];
  let visible = false;
  let clean = true;
  const selected = entry();
  const runtime = new StashRuntime(
    root,
    { open() {}, close() {}, revalidate() { events.push(["revalidate"]); } },
    {
      readStashCatalog: async () => ({ entries: [selected], truncatedRepositoryIds: [] }),
      readStashDetails: async () => ({
        repositoryId: ".", oid: selected.oid, parentOid: selected.parentOid,
        files: [{ path: "src/app.ts", originalPath: null, status: "modified" }],
      }),
      readStashDiff: async () => ({
        repositoryId: ".", oid: selected.oid, path: "src/app.ts",
        patch: "@@ -1 +1 @@", binary: false, truncated: false,
      }),
      executeStashMutation: async () => { throw new Error("unused direct gateway"); },
    },
    {
      copy: () => EN_US.stash,
      common: () => EN_US.common,
      localization: () => DEFAULT_LOCALIZATION,
      workspaceRoot: () => "/repo",
      visible: () => visible,
      busy: () => false,
      clean: () => clean,
      confirm: async () => true,
      runMutation: async (request) => { events.push(["mutation", request.kind, request.oid]); return true; },
      openDiff: (document) => events.push(["diff", document.path]),
      closeDiff() {},
      activeDocument: () => ({ kind: "welcome" }),
      renderEditor() {},
      presentationChanged: () => events.push(["presentation"]),
      status: (message, kind) => events.push(["status", kind, message]),
      error: (error) => events.push(["error", error]),
    },
  );
  await runtime.load("/repo", false);
  visible = true;

  assert.deepEqual(runtime.commandAvailability("open-diff"), { enabled: true });
  await runtime.executeCommand("open-diff");
  await runtime.executeCommand("toggle-view");
  assert.equal(runtime.controller.state.fileView, "flat");
  await runtime.executeCommand("apply");
  assert.deepEqual(events.filter(([kind]) => kind === "diff" || kind === "mutation"), [
    ["diff", "src/app.ts"], ["mutation", "apply", selected.oid],
  ]);

  clean = false;
  assert.deepEqual(runtime.commandAvailability("pop"), {
    enabled: false, reason: EN_US.stash.cleanRequired,
  });
  await runtime.executeCommand("pop");
  assert.deepEqual(events.at(-1), ["status", "warning", EN_US.stash.cleanRequired]);
  runtime.dispose();
  assert.equal(listeners.size, 0);
});
