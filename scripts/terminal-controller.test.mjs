import assert from "node:assert/strict";
import test from "node:test";

import { TerminalController } from "../src/features/terminal/terminal-controller.ts";

function fixture() {
  let listener = () => undefined;
  const writes = [];
  const resizes = [];
  const closes = [];
  const gateway = {
    async subscribeTerminal(next) {
      listener = next;
      return () => { listener = () => undefined; };
    },
    async startTerminal(root) {
      listener({
        protocolVersion: 1,
        kind: "output",
        sessionId: "session-1",
        sequence: 1,
        dataBase64: btoa("prompt> "),
      });
      return { protocolVersion: 1, sessionId: "session-1", shell: "bash", cwd: root };
    },
    async writeTerminal(sessionId, dataBase64) { writes.push([sessionId, atob(dataBase64)]); },
    async resizeTerminal(sessionId, cols, rows) { resizes.push([sessionId, cols, rows]); },
    async closeTerminal(sessionId) { closes.push(sessionId); return true; },
  };
  return { gateway, emit: (event) => listener(event), writes, resizes, closes };
}

test("terminal subscribes before start and preserves bounded startup output", async () => {
  const source = fixture();
  const controller = new TerminalController(source.gateway);
  const output = [];
  controller.subscribeOutput((frame) => output.push(
    frame.kind === "output" ? new TextDecoder().decode(frame.bytes) : `omitted:${frame.omittedBytes}`,
  ));
  controller.installWorkspace("/repo");

  await controller.start(100, 30);

  assert.equal(controller.state.status, "running");
  assert.equal(controller.state.cwd, "/repo");
  assert.deepEqual(output, ["prompt> "]);
});

test("terminal batches input and resize bursts for the current session", async () => {
  const source = fixture();
  const controller = new TerminalController(source.gateway);
  controller.installWorkspace("/repo");
  await controller.start(80, 24);

  controller.sendInput("g");
  controller.sendInput("it\n");
  controller.resize(90, 25);
  controller.resize(110, 35);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(source.writes, [["session-1", "git\n"]]);
  assert.deepEqual(source.resizes, [["session-1", 110, 35]]);
});

test("workspace replacement closes the old session and ignores stale output", async () => {
  const source = fixture();
  const controller = new TerminalController(source.gateway);
  const output = [];
  controller.subscribeOutput((frame) => output.push(
    frame.kind === "output" ? new TextDecoder().decode(frame.bytes) : `omitted:${frame.omittedBytes}`,
  ));
  controller.installWorkspace("/repo-a");
  await controller.start(80, 24);

  controller.installWorkspace("/repo-b");
  source.emit({
    protocolVersion: 1,
    kind: "output",
    sessionId: "session-1",
    sequence: 2,
    dataBase64: btoa("stale"),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(source.closes, ["session-1"]);
  assert.deepEqual(output, ["prompt> "]);
  assert.equal(controller.state.root, "/repo-b");
  assert.equal(controller.state.status, "idle");
});

test("startup output keeps a bounded tail and reports one explicit truncation", async () => {
  let listener = () => undefined;
  const gateway = {
    async subscribeTerminal(next) { listener = next; return () => undefined; },
    async startTerminal(root) {
      for (let sequence = 1; sequence <= 80; sequence += 1) {
        listener({
          protocolVersion: 1,
          kind: "output",
          sessionId: "session-pressure",
          sequence,
          dataBase64: btoa(String(sequence).padStart(4, "0").repeat(1024)),
        });
      }
      return { protocolVersion: 1, sessionId: "session-pressure", shell: "bash", cwd: root };
    },
    async writeTerminal() {}, async resizeTerminal() {}, async closeTerminal() { return true; },
  };
  const controller = new TerminalController(gateway);
  const frames = [];
  controller.subscribeOutput((frame) => frames.push(frame));
  controller.installWorkspace("/repo");

  await controller.start(80, 24);

  assert.equal(frames[0].kind, "truncated");
  assert.equal(frames.filter((frame) => frame.kind === "truncated").length, 1);
  assert.ok(frames[0].omittedBytes > 0);
  assert.equal(frames.at(-1).kind, "output");
  assert.equal(new TextDecoder().decode(frames.at(-1).bytes).slice(0, 4), "0080");
  assert.equal(controller.state.status, "running");
});

test("a sequence gap fails the session instead of hiding transport loss", async () => {
  const source = fixture();
  const controller = new TerminalController(source.gateway);
  controller.installWorkspace("/repo");
  await controller.start(80, 24);
  source.emit({
    protocolVersion: 1,
    kind: "output",
    sessionId: "session-1",
    sequence: 3,
    dataBase64: btoa("lost frame"),
  });
  assert.equal(controller.state.status, "error");
  assert.match(controller.state.error, /lost an event/u);
});
