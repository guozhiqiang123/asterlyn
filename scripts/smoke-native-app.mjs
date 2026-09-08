import { spawn } from "node:child_process";
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_OBSERVATION_MS = 6_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 2_000;
const MAX_CAPTURED_CHARACTERS = 32_768;

export async function smokeProcess({
  command,
  args = [],
  observationMs = DEFAULT_OBSERVATION_MS,
  shutdownGraceMs = DEFAULT_SHUTDOWN_GRACE_MS,
  environment = process.env,
}) {
  if (!Number.isFinite(observationMs) || observationMs <= 0) {
    throw new Error("observationMs must be a positive number.");
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
  const outcome = await Promise.race([
    exited.then((exit) => ({ kind: "exit", exit })),
    delay(observationMs).then(() => ({ kind: "observed" })),
  ]);

  if (outcome.kind === "exit") {
    throw new Error(
      formatEarlyExit(command, observationMs, outcome.exit, stdout, stderr),
    );
  }

  await stopProcessTree(child, exited, shutdownGraceMs);
  return { observationMs, stdout, stderr };
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

async function runNativeSmoke(executableArgument) {
  const executable = resolve(executableArgument);
  const executableStat = await stat(executable).catch(() => null);
  if (!executableStat?.isFile()) {
    throw new Error(`Native executable was not found: ${executable}`);
  }

  const fixture = await createRepositoryFixture();
  try {
    const observationMs = readPositiveDuration(
      process.env.ASTERLYN_SMOKE_OBSERVATION_MS,
      DEFAULT_OBSERVATION_MS,
    );
    const result = await smokeProcess({
      command: executable,
      args: [fixture],
      observationMs,
      environment: {
        ...process.env,
        RUST_BACKTRACE: "1",
      },
    });
    console.log(
      `Native smoke passed: ${basename(executable)} remained alive for ${result.observationMs} ms.`,
    );
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
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
  const executable = process.argv[2];
  if (!executable || process.argv.length > 3) {
    console.error("Usage: node scripts/smoke-native-app.mjs <native-executable>");
    process.exitCode = 2;
  } else {
    runNativeSmoke(executable).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
