import type { BundledPlugin } from "../application/plugins/index.ts";
import { ANDROID_GRADLE_PLUGIN } from "@asterlyn/plugin-android-gradle";
import { adaptSdkPluginModule } from "../application/plugins/plugin-sdk-adapter.ts";

/** Compile-time reviewed integrations shipped with Asterlyn. */
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = Object.freeze([
  adaptSdkPluginModule(ANDROID_GRADLE_PLUGIN),
]);
