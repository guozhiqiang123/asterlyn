import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const signedWorkflow = read(".github/workflows/macos-signed.yml");
const previewWorkflow = read(".github/workflows/package-preview.yml");
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));

test("signed macOS packages use an isolated manual trust boundary", () => {
  assert.match(signedWorkflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(signedWorkflow, /\n\s+(push|pull_request|pull_request_target):/);
  assert.match(signedWorkflow, /environment: macos-signing/);
  assert.match(signedWorkflow, /permissions:\s*\n\s*contents: read/);
  assert.match(signedWorkflow, /needs: source-gate/);
  assert.match(signedWorkflow, /ASTERLYN_SIGNING_REF/);
  assert.match(signedWorkflow, /refs\/heads\/main/);
  assert.match(signedWorkflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(signedWorkflow, /persist-credentials: false/);
  assert.doesNotMatch(signedWorkflow, /APPLE_SIGNING_IDENTITY:\s*-/);
});

test("signed macOS packages scope protected Apple values", () => {
  for (const secret of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
  ]) {
    assert.match(signedWorkflow, new RegExp(`secrets\\.${secret}`), secret);
  }
  assert.match(signedWorkflow, /vars\.APPLE_TEAM_ID/);
  assert.doesNotMatch(signedWorkflow, /secrets\.KEYCHAIN_PASSWORD/);
  assert.match(signedWorkflow, /openssl rand -base64 32/);
  assert.match(signedWorkflow, /::add-mask::\$keychain_password/);
  assert.match(signedWorkflow, /Expected exactly one Developer ID Application identity/);
  assert.match(signedWorkflow, /does not match APPLE_TEAM_ID/);
});

test("signed artifacts fail closed on trust and installed-form checks", () => {
  assert.equal(tauriConfig.bundle.macOS.hardenedRuntime, true);
  assert.match(signedWorkflow, /runner: macos-15\n/);
  assert.match(signedWorkflow, /runner: macos-15-intel/);
  assert.match(signedWorkflow, /codesign --verify --deep --strict/);
  assert.match(signedWorkflow, /Authority=Developer ID Application:/);
  assert.match(signedWorkflow, /TeamIdentifier=\$EXPECTED_TEAM_ID/);
  assert.match(signedWorkflow, /flags=.*\\\(runtime\\\)/);
  assert.match(signedWorkflow, /Timestamp=none/);
  assert.match(signedWorkflow, /missing a secure signing timestamp/);
  assert.match(signedWorkflow, /Signature=adhoc/);
  assert.match(signedWorkflow, /spctl --assess --type execute/);
  assert.match(signedWorkflow, /context:primary-signature/);
  assert.match(signedWorkflow, /notarytool submit/);
  assert.match(signedWorkflow, /r\.status!=="Accepted"/);
  assert.match(signedWorkflow, /xcrun stapler validate/);
  assert.match(signedWorkflow, /ditto /);
  assert.match(signedWorkflow, /smoke-native-app\.mjs/);
  assert.match(signedWorkflow, /lipo -verify_arch/);
  assert.match(signedWorkflow, /security delete-keychain/);
  assert.match(signedWorkflow, /needs: package/);
  assert.match(signedWorkflow, /aarch64-apple-darwin x86_64-apple-darwin/);
  assert.match(signedWorkflow, /Expected exactly one DMG entry/);
  assert.match(signedWorkflow, /Checksum mismatch/);
});

test("pull-request preview packaging remains credential-free and ad-hoc", () => {
  assert.match(previewWorkflow, /pull_request:/);
  assert.match(previewWorkflow, /apple_signing_identity: "-"/);
  assert.doesNotMatch(previewWorkflow, /secrets\.APPLE_/);
  assert.doesNotMatch(previewWorkflow, /environment: macos-signing/);
});

function read(path) {
  return readFileSync(`${repositoryRoot}${path}`, "utf8");
}
