export {
  ANDROID_GRADLE_DETECTOR_LIMITS,
  detectAndroidGradleEvidence,
  type AndroidGradleDetectionInput,
  type AndroidGradleDetectorPlatform,
  type AndroidGradleEvidenceSnapshot,
} from "./detector.ts";
export {
  ANDROID_GRADLE_PLUGIN,
  ANDROID_GRADLE_PLUGIN_ID,
  detectAndroidGradlePluginEvidence,
} from "./plugin.ts";
export {
  ANDROID_GRADLE_DISCOVERY_LIMITS,
  ANDROID_GRADLE_TASK_ARGS,
  buildGradleWrapperRequest,
  parseGradleTasksOutput,
  type GradleTaskDescriptor,
  type GradleTaskDiscoveryResult,
  type GradleWrapperRequestResult,
} from "./discovery.ts";
