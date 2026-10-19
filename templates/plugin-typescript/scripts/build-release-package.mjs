import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { c as createTar } from "tar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
if (manifest.schemaVersion !== 2 || manifest.version !== packageJson.version) {
  throw new Error("package.json and schema-2 manifest versions must match");
}
if (Object.keys(manifest.distribution?.integrity ?? {}).length !== 0) {
  throw new Error("source manifest integrity must remain empty; packaging owns generated hashes");
}

const releaseRoot = path.join(root, "release");
const staging = path.join(releaseRoot, ".staging");
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(path.join(staging, "runtime"), { recursive: true });
await build({
  entryPoints: [path.join(root, "src/plugin.ts")],
  outfile: path.join(staging, "runtime/plugin.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  legalComments: "none",
  sourcemap: false,
});
await writeFile(path.join(staging, "LICENSE"), await readFile(path.join(root, "LICENSE")));

const integrity = {};
for (const relative of ["LICENSE", "runtime/plugin.js"]) {
  const bytes = await readFile(path.join(staging, relative));
  integrity[relative] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
const admittedManifest = structuredClone(manifest);
admittedManifest.distribution.integrity = integrity;
await writeFile(
  path.join(staging, "manifest.json"),
  `${JSON.stringify(admittedManifest, null, 2)}\n`,
);

const assetName = `${manifest.id}-${manifest.version}.asterlyn-plugin.tgz`;
const assetPath = path.join(releaseRoot, assetName);
await createTar(
  { cwd: staging, file: assetPath, gzip: true, portable: true, noMtime: true },
  ["manifest.json", "LICENSE", "runtime/plugin.js"],
);
const asset = await readFile(assetPath);
const summary = {
  asset: assetName,
  version: manifest.version,
  bytes: asset.byteLength,
  sha256: createHash("sha256").update(asset).digest("hex"),
  files: integrity,
};
await writeFile(
  path.join(releaseRoot, "release-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
await rm(staging, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(summary)}\n`);
