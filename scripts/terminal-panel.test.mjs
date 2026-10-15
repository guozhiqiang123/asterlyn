import assert from "node:assert/strict";
import test from "node:test";

import {
  renderTaskTerminalHeader,
  renderTerminalHeader,
  normalizeTaskTerminalOutput,
  taskTerminalActionAvailable,
  taskTerminalCommandLine,
  taskTerminalInteractionMode,
  terminalActionAvailable,
} from "../src/features/terminal/terminal-panel.ts";
import { TerminalView, TerminalWriteBuffer } from "../src/features/terminal/terminal-view.ts";
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

test("task terminal header exposes cancel while active and new session after completion", () => {
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
  assert.doesNotMatch(finishedHeader, /data-terminal-action="restart"[^>]*disabled/u);
  assert.equal(taskTerminalInteractionMode("running"), "task-running");
  assert.equal(taskTerminalInteractionMode("failed"), "task-complete");
});

test("completed task terminals become read-only and lose their live cursor", () => {
  const classes = new Set();
  const terminal = {
    options: { disableStdin: false, cursorBlink: true, cursorInactiveStyle: "outline" },
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

  terminalView.setInteractionMode("task-complete");
  assert.equal(terminal.options.disableStdin, true);
  assert.equal(terminal.options.cursorBlink, false);
  assert.equal(terminal.options.cursorInactiveStyle, "none");
  assert.equal(classes.has("terminal-task-complete"), true);

  terminalView.setInteractionMode("interactive");
  assert.equal(terminal.options.disableStdin, false);
  assert.equal(terminal.options.cursorBlink, true);
  assert.equal(terminal.options.cursorInactiveStyle, "outline");
  assert.equal(classes.has("terminal-task-complete"), false);
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
