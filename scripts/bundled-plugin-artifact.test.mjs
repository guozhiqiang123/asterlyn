import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  ANDROID_GRADLE_PLUGIN,
  ANDROID_GRADLE_PLUGIN_MANIFEST,
} from "@asterlyn/plugin-android-gradle";

const metadataUrl = new URL("../vendor/plugins/android-gradle-0.1.3.json", import.meta.url);

test("bundled Android plugin artifact matches the reviewed release identity", async () => {
  const metadata = JSON.parse(await readFile(metadataUrl, "utf8"));
  const artifact = await readFile(new URL(`../vendor/plugins/${metadata.artifact}`, import.meta.url));
  assert.equal(createHash("sha256").update(artifact).digest("hex"), metadata.sha256);
  assert.equal(metadata.pluginId, "dev.asterlyn.android-gradle");
  assert.equal(metadata.pluginVersion, "0.1.3");
  assert.equal(metadata.sdkVersion, "1.1.0");
  assert.equal(metadata.size, artifact.byteLength);
  assert.equal(ANDROID_GRADLE_PLUGIN.id, metadata.pluginId);
  assert.equal(ANDROID_GRADLE_PLUGIN.version, metadata.pluginVersion);
  assert.equal(ANDROID_GRADLE_PLUGIN.manifest, ANDROID_GRADLE_PLUGIN_MANIFEST);
  assert.equal(ANDROID_GRADLE_PLUGIN.manifest.localization.defaultLocale, "en-US");
  await assert.rejects(access(new URL("../src/plugins/android-gradle/", import.meta.url)));
});
