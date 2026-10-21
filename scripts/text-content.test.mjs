import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExactTextChanges,
  computeTextChange,
  decodeExactText,
  encodeExactText,
} from "../src/features/files-editor/text-content.ts";
import {
  applyLineSeparatorChanges,
  countLineSeparators,
} from "../src/features/files-editor/text-line-separators.ts";

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

test("multiple descending edits retain untouched mixed separators", () => {
  const source = decodeExactText("one\r\ntwo\nthree\r\nfour");
  const edited = applyExactTextChanges(source, [
    { from: 0, to: 3, insert: "ONE" },
    { from: 8, to: 13, insert: "THREE\n3.5" },
  ]);
  assert.equal(encodeExactText(edited), "ONE\r\ntwo\nTHREE\r\n3.5\r\nfour");
});

test("incremental separator metadata updates only changed line boundaries", () => {
  const content = decodeExactText("one\r\ntwo\nthree\r\nfour");
  const counts = countLineSeparators(content.separators);
  applyLineSeparatorChanges(content, counts, [
    { separatorStart: 0, removedSeparators: 0, insertedSeparators: 1 },
    { separatorStart: 2, removedSeparators: 1, insertedSeparators: 2 },
  ]);
  content.text = "ONE\n1.5\ntwo\nTHREE\n3.5\nfour";

  assert.deepEqual(content.separators, ["\r\n", "\r\n", "\n", "\r\n", "\r\n"]);
  assert.deepEqual(counts, { lf: 1, crlf: 4 });
  assert.equal(encodeExactText(content), "ONE\r\n1.5\r\ntwo\nTHREE\r\n3.5\r\nfour");
});

test("computeTextChange identifies minimal diff range or null for identical text", () => {
  assert.equal(computeTextChange("hello world", "hello world"), null);
  assert.deepEqual(computeTextChange("hello world", "hello beautiful world"), {
    from: 6,
    to: 6,
    insert: "beautiful ",
  });
  assert.deepEqual(computeTextChange("hello world", "hello"), {
    from: 5,
    to: 11,
    insert: "",
  });
  assert.deepEqual(computeTextChange("abcde", "abXde"), {
    from: 2,
    to: 3,
    insert: "X",
  });
});

