import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

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
  const frames = readIcnsFrames(icon);
  for (const type of ["ic07", "ic08", "ic09", "ic10"]) {
    assert.ok(frames.has(type), `missing ${type} frame`);
  }
});

test("macOS icon keeps a centered Launchpad visual margin", () => {
  const frames = readIcnsFrames(read("src-tauri/icons/icon.icns"));
  const bounds = readPngAlphaBounds(frames.get("ic10"));
  const occupiedWidth = (bounds.right - bounds.left + 1) / bounds.width;
  const occupiedHeight = (bounds.bottom - bounds.top + 1) / bounds.height;

  assert.ok(occupiedWidth >= 0.81 && occupiedWidth <= 0.84, occupiedWidth);
  assert.ok(occupiedHeight >= 0.81 && occupiedHeight <= 0.84, occupiedHeight);
  assert.ok(
    Math.abs((bounds.left + bounds.right + 1) / 2 - bounds.width / 2) <= 1,
  );
  assert.ok(
    Math.abs((bounds.top + bounds.bottom + 1) / 2 - bounds.height / 2) <= 1,
  );
});

test("Linux runtime window icon is not the 32 pixel bundle entry", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json").toString("utf8"));
  const runtimePng = config.bundle.icon.find((path) => path.endsWith(".png"));
  assert.equal(runtimePng, "icons/128x128.png");
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

function readIcnsFrames(icon) {
  const frames = new Map();
  for (let offset = 8; offset + 8 <= icon.length; ) {
    const type = icon.toString("ascii", offset, offset + 4);
    const length = icon.readUInt32BE(offset + 4);
    assert.ok(length >= 8, `invalid ${type} frame length`);
    assert.ok(offset + length <= icon.length, `truncated ${type} frame`);
    frames.set(type, icon.subarray(offset + 8, offset + length));
    offset += length;
  }
  return frames;
}

function readPngAlphaBounds(image) {
  assert.ok(image, "missing PNG frame");
  assert.equal(image.toString("hex", 0, 8), "89504e470d0a1a0a");
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  assert.equal(image[24], 8, "expected 8-bit PNG frame");
  assert.equal(image[25], 6, "expected RGBA PNG frame");
  assert.equal(image[28], 0, "expected non-interlaced PNG frame");

  const idat = [];
  for (let offset = 8; offset + 12 <= image.length; ) {
    const length = image.readUInt32BE(offset);
    const type = image.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(image.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  assert.equal(inflated.length, height * (stride + 1));
  let previous = Buffer.alloc(stride);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[offset];
    offset += 1;
    const row = Buffer.from(inflated.subarray(offset, offset + stride));
    offset += stride;
    unfilterPngRow(row, previous, filter, bytesPerPixel);
    for (let x = 0; x < width; x += 1) {
      if (row[x * bytesPerPixel + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    previous = row;
  }

  assert.ok(right >= left && bottom >= top, "PNG frame has no visible pixels");
  return { width, height, left, right, top, bottom };
}

function unfilterPngRow(row, previous, filter, bytesPerPixel) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const above = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    if (filter === 1) row[index] = (row[index] + left) & 0xff;
    else if (filter === 2) row[index] = (row[index] + above) & 0xff;
    else if (filter === 3)
      row[index] = (row[index] + Math.floor((left + above) / 2)) & 0xff;
    else if (filter === 4)
      row[index] = (row[index] + paeth(left, above, upperLeft)) & 0xff;
    else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
  }
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function read(path) {
  return readFileSync(`${repositoryRoot}${path}`);
}

function readDirectory(path) {
  return readdirSync(`${repositoryRoot}${path}`, { withFileTypes: true }).map(
    (entry) => entry.name,
  );
}
