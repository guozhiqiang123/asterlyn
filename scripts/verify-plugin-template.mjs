import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const source = path.join(repositoryRoot, "templates/plugin-typescript");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "asterlyn-plugin-template-"));
const checkout = path.join(temporaryRoot, "plugin");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  await cp(source, checkout, { recursive: true });
  run(npm, ["ci", "--ignore-scripts"], checkout);
  run(npm, ["audit", "--audit-level=high"], checkout);
  run(npm, ["run", "verify"], checkout, {
    ASTERLYN_HOST_CHECKOUT: repositoryRoot,
    ASTERLYN_HOST_VERSION: "0.1.11",
  });

  const manifest = JSON.parse(await readFile(path.join(checkout, "manifest.json"), "utf8"));
  const packagePath = path.join(
    checkout,
    "release",
    `${manifest.id}-${manifest.version}.asterlyn-plugin.tgz`,
  );
  const first = await digest(packagePath);
  run(npm, ["run", "package:release"], checkout);
  const second = await digest(packagePath);
  if (first !== second) {
    throw new Error(`Template release package is not deterministic: ${first} != ${second}`);
  }

  process.stdout.write(`Verified isolated plugin template (${second})\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, arguments_, cwd, extraEnvironment = {}) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const evidence = [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-16_000);
    throw new Error(`${command} ${arguments_.join(" ")} failed (${result.status})\n${evidence}`);
  }
}

async function digest(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
