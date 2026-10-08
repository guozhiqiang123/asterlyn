import assert from "node:assert/strict";
import test from "node:test";
import {
  linkHorizontalScroll,
  linkHorizontalScrollGroup,
  linkScrollElements,
  linkVerticalScroll,
  linkVerticalScrollByDocument,
  linkVerticalScrollProportionally,
} from "../src/presentation/linked-scroll.ts";

class FakeScroller {
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight;
  scrollWidth;
  clientHeight = 100;
  clientWidth = 100;
  scrollToCalls = 0;
  #listeners = new Set();
  #pending = 0;

  constructor(scrollWidth, scrollHeight) {
    this.scrollWidth = scrollWidth;
    this.scrollHeight = scrollHeight;
  }

  addEventListener(_type, listener) {
    this.#listeners.add(listener);
  }

  removeEventListener(_type, listener) {
    this.#listeners.delete(listener);
  }

  scrollTo(left, top) {
    const nextLeft = Math.min(left, this.scrollWidth - this.clientWidth);
    const nextTop = Math.min(top, this.scrollHeight - this.clientHeight);
    if (nextLeft === this.scrollLeft && nextTop === this.scrollTop) return;
    this.scrollToCalls += 1;
    this.scrollLeft = nextLeft;
    this.scrollTop = nextTop;
    this.#pending += 1;
  }

  userScroll(left, top) {
    this.scrollLeft = Math.min(left, this.scrollWidth - this.clientWidth);
    this.scrollTop = Math.min(top, this.scrollHeight - this.clientHeight);
    this.#emit();
  }

