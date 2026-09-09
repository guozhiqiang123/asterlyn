import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExactTextChanges,
  decodeExactText,
  encodeExactText,
} from "../src/workbench/text-content.ts";

test("exact text codec preserves mixed endings, bare CR, and final newline", () => {
  const source = "one\r\ntwo\nthree\rlast\r\n";
  const decoded = decodeExactText(source);
  assert.equal(decoded.text, "one\ntwo\nthree\rlast\n");
  assert.deepEqual(decoded.separators, ["\r\n", "\n", "\r\n"]);
  assert.equal(decoded.dominantSeparator, "\r\n");
  assert.equal(encodeExactText(decoded), source);
});

test("inserted lines use the dominant ending while untouched lines stay exact", () => {
  const source = decodeExactText("one\r\ntwo\nthree\r\n");
  const edited = applyExactTextChanges(source, [
    { from: 4, to: 4, insert: "inserted\n" },
  ]);
  assert.equal(encodeExactText(edited), "one\r\ninserted\r\ntwo\nthree\r\n");
});

test("deleting and replacing normalized ranges removes only addressed separators", () => {
  const source = decodeExactText("one\r\ntwo\nthree\r\n");
  const edited = applyExactTextChanges(source, [
    { from: 3, to: 4, insert: " / " },
  ]);
  assert.equal(encodeExactText(edited), "one / two\nthree\r\n");
  assert.throws(
    () => applyExactTextChanges(source, [{ from: -1, to: 0, insert: "" }]),
    RangeError,
  );
});
