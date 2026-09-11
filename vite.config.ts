import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const jetBrainsMonoLicense = readFileSync(
  new URL("./node_modules/@fontsource-variable/jetbrains-mono/LICENSE", import.meta.url),
  "utf8",
);

export default defineConfig({
  plugins: [
    {
      name: "asterlyn-font-license",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "licenses/jetbrains-mono-OFL.txt",
          source: jetBrainsMonoLicense,
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
