import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseTag = process.argv[2] ?? "";

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const versions = new Map([
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ["package-lock.json root package", packageLock.packages?.[""]?.version],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
]);

for (const manifest of [
  "src-tauri/Cargo.toml",
  "crates/asterlyn-desktop/Cargo.toml",
  "crates/asterlyn-git/Cargo.toml",
  "crates/asterlyn-terminal/Cargo.toml",
  "crates/asterlyn-workspace/Cargo.toml",
]) {
  versions.set(manifest, cargoPackageVersion(manifest));
}

const expectedVersion = packageJson.version;
if (!isReleaseVersion(expectedVersion)) {
  throw new Error(`package.json contains an invalid release version: ${expectedVersion}`);
}

const mismatches = [...versions].filter(([, version]) => version !== expectedVersion);
if (mismatches.length > 0) {
  const details = mismatches.map(([source, version]) => `${source}=${version ?? "missing"}`).join(", ");
  throw new Error(`release versions must all equal ${expectedVersion}: ${details}`);
}

if (releaseTag && releaseTag !== `v${expectedVersion}`) {
  throw new Error(`release tag ${releaseTag} does not match v${expectedVersion}`);
}

console.log(`Release version ${expectedVersion}${releaseTag ? ` matches ${releaseTag}` : " is internally consistent"}.`);

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function cargoPackageVersion(relativePath) {
  const source = readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  const marker = "[package]";
  const start = source.indexOf(marker);
  if (start < 0) return undefined;
  const remainder = source.slice(start + marker.length);
  const nextSection = remainder.search(/^\[/m);
  const packageSection = nextSection < 0 ? remainder : remainder.slice(0, nextSection);
  return packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
}

function isReleaseVersion(version) {
  return typeof version === "string"
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}
