import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { typeFor } from "./generate-native-language-contract.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const header = "// Generated from native catalog models. Run npm run protocol:catalog. Do not edit.\n";

export function generateLanguageCatalogContract() {
  const result = spawnSync("cargo", ["run", "--quiet", "--locked", "-p", "asterlyn-plugin-package", "--features", "bindings", "--bin", "export-language-catalog"], {
    cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Catalog contract export failed: ${result.stderr.slice(-4000)}`);
  const { schema, patterns } = JSON.parse(result.stdout);
  const { definitions, $schema, title, ...catalog } = schema;
  const models = { ...definitions, LanguageServerCatalog: catalog };
  return {
    types: header + Object.entries(models).sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([name, model]) => `export type ${name} = ${typeFor(model)};`).join("\n\n") + "\n",
    schema: header + `export const LANGUAGE_CATALOG_SCHEMA = ${JSON.stringify(schema, null, 2)} as const;\n`
      + `export const LANGUAGE_CATALOG_PATTERNS = ${JSON.stringify(patterns, null, 2)} as const;\n`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const generated = generateLanguageCatalogContract();
  for (const [key, file] of [
    ["types", "packages/plugin-sdk/generated-language-catalog.ts"],
    ["schema", "src/protocol/generated-language-catalog-schema.ts"],
  ]) {
    const path = new URL(`../${file}`, import.meta.url);
    if (process.argv.includes("--check")) {
      if (await readFile(path, "utf8").catch(() => null) !== generated[key]) throw new Error(`Catalog protocol drift: ${file}`);
    } else await writeFile(path, generated[key]);
  }
  console.log(process.argv.includes("--check") ? "Catalog protocol drift check passed." : "Catalog protocol generated.");
}
