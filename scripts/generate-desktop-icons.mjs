import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const source = join(repositoryRoot, "assets", "asterlyn-mark.svg");
const destination = join(repositoryRoot, "src-tauri", "icons");
const temporary = mkdtempSync(join(tmpdir(), "asterlyn-icons-"));
const generated = join(temporary, "generated");
const generated48 = join(temporary, "generated-48");
const destinationParent = dirname(destination);
mkdirSync(destinationParent, { recursive: true });
const staged = mkdtempSync(join(destinationParent, ".icons-next-"));
const backup = join(destinationParent, `.icons-backup-${process.pid}`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const maintained = [
  "32x32.png",
  "48x48.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
];

try {
  execFileSync(npm, ["run", "tauri", "--", "icon", source, "-o", generated], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  execFileSync(
    npm,
    ["run", "tauri", "--", "icon", source, "-o", generated48, "--png", "48"],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  for (const name of maintained) {
    const sourceDirectory = name === "48x48.png" ? generated48 : generated;
    const from = join(sourceDirectory, name);
    const to = join(staged, name);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }

  const hadDestination = existsSync(destination);
  rmSync(backup, { recursive: true, force: true });
  if (hadDestination) renameSync(destination, backup);
  try {
    renameSync(staged, destination);
  } catch (error) {
    if (hadDestination && !existsSync(destination)) renameSync(backup, destination);
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
  console.log(`Generated ${maintained.length} maintained desktop icon assets.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
  rmSync(staged, { recursive: true, force: true });
  if (existsSync(backup)) {
    if (!existsSync(destination)) renameSync(backup, destination);
    else rmSync(backup, { recursive: true, force: true });
  }
}
