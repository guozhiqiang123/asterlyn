import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentImageRequest,
  isImagePreviewPath,
} from "../src/workbench/image-preview.ts";

test("image preview routing covers the supported static formats", () => {
  for (const path of [
    "icon.PNG",
    "photo.jpeg",
    "photo.jpg",
    "sprite.gif",
    "asset.webp",
    "legacy.bmp",
    "windows.ico",
  ]) {
    assert.equal(isImagePreviewPath(path), true, path);
  }
});

test("image preview routing does not claim text, SVG, or extensionless files", () => {
  for (const path of ["README.md", "vector.svg", "image", ".png", "photo.png.txt"]) {
    assert.equal(isImagePreviewPath(path), false, path);
  }
});

test("image completion requires the current generation, workspace, and document", () => {
  const expected = {
    generation: 7,
    workspaceRoot: "/workspace/one",
    documentKey: "image\0/workspace/one\0workspace\0asset.png",
  };
  assert.equal(isCurrentImageRequest(expected, { ...expected }), true);
  assert.equal(isCurrentImageRequest(expected, { ...expected, generation: 8 }), false);
  assert.equal(
    isCurrentImageRequest(expected, { ...expected, workspaceRoot: "/workspace/two" }),
    false,
  );
  assert.equal(
    isCurrentImageRequest(expected, { ...expected, documentKey: "image\0other.png" }),
    false,
  );
});
