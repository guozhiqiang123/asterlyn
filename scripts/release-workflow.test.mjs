import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseWorkflow = read(".github/workflows/release.yml");
const previewWorkflow = read(".github/workflows/package-preview.yml");
const releaseArtifactsScript = read("scripts/release-artifacts.mjs");

test("release workflow is tag-published and can rehearse without publishing", () => {
  assert.match(releaseWorkflow, /tags:\s*\n\s+- "v\*\.\*\.\*"/);
  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.match(releaseWorkflow, /permissions:\s*\n\s+contents: read/);
  assert.match(releaseWorkflow, /if: github\.ref_type == 'tag'/);
  assert.match(releaseWorkflow, /permissions:\s*\n\s+contents: write/);
  assert.match(releaseWorkflow, /verify-release-version\.mjs/);
  assert.match(releaseWorkflow, /git merge-base --is-ancestor/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(releaseWorkflow, /--verify-tag/);
});

test("zero-cost platform signing policy is explicit and fail-closed", () => {
  assert.equal(existsSync(`${repositoryRoot}.github/workflows/macos-signed.yml`), false);
  assert.doesNotMatch(releaseWorkflow, /secrets\./);
  assert.doesNotMatch(releaseWorkflow, /APPLE_CERTIFICATE|APPLE_ID|APPLE_PASSWORD|APPLE_TEAM_ID/);
  assert.match(releaseWorkflow, /apple_signing_identity: "-"/);
  assert.match(releaseWorkflow, /Signature=adhoc/);
  assert.match(releaseWorkflow, /commercial Apple signing authority unexpectedly entered/);
  assert.match(releaseWorkflow, /Get-AuthenticodeSignature/);
  assert.match(releaseWorkflow, /SignatureStatus]::NotSigned/);
  assert.match(releaseWorkflow, /not notarized/);
});

test("release evidence includes smoke checks, checksums, and SBOMs", () => {
  assert.match(releaseWorkflow, /smoke-native-app\.mjs/);
  assert.match(releaseWorkflow, /release-artifacts\.mjs stage/);
  assert.match(releaseWorkflow, /release-artifacts\.mjs verify/);
  assert.match(releaseWorkflow, /cargo-cyclonedx --version 0\.5\.9 --locked/);
  assert.match(releaseWorkflow, /npm sbom --sbom-format cyclonedx/);
  assert.match(releaseArtifactsScript, /SHA256SUMS/);
});

test("pull-request preview packaging remains credential-free and ad-hoc", () => {
  assert.match(previewWorkflow, /pull_request:/);
  assert.match(previewWorkflow, /apple_signing_identity: "-"/);
  assert.doesNotMatch(previewWorkflow, /secrets\.APPLE_/);
});

test("release versions are synchronized and tag-bound", () => {
  const valid = run("scripts/verify-release-version.mjs", "v0.1.0");
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /matches v0\.1\.0/);

  const invalid = run("scripts/verify-release-version.mjs", "v9.9.9");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /does not match v0\.1\.0/);
});

test("release artifact staging and aggregate verification reject incomplete sets", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "asterlyn-release-test-"));
  const assets = path.join(fixture, "assets");
  const targets = [
    ["x86_64-unknown-linux-gnu", "linux", ["Asterlyn_0.1.0_amd64.AppImage", "Asterlyn_0.1.0_amd64.deb", "Asterlyn-0.1.0-1.x86_64.rpm"]],
    ["x86_64-pc-windows-msvc", "windows", ["Asterlyn_0.1.0_x64-setup.exe"]],
    ["aarch64-apple-darwin", "macos", ["Asterlyn_0.1.0_aarch64.dmg"]],
    ["x86_64-apple-darwin", "macos", ["Asterlyn_0.1.0_x64.dmg"]],
  ];

  for (const [target, platform, filenames] of targets) {
    const bundleRoot = path.join(fixture, target);
    mkdirSync(bundleRoot, { recursive: true });
    for (const filename of filenames) writeFileSync(path.join(bundleRoot, filename), `${target}:${filename}`);
    const staged = run("scripts/release-artifacts.mjs", "stage", bundleRoot, assets, target, platform);
    assert.equal(staged.status, 0, staged.stderr);
  }
  writeFileSync(path.join(assets, "asterlyn-frontend.cdx.json"), "{}");

  const verified = run(
    "scripts/release-artifacts.mjs",
    "verify",
    assets,
    ...targets.map(([target]) => target),
  );
  assert.equal(verified.status, 0, verified.stderr);
  const sums = readFileSync(path.join(assets, "SHA256SUMS"), "utf8");
  assert.match(sums, /Asterlyn_0\.1\.0_x64-setup\.exe/);
  assert.match(sums, /asterlyn-frontend\.cdx\.json/);

  writeFileSync(path.join(assets, "Asterlyn_0.1.0_x64-setup.exe"), "tampered");
  const rejected = run(
    "scripts/release-artifacts.mjs",
    "verify",
    assets,
    ...targets.map(([target]) => target),
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /checksum mismatch/);
});

function run(relativeScript, ...args) {
  return spawnSync(process.execPath, [path.join(repositoryRoot, relativeScript), ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}
