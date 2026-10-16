import assert from "node:assert/strict";
import test from "node:test";

import {
  TerminalPanel,
  renderTaskTerminalHeader,
  renderTerminalHeader,
  normalizeTaskTerminalOutput,
  taskTerminalActionAvailable,
  taskTerminalCommandLine,
  taskTerminalInteractionMode,
  shouldAutoStartShell,
  terminalActionAvailable,
  terminalInteractionMode,
} from "../src/features/terminal/terminal-panel.ts";
import { TerminalView, TerminalWriteBuffer } from "../src/features/terminal/terminal-view.ts";
import { TerminalShellTab } from "../src/features/terminal/terminal-shell-tab.ts";
import { EN_US } from "../src/localization/en-US.ts";

const idle = {
  root: "/repo",
  status: "idle",
  sessionId: null,
  shell: null,
  cwd: null,
  exitCode: null,
  error: null,
};

test("terminal header exposes explicit lifecycle actions and accessible explanations", () => {
  const idleHeader = renderTerminalHeader(idle, EN_US.terminal);
  assert.match(idleHeader, /No active session/);
  assert.match(idleHeader, /Start a new terminal session in the current project folder/);
  assert.match(idleHeader, /data-terminal-action="close"[^>]*disabled/);

  const runningHeader = renderTerminalHeader({
    ...idle,
    status: "running",
    sessionId: "session-1",
    shell: "bash",
    cwd: "/repo",
  }, EN_US.terminal);
  assert.match(runningHeader, />bash</);
  assert.match(runningHeader, /data-terminal-action="restart"[^>]*disabled/);
  assert.doesNotMatch(runningHeader, /data-terminal-action="close"[^>]*disabled/);
});

test("terminal shortcut availability exactly follows header lifecycle policy", () => {
  assert.equal(terminalActionAvailable(idle, "restart"), true);
  assert.equal(terminalActionAvailable(idle, "clear"), true);
  assert.equal(terminalActionAvailable(idle, "close"), false);
  const running = { ...idle, status: "running", sessionId: "session-1" };
  assert.equal(terminalActionAvailable(running, "restart"), false);
  assert.equal(terminalActionAvailable(running, "clear"), true);
  assert.equal(terminalActionAvailable(running, "close"), true);
  const starting = { ...idle, status: "starting" };
  assert.equal(terminalActionAvailable(starting, "restart"), false);
  assert.equal(terminalActionAvailable(starting, "clear"), false);
  assert.equal(terminalActionAvailable(starting, "close"), false);
});

test("task terminal header exposes cancellation only while the task owns the Terminal", () => {
  const descriptor = {
    sessionId: "review-1", workspaceRoot: "/repo", taskKey: "android.gradle:assembleDebug",
    label: "assembleDebug", executablePath: "/repo/gradlew", args: ["assembleDebug"],
    workingDirectory: "/repo", cancel() {},
  };
  const active = { descriptor, status: "running", error: null, outputTruncated: false };
  const activeHeader = renderTaskTerminalHeader(active, EN_US.terminal);
  assert.match(activeHeader, /assembleDebug — Running/u);
  assert.doesNotMatch(activeHeader, /data-terminal-action="close"[^>]*disabled/u);
  assert.match(activeHeader, /data-terminal-action="restart"[^>]*disabled/u);
  assert.equal(taskTerminalActionAvailable("running", "close"), true);
  assert.equal(taskTerminalActionAvailable("running", "restart"), false);

  const finishedHeader = renderTaskTerminalHeader({ ...active, status: "succeeded" }, EN_US.terminal);
  assert.match(finishedHeader, /assembleDebug — Succeeded/u);
  assert.match(finishedHeader, /data-terminal-action="close"[^>]*disabled/u);
  assert.match(finishedHeader, /data-terminal-action="restart"[^>]*disabled/u);
  assert.equal(taskTerminalActionAvailable("succeeded", "restart"), false);
  assert.equal(taskTerminalInteractionMode("running"), "task-running");
  for (const status of ["succeeded", "failed", "cancelled", "crashed"]) {
    assert.equal(taskTerminalInteractionMode(status), "idle");
  }
  assert.equal(terminalInteractionMode(idle), "idle");
  assert.equal(terminalInteractionMode({ ...idle, status: "running", sessionId: "shell-1" }), "interactive");
  assert.equal(shouldAutoStartShell(false, idle), true);
  assert.equal(shouldAutoStartShell(true, idle), false);
});

