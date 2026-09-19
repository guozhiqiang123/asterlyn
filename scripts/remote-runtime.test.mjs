import assert from "node:assert/strict";
import test from "node:test";

import { RemoteRuntime } from "../src/features/remote-push/remote-runtime.ts";
import { EN_US } from "../src/localization/en-US.ts";

test("Remote runtime owns both controller subscriptions and disposal", () => {
  const notifications = [];
  const runtime = new RemoteRuntime(
    {
      push: {},
      authentication: {},
    },
    { remote: EN_US.remote, errors: EN_US.errors },
    {
      pushChanged: (change) => notifications.push(change.reason),
      authenticationChanged: () => notifications.push("authentication"),
    },
  );

  runtime.push.installSnapshot(null);
  assert.deepEqual(notifications, ["snapshot"]);
  runtime.dispose();
  runtime.dispose();
  runtime.push.installSnapshot(null);
  runtime.authentication.close();
  assert.deepEqual(notifications, ["snapshot"]);
});
