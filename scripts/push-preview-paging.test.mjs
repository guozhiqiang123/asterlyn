import assert from "node:assert/strict";
import test from "node:test";

import {
  bindPushPreviewPaging,
  loadPushPreviewPageNearBottom,
  shouldLoadPushPreviewPage,
} from "../src/features/remote-push/push-preview-paging.ts";

const ready = {
  dialogOpen: true,
  hasMore: true,
  loadingMore: false,
  pagingFailed: false,
};

test("Push preview requests its next page near the same 72px boundary as Git History", () => {
  assert.equal(shouldLoadPushPreviewPage({
    scrollTop: 827,
    scrollHeight: 1000,
    clientHeight: 100,
  }, ready), false);
  assert.equal(shouldLoadPushPreviewPage({
    scrollTop: 828,
    scrollHeight: 1000,
    clientHeight: 100,
  }, ready), true);
});

test("Push preview paging rejects closed, complete, busy, and failed states", () => {
  const metrics = { scrollTop: 900, scrollHeight: 1000, clientHeight: 100 };
  for (const state of [
    { ...ready, dialogOpen: false },
    { ...ready, hasMore: false },
    { ...ready, loadingMore: true },
    { ...ready, pagingFailed: true },
  ]) {
    assert.equal(shouldLoadPushPreviewPage(metrics, state), false);
  }
});

test("Push preview scroll activation invokes one guarded page request", () => {
  let loads = 0;
  const activated = loadPushPreviewPageNearBottom(
    { scrollTop: 850, scrollHeight: 1000, clientHeight: 100 },
    ready,
    () => { loads += 1; },
  );
  assert.equal(activated, true);
  assert.equal(loads, 1);

  assert.equal(loadPushPreviewPageNearBottom(
    { scrollTop: 100, scrollHeight: 1000, clientHeight: 100 },
    ready,
    () => { loads += 1; },
  ), false);
  assert.equal(loads, 1);
});

test("Push preview paging binding listens to scroll and downward wheel only", () => {
  const host = new FakeScrollHost();
  let loads = 0;
  const release = bindPushPreviewPaging(host, () => ready, () => { loads += 1; });

  host.scrollTop = 850;
  host.dispatchEvent(new Event("scroll"));
  assert.equal(loads, 1);
  host.dispatchEvent(wheel(-10));
  assert.equal(loads, 1);
  host.dispatchEvent(wheel(10));
  assert.equal(loads, 2);

  release();
  host.dispatchEvent(new Event("scroll"));
  assert.equal(loads, 2);
});

class FakeScrollHost extends EventTarget {
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 100;
}

function wheel(deltaY) {
  const event = new Event("wheel");
  Object.defineProperty(event, "deltaY", { value: deltaY });
  return event;
}
