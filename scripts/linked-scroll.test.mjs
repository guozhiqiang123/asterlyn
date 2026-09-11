import assert from "node:assert/strict";
import test from "node:test";
import {
  linkScrollElements,
  linkVerticalScrollProportionally,
} from "../src/workbench/linked-scroll.ts";

class FakeScroller {
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight;
  scrollWidth;
  clientHeight = 100;
  clientWidth = 100;
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
