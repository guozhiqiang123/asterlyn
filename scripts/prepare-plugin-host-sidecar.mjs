import { copyFileSync, chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TARGET_TRIPLE_PATTERN = /^[A-Za-z0-9_.-]{3,128}$/u;
const WINDOWS_TARGET_PATTERN = /-windows-(?:gnu|gnullvm|msvc)$/u;

export function resolveTargetTriple(environment = process.env, rustc = runRustc) {
  const configured = environment.TAURI_ENV_TARGET_TRIPLE?.trim();
  const target = configured || rustc();
  if (!TARGET_TRIPLE_PATTERN.test(target) || target.includes("..")) {
    throw new Error(`invalid plugin-host target triple: ${target || "<empty>"}`);
  }
  return target;
}

export function sidecarBuildPlan({
  projectRoot,
  targetTriple,
  debug = false,
}) {
  if (!projectRoot) throw new Error("projectRoot is required");
  if (!TARGET_TRIPLE_PATTERN.test(targetTriple) || targetTriple.includes("..")) {
    throw new Error(`invalid plugin-host target triple: ${targetTriple || "<empty>"}`);
  }
  const profile = debug ? "debug" : "release";
  const extension = WINDOWS_TARGET_PATTERN.test(targetTriple) ? ".exe" : "";
  const targetRoot = resolve(projectRoot, "target", targetTriple, profile);
  return Object.freeze({
    targetTriple,
    profile,
    extension,
    cargoArguments: Object.freeze([
      "build",
      "--locked",
      "-p",
      "asterlyn-plugin-host",
      "--target",
      targetTriple,
      ...(debug ? [] : ["--release"]),
    ]),
    source: join(targetRoot, `asterlyn-plugin-host${extension}`),
    destination: resolve(
      projectRoot,
      "src-tauri",
      "binaries",
      `asterlyn-plugin-host-${targetTriple}${extension}`,
    ),
  });
}

export function preparePluginHostSidecar({
  projectRoot,
  environment = process.env,
  runCargo = run,
  rustc = runRustc,
} = {}) {
  const targetTriple = resolveTargetTriple(environment, rustc);
  const plan = sidecarBuildPlan({
    projectRoot,
    targetTriple,
    debug: environment.TAURI_ENV_DEBUG === "true",
  });
  runCargo("cargo", plan.cargoArguments, projectRoot);
  if (!existsSync(plan.source) || !statSync(plan.source).isFile()) {
    throw new Error(`plugin-host build did not produce ${plan.source}`);
  }

  mkdirSync(dirname(plan.destination), { recursive: true });
  const temporary = `${plan.destination}.next-${process.pid}`;
  rmSync(temporary, { force: true });
  try {
    copyFileSync(plan.source, temporary);
    if (!plan.extension) chmodSync(temporary, 0o755);
    renameSync(temporary, plan.destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return plan;
}

function runRustc() {
  const result = spawnSync("rustc", ["--print", "host-tuple"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`failed to resolve Rust host target: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(" ")} exited with ${result.status}`);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const projectRoot = resolve(dirname(scriptPath), "..");
  const plan = preparePluginHostSidecar({ projectRoot });
  console.log(`Prepared plugin host: ${plan.destination}`);
}
