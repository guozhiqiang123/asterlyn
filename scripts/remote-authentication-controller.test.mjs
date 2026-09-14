import assert from "node:assert/strict";
import test from "node:test";

import { RemoteAuthenticationController } from "../src/features/remote-push/remote-authentication-controller.ts";
import { ZH_CN } from "../src/localization/zh-CN.ts";

test("Push authentication preflight proceeds only with a local credential", async () => {
  const controller = createController({
    readRemoteAuthentication: async () => status({ credentialAvailable: true }),
  });

  assert.equal(await controller.check("/repo", "origin"), "ready");
  assert.equal(controller.state.dialog, null);
  assert.equal(controller.state.checking, false);
});

test("missing HTTPS credentials open a bounded authentication dialog before Push", async () => {
  const controller = createController({
    readRemoteAuthentication: async () => status(),
  });

  assert.equal(await controller.check("/repo", "origin"), "required");
  assert.equal(controller.state.dialog?.repositoryRoot, "/repo");
  assert.equal(controller.state.dialog?.status.host, "github.com");
  assert.equal(controller.state.dialog?.status.credentialAvailable, false);
});

test("a personal access token is forwarded once and never retained in controller state", async () => {
  let received = null;
  const controller = createController({
    readRemoteAuthentication: async () => status(),
    async storeRemoteHttpsCredential(repositoryRoot, remote, username, token) {
      received = { repositoryRoot, remote, username, token };
      return status({ credentialAvailable: true });
    },
  });
  await controller.check("/repo", "origin");

  assert.equal(await controller.storeHttpsCredential("developer", "secret-token"), "ready");
  assert.deepEqual(received, {
    repositoryRoot: "/repo",
    remote: "origin",
    username: "developer",
    token: "secret-token",
  });
  assert.doesNotMatch(JSON.stringify(controller.state), /secret-token/);
  assert.equal(controller.state.dialog, null);
});

test("SSH configuration remains in review until a local identity is detected", async () => {
  const controller = createController({
    readRemoteAuthentication: async () => status(),
    configureRemoteSsh: async () => status({
      transport: "ssh",
      credentialHelperConfigured: false,
      suggestedSshUrl: null,
    }),
  });
  await controller.check("/repo", "origin");

  assert.equal(
    await controller.configureSsh("git@github.com:owner/repository.git"),
    "failure",
  );
  assert.equal(controller.state.error, ZH_CN.remote.sshIdentityMissing);
  assert.equal(controller.state.dialog?.status.transport, "ssh");
});

test("late authentication results cannot reopen a closed dialog", async () => {
  const pending = deferred();
  const controller = createController({ readRemoteAuthentication: () => pending.promise });
  const check = controller.check("/repo", "origin");
  controller.close();
  pending.resolve(status());

  assert.equal(await check, "stale");
  assert.equal(controller.state.dialog, null);
});

test("rechecking an open dialog preserves it while the credential lookup runs", async () => {
  const pending = deferred();
  const controller = createController({ readRemoteAuthentication: () => pending.promise });
  controller.state.dialog = {
    repositoryRoot: "/repo",
    status: status(),
  };

  const check = controller.check("/repo", "origin");
  assert.equal(controller.state.checking, true);
  assert.equal(controller.state.dialog?.status.remote, "origin");

  pending.resolve(status());
  assert.equal(await check, "required");
});

test("missing secure credential managers produce localized recovery guidance", async () => {
  const controller = createController({
    readRemoteAuthentication: async () => status(),
    storeRemoteHttpsCredential: async () => {
      throw {
        kind: "invalidInput",
        field: "credential helper",
        message: "backend detail",
      };
    },
  });
  await controller.check("/repo", "origin");

  assert.equal(await controller.storeHttpsCredential("developer", "token"), "failure");
  assert.equal(controller.state.error, ZH_CN.remote.credentialHelperUnavailable);
});

function createController(overrides = {}) {
  return new RemoteAuthenticationController({
    readRemoteAuthentication: async () => status({ credentialAvailable: true }),
    storeRemoteHttpsCredential: async () => status({ credentialAvailable: true }),
    configureRemoteSsh: async () => status({
      transport: "ssh",
      credentialAvailable: true,
      credentialHelperConfigured: false,
      suggestedSshUrl: null,
    }),
    ...overrides,
  }, ZH_CN.remote, ZH_CN.errors);
}

function status(overrides = {}) {
  return {
    remote: "origin",
    transport: "https",
    host: "github.com",
    credentialAvailable: false,
    credentialHelperConfigured: true,
    suggestedSshUrl: "git@github.com:owner/repository.git",
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
