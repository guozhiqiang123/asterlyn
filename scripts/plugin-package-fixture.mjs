import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

export const BUNDLED_ANDROID_PACKAGE_URL = new URL(
  "../src-tauri/resources/plugins/asterlyn-plugin-android-gradle-0.6.3.asterlyn-plugin.tgz",
  import.meta.url,
);

export async function readBundledAndroidManifest() {
  const archive = await readFile(BUNDLED_ANDROID_PACKAGE_URL);
  return JSON.parse(readTarEntry(gunzipSync(archive), "manifest.json").toString("utf8"));
}

function readTarEntry(archive, expectedName) {
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    const name = nullTerminated(header.subarray(0, 100));
    if (!name) break;
    const sizeText = nullTerminated(header.subarray(124, 136)).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid plugin tar entry size");
    const body = offset + 512;
    if (name === expectedName) return archive.subarray(body, body + size);
    offset = body + Math.ceil(size / 512) * 512;
  }
  throw new Error(`Plugin package entry was not found: ${expectedName}`);
}

function nullTerminated(value) {
  const end = value.indexOf(0);
  return value.subarray(0, end < 0 ? value.length : end).toString("utf8");
}
