import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [rootArgument, outputArgument] = process.argv.slice(2);
if (!rootArgument || !outputArgument) {
  throw new Error(
    "usage: node scripts/hash-release-artifacts.mjs <bundle-root> <output-file>",
  );
}

const bundleRoot = path.resolve(rootArgument);
const outputFile = path.resolve(outputArgument);
const files = (await walk(bundleRoot)).filter((file) => {
  const depth = path.relative(bundleRoot, file).split(path.sep).length;
  return depth <= 2 && isReleaseArtifact(file);
});
if (files.length === 0) {
  throw new Error(`no release artifacts found under ${bundleRoot}`);
}

const lines = [];
for (const file of files) {
  const digest = await sha256(file);
  const relative = path.relative(bundleRoot, file).split(path.sep).join("/");
  lines.push(`${digest}  ${relative}`);
}

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${files.length} SHA-256 entries to ${outputFile}`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return walk(entryPath);
        return entry.isFile() ? [entryPath] : [];
      }),
  );
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

function isReleaseArtifact(file) {
  const distributableSuffixes = [
    ".AppImage",
    ".deb",
    ".dmg",
    ".exe",
    ".msi",
    ".rpm",
    ".sig",
    ".tar.gz",
    ".zip",
  ];
  return distributableSuffixes.some((suffix) => file.endsWith(suffix));
}
