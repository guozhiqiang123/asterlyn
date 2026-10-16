import assert from "node:assert/strict";
import test from "node:test";

import { TerminalEventRouter } from "../src/features/terminal/terminal-event-router.ts";

test("terminal event router shares one native subscription and isolates listeners", async () => {
  let nativeListener = null;
  let subscriptions = 0;
  let releases = 0;
  const router = new TerminalEventRouter({
    async subscribeTerminal(listener) {
      subscriptions += 1;
      nativeListener = listener;
      return () => { releases += 1; };
    },
  });
  const first = [];
  const second = [];
  const releaseFirst = await router.subscribeTerminal((event) => first.push(event.sessionId));
  const releaseSecond = await router.subscribeTerminal((event) => second.push(event.sessionId));
  assert.equal(subscriptions, 1);

  nativeListener({ protocolVersion: 1, kind: "exited", sessionId: "one", exitCode: 0, signal: null });
  assert.deepEqual(first, ["one"]);
  assert.deepEqual(second, ["one"]);
  releaseFirst();
  nativeListener({ protocolVersion: 1, kind: "exited", sessionId: "two", exitCode: 0, signal: null });
  assert.deepEqual(first, ["one"]);
  assert.deepEqual(second, ["one", "two"]);

  releaseSecond();
  router.dispose();
  router.dispose();
  assert.equal(releases, 1);
});
