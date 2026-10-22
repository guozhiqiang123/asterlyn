import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  BUNDLED_ANDROID_PACKAGE_URL,
  readBundledAndroidManifest,
} from "./plugin-package-fixture.mjs";

test("bundled Android plugin artifact matches the host-pinned isolated identity", async () => {
  const artifact = await readFile(BUNDLED_ANDROID_PACKAGE_URL);
  const manifest = await readBundledAndroidManifest();
  const hostSource = await readFile(new URL("../src-tauri/src/commands/plugin_marketplace.rs", import.meta.url), "utf8");
  const digest = createHash("sha256").update(artifact).digest("hex");
  assert.equal(digest, "36f4839f49e8723c455561d12bad5972c225c35a043e8527f0cff43a2b3c83af");
  assert.match(hostSource, new RegExp(`sha256:${digest}`, "u"));
  assert.equal(manifest.id, "dev.asterlyn.android-gradle");
  assert.equal(manifest.version, "0.5.10");
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.sdkMajor, 1);
  assert.deepEqual(manifest.hostOperations.map(({ id }) => id), [
    "adb.devices", "android.apk.inspect", "android.adb.install", "android.adb.uninstall", "android.adb.launch",
  ]);
  assert.equal(manifest.processQueries, undefined);
  assert.equal(manifest.toolOperations, undefined);
  assert.equal(manifest.localization.defaultLocale, "en-US");
  assert.equal(manifest.taskAuthorization.workspaceTrust.id, "workspaceTrust");
  assert.equal(
    manifest.taskAuthorization.taskConfirmation.rememberLabelKey,
    "authorization.rememberTask.label",
  );
  assert.equal(
    manifest.localization.locales["zh-CN"]["authorization.workspaceTrust.label"],
    "信任此工作区中的 Gradle 任务",
  );
  await assert.rejects(access(new URL("../node_modules/@asterlyn/plugin-android-gradle/", import.meta.url)));
  await assert.rejects(access(new URL("../src/plugins/android-gradle/", import.meta.url)));
});
