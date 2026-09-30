import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_OBSERVATION_MS = 6_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000;
const DEFAULT_PROBE_INTERVAL_MS = 250;
const MAX_CAPTURED_CHARACTERS = 32_768;

const MACOS_ACCESSIBILITY_SNAPSHOT = `on run argv
  set targetPid to item 1 of argv as integer
  set expectedVersion to item 2 of argv
  tell application "System Events"
    set targetProcesses to every application process whose unix id is targetPid
    if (count of targetProcesses) is 0 then return "PROCESS_MISSING"
    tell item 1 of targetProcesses
      if (count of windows) is 0 then return "WINDOW_MISSING"
      set windowElements to entire contents of window 1
      repeat with windowElement in windowElements
        try
          if (value of windowElement as text) is expectedVersion then return "READY"
        end try
      end repeat
      return "SHELL_MARKER_MISSING"
    end tell
  end tell
end run`;

export async function smokeProcess({
  command,
  args = [],
  observationMs = DEFAULT_OBSERVATION_MS,
  shutdownGraceMs = DEFAULT_SHUTDOWN_GRACE_MS,
  readinessProbe = null,
  probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  environment = process.env,
}) {
  if (!Number.isFinite(observationMs) || observationMs <= 0) {
    throw new Error("observationMs must be a positive number.");
  }
  if (!Number.isFinite(probeIntervalMs) || probeIntervalMs <= 0) {
    throw new Error("probeIntervalMs must be a positive number.");
  }

  let stdout = "";
  let stderr = "";
  const child = spawn(command, args, {
    detached: process.platform !== "win32",
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk.toString());
  });
  child.stderr?.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString());
  });

  const spawned = new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });

  await spawned;
  try {
    const outcome = readinessProbe
      ? await observeReadiness(child.pid, exited, readinessProbe, observationMs, probeIntervalMs)
      : await Promise.race([
        exited.then((exit) => ({ kind: "exit", exit })),
        delay(observationMs).then(() => ({ kind: "observed" })),
      ]);

    if (outcome.kind === "exit") {
      throw new Error(
        formatEarlyExit(command, observationMs, outcome.exit, stdout, stderr),
      );
    }
    if (outcome.kind === "not-ready") {
      throw new Error(formatNotReady(command, observationMs, outcome.detail, stdout, stderr));
    }

    return {
      observationMs,
      rendered: outcome.kind === "ready",
      stdout,
      stderr,
    };
  } finally {
    await stopProcessTree(child, exited, shutdownGraceMs);
  }
}

export async function createRepositoryFixture() {
  const root = await mkdtemp(join(tmpdir(), "asterlyn-native-smoke-"));
  try {
    await runCommand("git", ["init", "--quiet", "--initial-branch=main", root]);
    await runCommand("git", ["-C", root, "config", "user.name", "Asterlyn CI"]);
    await runCommand("git", [
      "-C",
      root,
      "config",
      "user.email",
      "ci@asterlyn.invalid",
    ]);
    const trackedPath = join(root, "tracked.txt");
    await writeFile(trackedPath, "baseline\n", "utf8");
    await runCommand("git", ["-C", root, "add", "tracked.txt"]);
    await runCommand("git", ["-C", root, "commit", "--quiet", "-m", "baseline"]);
    await appendFile(trackedPath, "working tree change\n", "utf8");
    await writeFile(join(root, "untracked.txt"), "untracked\n", "utf8");
    return root;
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    throw error;
  }
}

export function isolatedDesktopEnvironment(root, environment = process.env) {
  return {
    ...environment,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
  };
}

async function runNativeSmoke(executableArgument, { requireRendered = false } = {}) {
  const executable = resolve(executableArgument);
  const executableStat = await stat(executable).catch(() => null);
  if (!executableStat?.isFile()) {
    throw new Error(`Native executable was not found: ${executable}`);
  }
  if (requireRendered && process.platform !== "darwin") {
    throw new Error("Rendered native smoke currently requires macOS accessibility inspection.");
  }

  const profile = await mkdtemp(join(tmpdir(), "asterlyn-native-smoke-profile-"));
  let fixture = null;
  try {
    fixture = await createRepositoryFixture();
    const observationMs = readPositiveDuration(
      process.env.ASTERLYN_SMOKE_OBSERVATION_MS,
      DEFAULT_OBSERVATION_MS,
    );
    const readyVersion = requireRendered ? await readBrandVersion() : null;
    const result = await smokeProcess({
      command: executable,
      args: [fixture],
      observationMs,
      readinessProbe: readyVersion ? createMacOSReadinessProbe(readyVersion) : null,
      environment: {
        ...isolatedDesktopEnvironment(profile),
        RUST_BACKTRACE: "1",
      },
    });
    const evidence = result.rendered
      ? `rendered the application shell within ${result.observationMs} ms`
      : `remained alive for ${result.observationMs} ms`;
    console.log(`Native smoke passed: ${basename(executable)} ${evidence}.`);
  } finally {
    if (fixture) await rm(fixture, { force: true, recursive: true });
    await rm(profile, { force: true, recursive: true });
  }
}

