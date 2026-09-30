import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [command, ...arguments_] = process.argv.slice(2);

if (command === "stage") {
  await stage(...arguments_);
} else if (command === "verify") {
  await verify(...arguments_);
} else {
  throw new Error(
    "usage: node scripts/release-artifacts.mjs stage <bundle-root> <output-dir> <target> <platform>\n"
      + "   or: node scripts/release-artifacts.mjs verify <asset-dir> <target>...",
  );
}

async function stage(bundleRootArgument, outputDirectoryArgument, target, platform) {
  if (!bundleRootArgument || !outputDirectoryArgument || !target || !platform) {
    throw new Error("stage requires bundle-root, output-dir, target, and platform");
  }
  const bundleRoot = path.resolve(bundleRootArgument);
  const outputDirectory = path.resolve(outputDirectoryArgument);
  const candidates = (await walk(bundleRoot)).filter((file) => isPlatformArtifact(file, platform));
  validatePlatformSet(candidates, platform);
  await mkdir(outputDirectory, { recursive: true });

  const basenames = new Set();
  const manifestLines = [];
  for (const source of candidates.sort()) {
    const basename = path.basename(source);
    if (basenames.has(basename)) throw new Error(`duplicate release artifact name: ${basename}`);
    basenames.add(basename);
    const destination = path.join(outputDirectory, basename);
    await copyFile(source, destination);
    manifestLines.push(`${await sha256(destination)}  ${basename}`);
  }

  const manifest = path.join(outputDirectory, `${target}.sha256`);
  await writeFile(manifest, `${manifestLines.join("\n")}\n`, "utf8");
  console.log(`Staged ${candidates.length} ${platform} artifact(s) for ${target}.`);
}

async function verify(assetDirectoryArgument, ...targets) {
  if (!assetDirectoryArgument || targets.length === 0) {
    throw new Error("verify requires an asset directory and at least one target");
  }
  const assetDirectory = path.resolve(assetDirectoryArgument);
  const allEntries = await readdir(assetDirectory, { withFileTypes: true });
  const files = allEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const expectedManifests = new Set(targets.map((target) => `${target}.sha256`));
  const actualManifests = files.filter((file) => file.endsWith(".sha256"));
  if (actualManifests.length !== expectedManifests.size
    || actualManifests.some((file) => !expectedManifests.has(file))) {
    throw new Error(`checksum manifest set is incomplete: ${actualManifests.sort().join(", ")}`);
  }

  const covered = new Set();
  for (const manifestName of [...expectedManifests].sort()) {
    const manifest = await readFile(path.join(assetDirectory, manifestName), "utf8");
    const lines = manifest.trim().split("\n").filter(Boolean);
    if (lines.length === 0) throw new Error(`${manifestName} is empty`);
    for (const line of lines) {
      const match = line.match(/^([0-9a-f]{64})  ([^/\\]+)$/);
      if (!match) throw new Error(`invalid checksum line in ${manifestName}: ${line}`);
      const [, expectedDigest, basename] = match;
      if (covered.has(basename)) throw new Error(`artifact is covered more than once: ${basename}`);
      if (!files.includes(basename)) throw new Error(`manifest references missing artifact: ${basename}`);
      const actualDigest = await sha256(path.join(assetDirectory, basename));
      if (actualDigest !== expectedDigest) throw new Error(`checksum mismatch for ${basename}`);
      covered.add(basename);
    }
  }

  const distributableFiles = files.filter(isDistributable);
  const uncovered = distributableFiles.filter((file) => !covered.has(file));
  if (uncovered.length > 0 || covered.size !== distributableFiles.length) {
    throw new Error(`release artifact coverage is incomplete: ${uncovered.sort().join(", ")}`);
  }

  const combinedFiles = files
    .filter((file) => isDistributable(file) || file.endsWith(".cdx.json"))
    .sort();
  const combinedLines = [];
  for (const basename of combinedFiles) {
    combinedLines.push(`${await sha256(path.join(assetDirectory, basename))}  ${basename}`);
  }
  await writeFile(path.join(assetDirectory, "SHA256SUMS"), `${combinedLines.join("\n")}\n`, "utf8");
  console.log(`Verified ${covered.size} release artifact(s) and ${combinedFiles.length} published file(s).`);
}

function isPlatformArtifact(file, platform) {
  if (platform === "linux") return [".AppImage", ".deb", ".rpm"].some((suffix) => file.endsWith(suffix));
  if (platform === "windows") return file.endsWith("-setup.exe");
  if (platform === "macos") return file.endsWith(".dmg");
  throw new Error(`unsupported release platform: ${platform}`);
}

function validatePlatformSet(files, platform) {
  const suffixes = platform === "linux"
    ? [".AppImage", ".deb", ".rpm"]
    : platform === "windows"
      ? ["-setup.exe"]
      : platform === "macos"
        ? [".dmg"]
        : [];
  for (const suffix of suffixes) {
    const count = files.filter((file) => file.endsWith(suffix)).length;
    if (count !== 1) throw new Error(`expected exactly one ${platform} ${suffix} artifact; found ${count}`);
  }
  if (files.length !== suffixes.length) {
    throw new Error(`unexpected ${platform} release artifact count: ${files.length}`);
  }
}

function isDistributable(file) {
  return [".AppImage", ".deb", ".dmg", ".exe", ".msi", ".rpm"].some((suffix) => file.endsWith(suffix));
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(entryPath);
    return entry.isFile() ? [entryPath] : [];
  }));
  return nested.flat();
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
