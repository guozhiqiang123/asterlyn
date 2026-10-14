import type { BundledPlugin } from "../application/plugins/index.ts";
import { ANDROID_GRADLE_PLUGIN } from "./android-gradle/index.ts";

/** Compile-time reviewed integrations shipped with Asterlyn. */
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = Object.freeze([
  ANDROID_GRADLE_PLUGIN,
]);
