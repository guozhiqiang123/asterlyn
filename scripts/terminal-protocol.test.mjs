import assert from "node:assert/strict";
import test from "node:test";

import { parseTerminalEvent } from "../src/protocol/terminal.ts";

test("terminal protocol accepts versioned output, exit, and failure events", () => {
  assert.deepEqual(
    parseTerminalEvent({
      protocolVersion: 1,
      kind: "output",
      sessionId: "terminal-1",
      sequence: 1,
      dataBase64: "aGVsbG8=",
    }),
    {
      protocolVersion: 1,
      kind: "output",
      sessionId: "terminal-1",
      sequence: 1,
      dataBase64: "aGVsbG8=",
    },
  );
  assert.equal(parseTerminalEvent({
    protocolVersion: 1,
    kind: "exited",
    sessionId: "terminal-1",
    exitCode: 0,
    signal: null,
  }).kind, "exited");
  assert.equal(parseTerminalEvent({
    protocolVersion: 1,
    kind: "error",
    sessionId: "terminal-1",
    message: "reader failed",
  }).kind, "error");
});

test("terminal protocol rejects stale and malformed event payloads", () => {
  assert.throws(
    () => parseTerminalEvent({ protocolVersion: 2, kind: "output" }),
    /unsupported protocol version/,
  );
  assert.throws(
    () => parseTerminalEvent({
      protocolVersion: 1,
      kind: "output",
      sessionId: "terminal-1",
      sequence: 0,
      dataBase64: "",
    }),
    /invalid sequence/,
  );
});
