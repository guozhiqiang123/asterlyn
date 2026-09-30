import assert from "node:assert/strict";
import test from "node:test";

import {
  renderStartupFailure,
  startupFailureCopy,
  startupFailureMarkup,
} from "../src/startup-failure.ts";

test("selects a localized startup failure without exposing an exception", () => {
  assert.match(startupFailureCopy(["zh-CN"]).title, /未能启动/u);
  assert.equal(startupFailureCopy(["en-US"]).retry, "Reload");
  assert.doesNotMatch(startupFailureMarkup(startupFailureCopy(["en-US"])), /Error|stack|\.ts:/u);
});

test("renders a retryable alert when application startup rejects", () => {
  let clickHandler;
  let reloads = 0;
  const button = {
    addEventListener(type, handler) {
      assert.equal(type, "click");
      clickHandler = handler;
    },
  };
  const root = {
    innerHTML: "",
    querySelector(selector) {
      assert.equal(selector, "[data-startup-reload]");
      return button;
    },
  };
  const documentRef = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      assert.equal(selector, "#app");
      return root;
    },
  };

  assert.equal(
    renderStartupFailure(documentRef, ["zh-Hans"], () => { reloads += 1; }),
    true,
  );
  assert.equal(documentRef.documentElement.dataset.startupState, "failed");
  assert.match(root.innerHTML, /role="alert"/u);
  assert.match(root.innerHTML, /重新加载/u);
  clickHandler();
  assert.equal(reloads, 1);
});
