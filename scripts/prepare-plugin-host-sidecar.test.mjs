import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  preparePluginHostSidecar,
  resolveTargetTriple,
  sidecarBuildPlan,
} from "./prepare-plugin-host-sidecar.mjs";

test("sidecar build plan pins the requested target and Tauri filename", () => {
  const plan = sidecarBuildPlan({
    projectRoot: "/workspace/asterlyn",
    targetTriple: "aarch64-apple-darwin",
  });
  assert.deepEqual(plan.cargoArguments, [
    "build",
    "--locked",
    "-p",
    "asterlyn-plugin-host",
    "--target",
    "aarch64-apple-darwin",
    "--release",
  ]);
  assert.equal(
    plan.destination,
    "/workspace/asterlyn/src-tauri/binaries/asterlyn-plugin-host-aarch64-apple-darwin",
  );
});

test("Windows sidecar plan uses the executable suffix", () => {
  const plan = sidecarBuildPlan({
    projectRoot: "C:/workspace/asterlyn",
    targetTriple: "x86_64-pc-windows-msvc",
    debug: true,
  });
  assert.equal(plan.extension, ".exe");
  assert.ok(plan.source.endsWith("asterlyn-plugin-host.exe"));
  assert.ok(plan.destination.endsWith("x86_64-pc-windows-msvc.exe"));
  assert.equal(plan.cargoArguments.includes("--release"), false);
});

test("target resolution prefers Tauri's exact build target and rejects path input", () => {
  assert.equal(
    resolveTargetTriple({ TAURI_ENV_TARGET_TRIPLE: "x86_64-unknown-linux-gnu" }, () => "unused"),
    "x86_64-unknown-linux-gnu",
  );
  assert.throws(
    () => resolveTargetTriple({ TAURI_ENV_TARGET_TRIPLE: "../escape" }, () => "unused"),
    /invalid plugin-host target triple/u,
  );
});

test("sidecar preparation atomically copies the exact built helper", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "asterlyn-sidecar-"));
  const plan = sidecarBuildPlan({
    projectRoot,
    targetTriple: "x86_64-unknown-linux-gnu",
  });
  let invocation = null;
  const result = preparePluginHostSidecar({
    projectRoot,
    environment: { TAURI_ENV_TARGET_TRIPLE: plan.targetTriple },
    runCargo: (command, arguments_, cwd) => {
      invocation = { command, arguments_, cwd };
      mkdirSync(join(projectRoot, "target", plan.targetTriple, "release"), { recursive: true });
      writeFileSync(plan.source, "helper-bytes");
    },
  });
  assert.deepEqual(invocation, {
    command: "cargo",
    arguments_: plan.cargoArguments,
    cwd: projectRoot,
  });
  assert.equal(result.destination, plan.destination);
  assert.equal(readFileSync(plan.destination, "utf8"), "helper-bytes");
});

test("Tauri packages only the prepared host-owned plugin helper", () => {
  const configuration = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(configuration.bundle.externalBin, ["binaries/asterlyn-plugin-host"]);
  assert.match(configuration.build.beforeBuildCommand, /prepare-plugin-host-sidecar\.mjs/u);
  assert.match(configuration.build.beforeDevCommand, /prepare-plugin-host-sidecar\.mjs/u);
});

test("quality and release gates prepare the sidecar before Rust workspace tests", () => {
  for (const workflow of ["package-preview.yml", "release.yml"]) {
    const source = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8");
    const prepare = source.indexOf("name: Prepare plugin host sidecar");
    const testWorkspace = source.indexOf("name: Test Rust workspace");
    assert.notEqual(prepare, -1, `${workflow} must prepare the plugin host sidecar`);
    assert.ok(prepare < testWorkspace, `${workflow} must prepare the sidecar before Rust tests`);
    assert.match(source.slice(prepare, testWorkspace), /TAURI_ENV_DEBUG:\s*["']true["']/u);
  }
});
