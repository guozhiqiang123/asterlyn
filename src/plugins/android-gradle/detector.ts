/** The detector is deliberately bounded: it is fed a catalog, never a filesystem. */
export const ANDROID_GRADLE_DETECTOR_LIMITS = Object.freeze({
  maxPaths: 4096,
  maxPathLength: 4096,
});

export type AndroidGradleDetectorPlatform = "posix" | "windows";

export interface AndroidGradleDetectionInput {
  readonly workspaceRoot: string;
  readonly generation: number;
  /** Workspace-relative path records from the host-owned catalog. */
  readonly files: readonly { readonly workspacePath: string }[];
  readonly platform?: AndroidGradleDetectorPlatform;
}

export interface AndroidGradleEvidenceSnapshot {
  readonly kind: "android-gradle-evidence";
  readonly workspaceRoot: string;
  readonly generation: number;
  readonly platform: AndroidGradleDetectorPlatform;
  readonly bounded: boolean;
  readonly gradle: boolean;
  readonly android: boolean;
  readonly wrapper: "gradlew" | "gradlew.bat" | null;
  readonly evidence: readonly string[];
}

const SETTINGS = new Set(["settings.gradle", "settings.gradle.kts"]);
const BUILDS = new Set(["build.gradle", "build.gradle.kts"]);
const WRAPPERS = new Set(["gradlew", "gradlew.bat"]);

/**
 * Detects only bounded, path-level Android/Gradle evidence.
 *
 * Invalid paths are ignored (rather than repaired): absolute paths, traversal, NULs,
 * empty segments, and overlong paths cannot contribute evidence. An over-limit catalog
 * is explicitly unbounded and never claims detection.
 */
export function detectAndroidGradleEvidence(
  input: AndroidGradleDetectionInput,
): AndroidGradleEvidenceSnapshot {
  const platform = input.platform ?? "posix";
  // Check the caller-provided catalog size before any mapping or normalization work.
  if (input.files.length > ANDROID_GRADLE_DETECTOR_LIMITS.maxPaths) {
    return emptySnapshot(input.workspaceRoot, input.generation, platform, false);
  }
  const paths = input.files
    .map((file) => normalizeWorkspacePath(file.workspacePath, platform))
    .filter((path): path is string => path !== null);
  const unique = [...new Set(paths)].sort(comparePaths);
  const rootNames = new Set(unique.filter((path) => !path.includes("/")));
  const wrapper = rootNames.has("gradlew")
    ? "gradlew"
    : rootNames.has("gradlew.bat") ? "gradlew.bat" : null;
  const rootSettings = [...rootNames].some((name) => SETTINGS.has(name));
  const rootBuild = [...rootNames].some((name) => BUILDS.has(name));
  const wrapperProperties = unique.includes("gradle/wrapper/gradle-wrapper.properties");
  const gradle = rootSettings || rootBuild || wrapper !== null || wrapperProperties;
  const androidManifest = unique.some((path) => isAndroidManifest(path, platform));
  const android = gradle && androidManifest;
  return Object.freeze({
    kind: "android-gradle-evidence",
    workspaceRoot: input.workspaceRoot,
    generation: input.generation,
    platform,
    bounded: true,
    gradle,
    android,
    wrapper,
    evidence: Object.freeze(unique.filter((path) => isEvidencePath(path, platform))),
  });
}

function emptySnapshot(
  workspaceRoot: string,
  generation: number,
  platform: AndroidGradleDetectorPlatform,
  bounded: boolean,
): AndroidGradleEvidenceSnapshot {
  return Object.freeze({
    kind: "android-gradle-evidence",
    workspaceRoot,
    generation,
    platform,
    bounded,
    gradle: false,
    android: false,
    wrapper: null,
    evidence: Object.freeze([]),
  });
}

function normalizeWorkspacePath(
  value: string,
  platform: AndroidGradleDetectorPlatform,
): string | null {
  if (typeof value !== "string" || value.length === 0 ||
    value.length > ANDROID_GRADLE_DETECTOR_LIMITS.maxPathLength || value.includes("\0")) return null;
  const slash = platform === "windows" ? value.replaceAll("\\", "/") : value;
  // Drive prefixes, UNC paths, and leading slashes are never workspace-relative.
  if (slash.startsWith("/") || /^[A-Za-z]:\//.test(slash) || slash.startsWith("//")) return null;
  const segments = slash.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return null;
  const normalized = segments.join("/");
  return platform === "windows" ? normalized.toLowerCase() : normalized;
}

function isAndroidManifest(path: string, platform: AndroidGradleDetectorPlatform): boolean {
  const segments = path.split("/");
  const manifest = platform === "windows" ? segments.at(-1)?.toLowerCase() : segments.at(-1);
  return segments.length >= 3 && segments.at(-3) === "src" && segments.at(-2) === "main" &&
    manifest === (platform === "windows" ? "androidmanifest.xml" : "AndroidManifest.xml");
}

function isEvidencePath(path: string, platform: AndroidGradleDetectorPlatform): boolean {
  return !path.includes("/") && (SETTINGS.has(path) || BUILDS.has(path) || WRAPPERS.has(path)) ||
    path === "gradle/wrapper/gradle-wrapper.properties" || isAndroidManifest(path, platform);
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
