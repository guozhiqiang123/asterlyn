import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const sourceCodeProLicense = readFileSync(
  new URL("./node_modules/@fontsource-variable/source-code-pro/LICENSE", import.meta.url),
  "utf8",
);

export default defineConfig({
  plugins: [
    {
      name: "asterlyn-font-license",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "licenses/source-code-pro-OFL.txt",
          source: sourceCodeProLicense,
        });
      },
    },
  ],
  clearScreen: false,
  server: {
    strictPort: true,
    port: 1420,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
