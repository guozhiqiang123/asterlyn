import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("desktop PNG icons keep their generated dimensions", () => {
  const expected = new Map([
    ["src-tauri/icons/32x32.png", [32, 32]],
    ["src-tauri/icons/48x48.png", [48, 48]],
    ["src-tauri/icons/128x128.png", [128, 128]],
    ["src-tauri/icons/128x128@2x.png", [256, 256]],
    ["src-tauri/icons/icon.png", [512, 512]],
  ]);

  for (const [path, dimensions] of expected) {
    assert.deepEqual(readPngDimensions(path), dimensions, path);
  }
});

test("Windows icon contains the required display frames", () => {
  const icon = read("src-tauri/icons/icon.ico");
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  const count = icon.readUInt16LE(4);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    frames.push([icon[offset] || 256, icon[offset + 1] || 256]);
  }
  assert.deepEqual(
    frames.sort(([left], [right]) => left - right),
    [16, 24, 32, 48, 64, 256].map((size) => [size, size]),
  );
});

test("macOS icon contains modern Retina frames", () => {
  const icon = read("src-tauri/icons/icon.icns");
  assert.equal(icon.toString("ascii", 0, 4), "icns");
  const frames = new Set();
  for (let offset = 8; offset + 8 <= icon.length; ) {
    const type = icon.toString("ascii", offset, offset + 4);
    const length = icon.readUInt32BE(offset + 4);
    assert.ok(length >= 8, `invalid ${type} frame length`);
    frames.add(type);
    offset += length;
  }
  for (const type of ["ic07", "ic08", "ic09", "ic10"]) {
    assert.ok(frames.has(type), `missing ${type} frame`);
  }
});

test("the source SVG uses the full canvas without legacy transparent padding", () => {
  const source = read("assets/asterlyn-mark.svg").toString("utf8");
  assert.match(source, /data-canvas-fit="full-bleed"/);
  assert.doesNotMatch(source, /data-safe-inset|translate\(40 40\)/);
});

test("only the maintained desktop icon set remains", () => {
  const maintained = [
    "32x32.png",
    "48x48.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon.ico",
    "icon.icns",
  ];
  assert.deepEqual(readDirectory("src-tauri/icons").sort(), maintained.sort());
});

function readPngDimensions(path) {
  const image = read(path);
  assert.equal(image.toString("hex", 0, 8), "89504e470d0a1a0a", path);
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

function read(path) {
  return readFileSync(`${repositoryRoot}${path}`);
}

function readDirectory(path) {
  return readdirSync(`${repositoryRoot}${path}`, { withFileTypes: true }).map(
    (entry) => entry.name,
  );
}
