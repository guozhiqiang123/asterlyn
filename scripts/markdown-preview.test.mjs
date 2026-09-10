import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKDOWN_PREVIEW_MAX_BYTES,
  isMarkdownPath,
  renderMarkdownPreview,
} from "../src/workbench/markdown-preview.ts";

test("Markdown file matching stays explicit and excludes MDX", () => {
  assert.equal(isMarkdownPath("README.md"), true);
  assert.equal(isMarkdownPath("docs/GUIDE.MARKDOWN"), true);
  assert.equal(isMarkdownPath("notes.mdown"), true);
  assert.equal(isMarkdownPath("component.mdx"), false);
  assert.equal(isMarkdownPath("source.ts"), false);
});

test("Markdown preview renders common structure without executable HTML", async () => {
  const result = await renderMarkdownPreview(
    "# Heading\n\n- one\n- two\n\n<script>alert('unsafe')</script>\n",
  );
  assert.equal(result.status, "ready");
  assert.match(result.html, /<h1>Heading<\/h1>/u);
  assert.match(result.html, /<li>one<\/li>/u);
  assert.doesNotMatch(result.html, /<script>/u);
  assert.match(result.html, /&lt;script&gt;/u);
});

test("Markdown preview cannot fetch images or navigate links", async () => {
  const result = await renderMarkdownPreview(
    "![logo](https://example.invalid/tracker.png) [site](https://example.invalid)",
  );
  assert.equal(result.status, "ready");
  assert.doesNotMatch(result.html, /<img\b/u);
  assert.doesNotMatch(result.html, /<a\b/u);
  assert.match(result.html, /markdown-image-placeholder/u);
  assert.match(result.html, /markdown-link/u);
});

test("Markdown preview declines documents above its synchronous render budget", async () => {
  const result = await renderMarkdownPreview(
    "x".repeat(MARKDOWN_PREVIEW_MAX_BYTES + 1),
  );
  assert.equal(result.status, "too-large");
  assert.equal(result.html, "");
  assert.equal(result.byteLength, MARKDOWN_PREVIEW_MAX_BYTES + 1);
});
