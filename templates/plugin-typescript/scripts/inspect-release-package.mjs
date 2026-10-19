import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const asset = path.join(
  root,
  "release",
  `${manifest.id}-${manifest.version}.asterlyn-plugin.tgz`,
);
if (!existsSync(asset)) throw new Error(`Release package not found: ${asset}`);

const arguments_ = [
  asset,
  manifest.distribution.repository,
  manifest.version,
  process.env.ASTERLYN_HOST_VERSION ?? manifest.distribution.hostCompatibility.minimum,
];
const inspector = process.env.ASTERLYN_PLUGIN_INSPECTOR;
const host = process.env.ASTERLYN_HOST_CHECKOUT;
let result;
if (inspector) {
  result = spawnSync(inspector, arguments_, { cwd: root, stdio: "inherit" });
} else if (host) {
  result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      path.join(host, "Cargo.toml"),
      "-p",
      "asterlyn-plugin-package",
      "--bin",
      "asterlyn-plugin-inspect",
      "--",
      ...arguments_,
    ],
    { cwd: root, stdio: "inherit" },
  );
} else {
  throw new Error("Set ASTERLYN_PLUGIN_INSPECTOR or ASTERLYN_HOST_CHECKOUT");
}
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
