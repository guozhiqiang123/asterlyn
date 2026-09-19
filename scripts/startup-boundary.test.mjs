import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the native bridge is static while the deterministic browser demo is lazy", async () => {
  const bridge = await readFile(new URL("../src/bridge.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

  assert.match(bridge, /from ["']\.\/adapters\/tauri\/tauri-desktop-bridge\.ts["']/);
  assert.match(
    bridge,
    /import\(["']\.\/adapters\/demo\/demo-desktop-bridge\.ts["']\)/,
  );
  assert.doesNotMatch(bridge, /from ["']\.\/demo(?:\.ts)?["']/);
  assert.doesNotMatch(app, /from ["']\.\/demo(?:\.ts)?["']/);
  assert.match(config, /MAIN_CHUNK_MAX_BYTES\s*=\s*500_000/);
  assert.match(config, /production startup contains browser demo modules/);
});