test("idle terminals reject input and hide the live cursor", () => {
  const classes = new Set();
  const writes = [];
  const terminal = {
    options: { disableStdin: false, cursorBlink: true, cursorInactiveStyle: "outline" },
    write(value) { writes.push(value); },
  };
  const terminalView = Object.create(TerminalView.prototype);
  terminalView.parent = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  terminalView.terminal = terminal;

  terminalView.setInteractionMode("idle");
  assert.equal(terminal.options.disableStdin, true);
  assert.equal(terminal.options.cursorBlink, false);
  assert.equal(terminal.options.cursorInactiveStyle, "none");
  assert.equal(classes.has("terminal-session-idle"), true);
  assert.equal(writes.at(-1), "\x1b[?25l");

  terminalView.setInteractionMode("interactive");
  assert.equal(terminal.options.disableStdin, false);
  assert.equal(terminal.options.cursorBlink, true);
  assert.equal(terminal.options.cursorInactiveStyle, "outline");
  assert.equal(classes.has("terminal-session-idle"), false);
  assert.equal(writes.at(-1), "\x1b[?25h");
});

test("clearing terminal content does not re-arm automatic shell startup", () => {
  const view = new TerminalView();
  let resets = 0;
  let clears = 0;
  let finishPendingWrites = () => undefined;
  view.ready = true;
  view.terminal = {
    options: { disableStdin: false, cursorBlink: true, cursorInactiveStyle: "outline" },
    write(_value, callback) { if (callback) finishPendingWrites = callback; },
    reset() { resets += 1; },
    clear() { clears += 1; },
  };

  view.reset();

  assert.equal(resets, 0);
  assert.equal(clears, 0);
  finishPendingWrites();
  assert.equal(resets, 1);
  assert.equal(clears, 1);
  assert.equal(view.ready, true);
});

