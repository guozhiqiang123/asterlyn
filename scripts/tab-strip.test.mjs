import assert from "node:assert/strict";
import test from "node:test";

import {
  revealTabInStrip,
  scrollTabStrip,
} from "../src/workbench/tab-strip.ts";

test("vertical wheels move an overflowing editor tab strip horizontally", () => {
  const strip = { clientWidth: 300, scrollLeft: 40, scrollWidth: 900 };
  assert.equal(scrollTabStrip(strip, 0, 120), true);
  assert.equal(strip.scrollLeft, 160);
});

test("horizontal deltas win and tab scrolling stays bounded", () => {
  const strip = { clientWidth: 300, scrollLeft: 580, scrollWidth: 900 };
  assert.equal(scrollTabStrip(strip, 80, 20), true);
  assert.equal(strip.scrollLeft, 600);
  assert.equal(scrollTabStrip(strip, 80, 20), false);
  assert.equal(strip.scrollLeft, 600);
});

test("a tab strip without overflow leaves the page wheel untouched", () => {
  const strip = { clientWidth: 300, scrollLeft: 0, scrollWidth: 300 };
  assert.equal(scrollTabStrip(strip, 0, 100), false);
  assert.equal(strip.scrollLeft, 0);
});

test("activating a clipped tab reveals only the required horizontal range", () => {
  const strip = { clientWidth: 300, scrollLeft: 200, scrollWidth: 900 };
  assert.equal(
    revealTabInStrip(strip, { offsetLeft: 580, offsetWidth: 140 }),
    true,
  );
  assert.equal(strip.scrollLeft, 424);

  assert.equal(
    revealTabInStrip(strip, { offsetLeft: 250, offsetWidth: 120 }),
    true,
  );
  assert.equal(strip.scrollLeft, 246);

  assert.equal(
    revealTabInStrip(strip, { offsetLeft: 300, offsetWidth: 120 }),
    false,
  );
});
