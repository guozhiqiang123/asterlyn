import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const MAIN_CHUNK_MAX_BYTES = 500_000;

const jetBrainsMonoLicense = readFileSync(
  new URL("./node_modules/@fontsource-variable/jetbrains-mono/LICENSE", import.meta.url),
  "utf8",
);
const codeMirrorMergeLicense = readFileSync(
  new URL("./third-party/licenses/codemirror-merge-6.12.2-MIT.txt", import.meta.url),
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
        this.emitFile({
          type: "asset",
          fileName: "licenses/codemirror-merge-6.12.2-MIT.txt",
          source: codeMirrorMergeLicense,
        });
      },
    },
    {
      name: "asterlyn-startup-boundary",
      generateBundle(_options, bundle) {
        const applicationChunks = Object.values(bundle).filter(
          (output): output is Extract<typeof output, { type: "chunk" }> =>
            output.type === "chunk" && Object.keys(output.modules).some((module) =>
              /[/\\]src[/\\]app\.ts$/.test(module)
            ),
        );
        if (applicationChunks.length !== 1) {
          this.error(`expected one application startup chunk, received ${applicationChunks.length}`);
        }
        const application = applicationChunks[0]!;
        const bytes = Buffer.byteLength(application.code);
        if (bytes > MAIN_CHUNK_MAX_BYTES) {
          this.error(
            `${application.fileName} is ${bytes} bytes; the production startup limit is ${MAIN_CHUNK_MAX_BYTES}`,
          );
        }
        const demoModules = Object.keys(application.modules).filter((module) =>
          /[/\\]src[/\\](?:demo\.ts|adapters[/\\]demo[/\\])/.test(module)
        );
        if (demoModules.length > 0) {
          this.error(`production startup contains browser demo modules: ${demoModules.join(", ")}`);
        }
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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "features",
              test: /[/\\]src[/\\]features[/\\]/,
              maxSize: 300_000,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
});