test("a shell tab starts before the lazy terminal renderer reports dimensions", async () => {
  const starts = [];
  const bridge = {
    native: true,
    async subscribeTerminal() { return () => undefined; },
    async startTerminal(workspaceRoot, cols, rows) {
      starts.push({ workspaceRoot, cols, rows });
      return { protocolVersion: 1, sessionId: "shell-1", shell: "zsh", cwd: workspaceRoot };
    },
    async writeTerminal() {}, async resizeTerminal() {}, async closeTerminal() { return true; },
  };
  const tab = new TerminalShellTab(bridge, "/repo", EN_US.terminal, {
    status() {}, error() {}, changed() {},
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(starts, [{ workspaceRoot: "/repo", cols: 80, rows: 24 }]);
  assert.equal(tab.state.status, "running");
  tab.dispose();
});

test("a completed task retains its transcript in its own terminal tab", () => {
  const header = {
    dataset: {}, innerHTML: "",
    classList: { toggle() {} },
    addEventListener() {},
  };
  const root = {
    querySelector(selector) { return selector === "#terminal-header-actions" ? header : null; },
  };
  const bridge = {
    async subscribeTerminal() { return () => undefined; },
    async startTerminal() { throw new Error("task tabs do not start a shell"); },
    async writeTerminal() {}, async resizeTerminal() {}, async closeTerminal() { return true; },
  };
  const panel = new TerminalPanel(root, bridge, EN_US.terminal, { status() {}, error() {} });
  panel.beginTask({
    sessionId: "review-1", workspaceRoot: "/repo", taskKey: "android.gradle:assembleDebug",
    label: "assembleDebug", executablePath: "/repo/gradlew", args: ["assembleDebug"],
    workingDirectory: "/repo", cancel() {},
  });
  assert.equal(panel.revealTask("review-1"), true);
  panel.appendTask("review-1", {
    stream: "stdout",
    dataBase64: Buffer.from("BUILD SUCCESSFUL\n", "utf8").toString("base64"),
  });

  panel.updateTask("review-1", "succeeded", null, false);

  assert.equal(panel.revealTask("review-1"), true);
  assert.match(header.innerHTML, /assembleDebug — Succeeded/u);
  assert.match(header.innerHTML, /data-terminal-action="restart"[^>]*disabled/u);
  const task = [...panel.resources.values()][0];
  const retained = task.view.pendingWrites.drain();
  const transcript = retained.chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
  assert.match(transcript, /assembleDebug/u);
  assert.match(transcript, /BUILD SUCCESSFUL\r\n/u);
  assert.equal(panel.tabs.tabs[0].taskTerminal, true);
  panel.dispose();
});

test("every terminal task result retains output and remains revealable", () => {
  for (const status of ["succeeded", "failed", "cancelled", "crashed"]) {
    const bridge = {
      async subscribeTerminal() { return () => undefined; },
      async startTerminal() { throw new Error("lazy handoff should wait for terminal dimensions"); },
      async writeTerminal() {}, async resizeTerminal() {}, async closeTerminal() { return true; },
    };
    const panel = new TerminalPanel({ querySelector() { return null; } }, bridge, EN_US.terminal, {
      status() {}, error() {},
    });
    panel.beginTask({
      sessionId: `review-${status}`, workspaceRoot: "/repo", taskKey: "android.gradle:assembleDebug",
      label: "assembleDebug", executablePath: "/repo/gradlew", args: ["assembleDebug"],
      workingDirectory: "/repo", cancel() {},
    });
    panel.appendTask(`review-${status}`, {
      stream: "stderr",
      dataBase64: Buffer.from(`terminal-${status}\n`, "utf8").toString("base64"),
    });

    panel.updateTask(`review-${status}`, status, status === "failed" ? "failed" : null, false);

    const task = [...panel.resources.values()][0];
    const pending = task.view.pendingWrites.drain();
    const transcript = pending.chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
    assert.match(transcript, new RegExp(`terminal-${status}\\r\\n`, "u"));
    assert.equal(panel.revealTask(`review-${status}`), true);
    assert.equal(panel.tabs.tabs[0].taskTerminal, true);
    panel.dispose();
  }
});

test("reviewed task command summary is display-only and escapes terminal controls", () => {
  const line = taskTerminalCommandLine({
    sessionId: "review-1", workspaceRoot: "/repo", taskKey: "task", label: "Build\u001b[2J",
    executablePath: "/repo/grad lew", args: ["hello world", "$(touch nope)", "\u001b[31mred"],
    workingDirectory: "/repo", cancel() {},
  });
  assert.match(line, /# Build \[2J\r\n/u);
  assert.match(line, /"\/repo\/grad lew" "hello world" "\$\(touch nope\)" "\\u001b\[31mred"/u);
  assert.equal(line.includes("\u001b[2J"), false);
});

test("terminal pre-mount output buffer is bounded and reports omitted bytes", () => {
  const buffer = new TerminalWriteBuffer(5);
  buffer.push(Uint8Array.from([1, 2, 3]));
  buffer.push(Uint8Array.from([4, 5, 6, 7]));
  const drained = buffer.drain();
  assert.equal(drained.omittedBytes, 3);
  assert.deepEqual([...drained.chunks[0]], [4, 5, 6, 7]);
  assert.deepEqual(buffer.drain(), { chunks: [], omittedBytes: 0 });
});

test("task pipe output converts bare LF to CRLF across frame boundaries", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const first = normalizeTaskTerminalOutput(encoder.encode("one\ntwo\r"));
  assert.equal(decoder.decode(first.bytes), "one\r\ntwo\r");
  assert.equal(first.outputEndedWithCarriageReturn, true);
  const second = normalizeTaskTerminalOutput(encoder.encode("\nthree\nfour\rprogress"), first.outputEndedWithCarriageReturn);
  assert.equal(decoder.decode(second.bytes), "\nthree\r\nfour\rprogress");
  assert.equal(second.outputEndedWithCarriageReturn, false);
});