export function accessibilitySnapshotIsReady(snapshot, expectedVersion) {
  return snapshot === "READY" || (
    snapshot.includes(expectedVersion) && !snapshot.includes("startup-failure-title")
  );
}

export function createMacOSReadinessProbe(expectedVersion) {
  if (!expectedVersion) throw new Error("A visible version marker is required.");
  return async (pid) => {
    const result = await runCommand("osascript", [
      "-e",
      MACOS_ACCESSIBILITY_SNAPSHOT,
      String(pid),
      expectedVersion,
    ]);
    const snapshot = result.stdout.trim();
    return {
      ready: accessibilitySnapshotIsReady(snapshot, expectedVersion),
      detail: snapshot === "" ? "empty accessibility snapshot" : snapshot.slice(0, 240),
    };
  };
}

async function readBrandVersion() {
  const source = await readFile(new URL("../src/brand.ts", import.meta.url), "utf8");
  const version = source.match(/version:\s*["']([^"']+)["']/u)?.[1];
  if (!version) throw new Error("Unable to read the native smoke version marker from src/brand.ts.");
  return version;
}

async function observeReadiness(pid, exited, probe, observationMs, probeIntervalMs) {
  if (pid === undefined) throw new Error("Native process did not expose a process identifier.");
  const deadline = Date.now() + observationMs;
  let detail = "the application shell was not exposed";
  while (Date.now() < deadline) {
    const probeOutcome = await Promise.race([
      exited.then((exit) => ({ kind: "exit", exit })),
      Promise.resolve(probe(pid)).then((result) => ({ kind: "probe", result })),
    ]);
    if (probeOutcome.kind === "exit") return probeOutcome;

    const result = typeof probeOutcome.result === "boolean"
      ? { ready: probeOutcome.result, detail: "" }
      : probeOutcome.result;
    if (result.ready) return { kind: "ready" };
    if (result.detail) detail = result.detail;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const pauseOutcome = await Promise.race([
      exited.then((exit) => ({ kind: "exit", exit })),
      delay(Math.min(probeIntervalMs, remaining)).then(() => ({ kind: "continue" })),
    ]);
    if (pauseOutcome.kind === "exit") return pauseOutcome;
  }
  return { kind: "not-ready", detail };
}

async function stopProcessTree(child, exited, shutdownGraceMs) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    await runCommand("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      acceptedExitCodes: new Set([0, 128]),
    });
  } else {
    signalProcessGroup(child.pid, "SIGTERM");
  }

  const stopped = await Promise.race([
    exited.then(() => true),
    delay(shutdownGraceMs).then(() => false),
  ]);
  if (!stopped && process.platform !== "win32") {
    signalProcessGroup(child.pid, "SIGKILL");
    await exited;
  }
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function runCommand(command, args, { acceptedExitCodes = new Set([0]) } = {}) {
  const child = spawn(command, args, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString());
  });

  const result = await new Promise((resolveResult, rejectResult) => {
    child.once("error", rejectResult);
    child.once("close", (code, signal) => resolveResult({ code, signal }));
  });
  if (!acceptedExitCodes.has(result.code)) {
    throw new Error(
      `${command} failed with code ${result.code ?? "none"} and signal ${result.signal ?? "none"}.\n${stderr || stdout}`,
    );
  }
  return { ...result, stdout, stderr };
}

function formatEarlyExit(command, observationMs, exit, stdout, stderr) {
  const details = [
    `${command} exited before the ${observationMs} ms observation window.`,
    `Exit code: ${exit.code ?? "none"}; signal: ${exit.signal ?? "none"}.`,
  ];
  if (stdout.trim()) details.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) details.push(`stderr:\n${stderr.trim()}`);
  return details.join("\n");
}

function formatNotReady(command, observationMs, detail, stdout, stderr) {
  const details = [
    `${command} stayed alive but did not render the application shell within ${observationMs} ms.`,
    `Last readiness observation: ${detail}.`,
  ];
  if (stdout.trim()) details.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) details.push(`stderr:\n${stderr.trim()}`);
  return details.join("\n");
}

function appendBounded(current, addition) {
  const combined = current + addition;
  return combined.length <= MAX_CAPTURED_CHARACTERS
    ? combined
    : combined.slice(-MAX_CAPTURED_CHARACTERS);
}

function readPositiveDuration(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("ASTERLYN_SMOKE_OBSERVATION_MS must be a positive number.");
  }
  return duration;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  const arguments_ = process.argv.slice(2);
  const requireRendered = arguments_.includes("--require-rendered");
  const positional = arguments_.filter((argument) => argument !== "--require-rendered");
  const executable = positional[0];
  if (!executable || positional.length > 1 || arguments_.some((argument) => argument.startsWith("--") && argument !== "--require-rendered")) {
    console.error("Usage: node scripts/smoke-native-app.mjs [--require-rendered] <native-executable>");
    process.exitCode = 2;
  } else {
    runNativeSmoke(executable, { requireRendered }).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
