import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repositoryRoot, "packages/plugin-sdk");
const outputRoot = path.resolve(repositoryRoot, process.argv[2] ?? "release-sdk");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const expectedName = `asterlyn-plugin-sdk-${packageJson.version}.tgz`;
const canonicalArtifact = path.join(
  repositoryRoot,
  "templates/plugin-typescript/vendor",
  expectedName,
);
const canonicalChecksum = path.join(
  repositoryRoot,
  "templates/plugin-typescript/vendor/plugin-sdk.sha256",
);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await verifyCanonicalArtifact();
const artifact = path.join(outputRoot, expectedName);
await copyFile(canonicalArtifact, artifact);
const digest = createHash("sha256").update(await readFile(artifact)).digest("hex");
await writeFile(path.join(outputRoot, "plugin-sdk.sha256"), `${digest}  ${expectedName}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ artifact: expectedName, version: packageJson.version, sha256: digest })}\n`);

async function verifyCanonicalArtifact() {
  const bytes = await readFile(canonicalArtifact);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const checksum = (await readFile(canonicalChecksum, "utf8")).trim();
  if (checksum !== `${digest}  ${expectedName}`) {
    throw new Error(`Canonical Plugin SDK checksum does not match ${expectedName}`);
  }

  const staging = await mkdtemp(path.join(tmpdir(), "asterlyn-plugin-sdk-verify-"));
  try {
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    const installed = spawnSync(
      executable,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--prefix",
        staging,
        canonicalArtifact,
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    if (installed.status !== 0) {
      throw new Error(
        `Canonical Plugin SDK extraction failed: ${(installed.stderr || installed.stdout).trim()}`,
      );
    }
    const extracted = path.join(staging, "node_modules/@asterlyn/plugin-sdk");
    const expectedFiles = ["package.json", ...packageJson.files].sort();
    const actualFiles = (await readdir(extracted, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
      throw new Error(
        `Canonical Plugin SDK files differ from the reviewed package: ${actualFiles.join(", ")}`,
      );
    }
    for (const file of expectedFiles) {
      const source = await readFile(path.join(packageRoot, file));
      const packaged = await readFile(path.join(extracted, file));
      if (!source.equals(packaged)) {
        throw new Error(`Canonical Plugin SDK file is stale: ${file}`);
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
