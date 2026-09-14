import assert from "node:assert/strict";
import test from "node:test";

class FakeElement extends EventTarget {
  constructor(closest = null) {
    super();
    this.match = closest;
  }

  closest() {
    return this.match;
  }
}

class FakeButton extends FakeElement {
  constructor(kind) {
    super();
    this.match = this;
    this.dataset = { remoteAction: kind };
  }
}

globalThis.Element = FakeElement;
globalThis.HTMLButtonElement = FakeButton;

const {
  bindDelegatedRemoteActions,
  resolveDelegatedRemoteAction,
} = await import("../src/shell/shell-event-binding.ts");

test("remote actions remain delegated when a toolbar button is replaced", () => {
  let listener = null;
  let currentButton = new FakeButton("pull");
  const root = {
    addEventListener(type, next) {
      assert.equal(type, "click");
      listener = next;
    },
    contains(element) {
      return element === currentButton;
    },
  };
  const activations = [];
  bindDelegatedRemoteActions(root, new AbortController().signal, (kind, anchor) => {
    activations.push({ kind, anchor });
  });

  listener({ target: new FakeElement(currentButton) });
  currentButton = new FakeButton("push");
  listener({ target: new FakeElement(currentButton) });

  assert.deepEqual(activations.map(({ kind }) => kind), ["pull", "push"]);
  assert.equal(activations[1].anchor, currentButton);
});

test("remote action delegation rejects unknown and out-of-root controls", () => {
  const unknown = new FakeButton("delete");
  assert.equal(resolveDelegatedRemoteAction({ contains: () => true }, unknown), null);

  const update = new FakeButton("pull");
  assert.equal(resolveDelegatedRemoteAction({ contains: () => false }, update), null);
});