  flush() {
    while (this.#pending > 0) {
      this.#pending -= 1;
      this.#emit();
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}

class FakeFrameScheduler {
  #nextHandle = 1;
  #callbacks = new Map();

  request(callback) {
    const handle = this.#nextHandle++;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle) {
    this.#callbacks.delete(handle);
  }

  flush() {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback();
  }

  get size() {
    return this.#callbacks.size;
  }
}

class FakeDocumentView {
  constructor(blocks) {
    this.blocks = blocks;
    this.contentHeight = blocks.at(-1).top + blocks.at(-1).height;
  }

  lineBlockAtHeight(height) {
    return this.blocks.find((block) => height < block.top + block.height) ?? this.blocks.at(-1);
  }

  lineBlockAt(position) {
    return this.blocks.find((block) => block.from <= position && position <= block.to) ?? this.blocks.at(-1);
  }
}

test("linked scroll mirrors both axes and respects unequal extents", () => {
  const short = new FakeScroller(140, 180);
  const long = new FakeScroller(300, 400);
  linkScrollElements(short, long);

  short.userScroll(30, 50);
  long.flush();
  assert.deepEqual([long.scrollLeft, long.scrollTop], [30, 50]);

  long.userScroll(160, 220);
  short.flush();
  assert.deepEqual([short.scrollLeft, short.scrollTop], [40, 80]);
  assert.deepEqual([long.scrollLeft, long.scrollTop], [160, 220]);

  long.userScroll(20, 60);
  short.flush();
  assert.deepEqual([short.scrollLeft, short.scrollTop], [20, 60]);
});

test("delayed and alternating scroll events settle without feedback", () => {
  const first = new FakeScroller(300, 400);
  const second = new FakeScroller(300, 400);
  const dispose = linkScrollElements(first, second);

  first.userScroll(40, 30);
  second.userScroll(70, 55);
  first.userScroll(65, 60);
  second.flush();
  first.flush();
  second.flush();

  assert.deepEqual([first.scrollLeft, first.scrollTop], [65, 60]);
  assert.deepEqual([second.scrollLeft, second.scrollTop], [65, 60]);
  dispose();
  first.userScroll(10, 10);
  assert.deepEqual([second.scrollLeft, second.scrollTop], [65, 60]);
});

test("horizontal-only linking mirrors offsets without touching vertical positions", () => {
  const first = new FakeScroller(700, 900);
  const second = new FakeScroller(900, 900);
  const dispose = linkHorizontalScroll(first, second);

  first.userScroll(120, 40);
  second.flush();
  assert.deepEqual([second.scrollLeft, second.scrollTop], [120, 0]);

  second.userScroll(260, 70);
  first.flush();
  assert.deepEqual([first.scrollLeft, first.scrollTop], [260, 40]);

  first.userScroll(700, 0);
  second.flush();
  assert.deepEqual([second.scrollLeft, second.scrollTop], [600, 70]);

  dispose();
  first.userScroll(10, 0);
  assert.equal(second.scrollLeft, 600);
});

test("horizontal group synchronizes every owner in one frame across unequal extents", () => {
  const paneA = new FakeScroller(900, 100);
  const paneB = new FakeScroller(900, 100);
  const editorA = new FakeScroller(700, 900);
  const editorB = new FakeScroller(300, 900);
  const scheduler = new FakeFrameScheduler();
  const dispose = linkHorizontalScrollGroup([paneA, paneB, editorA, editorB], scheduler);
  scheduler.flush();

  paneA.userScroll(400, 0);
  scheduler.flush();
  assert.deepEqual(
    [paneB.scrollLeft, editorA.scrollLeft, editorB.scrollLeft],
    [400, 300, 100],
  );
  paneB.flush();
  editorA.flush();
  editorB.flush();
  assert.equal(scheduler.size, 0);

  dispose();
  paneA.userScroll(80, 0);
  scheduler.flush();
  assert.equal(paneB.scrollLeft, 400);
});

test("vertical-only linking preserves independent horizontal offsets", () => {
  const first = new FakeScroller(600, 500);
  const second = new FakeScroller(800, 700);
  first.scrollLeft = 40;
  second.scrollLeft = 90;
  const dispose = linkVerticalScroll(first, second);

  first.userScroll(40, 180);
  second.flush();
  assert.deepEqual([second.scrollLeft, second.scrollTop], [90, 180]);
  dispose();
});

test("proportional vertical linking maps unequal document heights in both directions", () => {
  const source = new FakeScroller(500, 500);
  const preview = new FakeScroller(800, 1_100);
  source.scrollTop = 100;
  preview.scrollLeft = 45;
  const dispose = linkVerticalScrollProportionally(source, preview);

  assert.equal(preview.scrollTop, 250);
  assert.equal(preview.scrollLeft, 45);
  preview.flush();

  preview.userScroll(45, 750);
  source.flush();
  assert.equal(source.scrollTop, 300);
  assert.equal(source.scrollLeft, 0);

  dispose();
  source.userScroll(0, 40);
  assert.equal(preview.scrollTop, 750);
});

test("document-anchored vertical linking aligns the same Result block before the next frame", () => {
  const first = new FakeScroller(500, 400);
  const second = new FakeScroller(500, 500);
  const firstDocument = new FakeDocumentView([
    { from: 0, to: 9, top: 0, height: 20 },
    { from: 10, to: 19, top: 20, height: 20 },
    { from: 20, to: 29, top: 40, height: 20 },
  ]);
  const secondDocument = new FakeDocumentView([
    { from: 0, to: 9, top: 0, height: 40 },
    { from: 10, to: 19, top: 40, height: 20 },
    { from: 20, to: 29, top: 60, height: 40 },
  ]);
  const scheduler = new FakeFrameScheduler();
  linkVerticalScrollByDocument(first, second, firstDocument, secondDocument, scheduler);

  first.userScroll(0, 30);
  assert.equal(second.scrollTop, 50);
  assert.equal(scheduler.size, 0);
  second.flush();
  assert.equal(first.scrollTop, 30);

  second.userScroll(0, 80);
  assert.equal(first.scrollTop, 50);
  assert.equal(scheduler.size, 0);
  first.flush();
  assert.equal(second.scrollTop, 80);
});

test("proportional linking coalesces a scroll burst to the latest animation frame", () => {
  const source = new FakeScroller(500, 500);
  const preview = new FakeScroller(800, 1_100);
  const scheduler = new FakeFrameScheduler();
  const dispose = linkVerticalScrollProportionally(source, preview, scheduler);

  source.userScroll(0, 40);
  source.userScroll(0, 80);
  source.userScroll(0, 120);
  assert.equal(scheduler.size, 1);
  assert.equal(preview.scrollTop, 0);

  scheduler.flush();
  assert.equal(preview.scrollTop, 300);
  assert.equal(preview.scrollToCalls, 1);
  assert.equal(scheduler.size, 0);

  source.userScroll(0, 160);
  dispose();
  assert.equal(scheduler.size, 0);
  scheduler.flush();
  assert.equal(preview.scrollTop, 300);
});

test("opposite-side user input wins over a delayed programmatic scroll event", () => {
  const first = new FakeScroller(500, 500);
  const second = new FakeScroller(800, 1_100);
  const scheduler = new FakeFrameScheduler();
  linkVerticalScrollProportionally(first, second, scheduler);

  first.userScroll(0, 80);
  scheduler.flush();
  assert.equal(second.scrollTop, 200);

  second.userScroll(0, 700);
  second.flush();
  assert.equal(scheduler.size, 1);
  scheduler.flush();
  first.flush();

  assert.equal(first.scrollTop, 280);
  assert.equal(second.scrollTop, 700);
  assert.equal(scheduler.size, 0);
});
