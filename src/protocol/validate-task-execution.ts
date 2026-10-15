import type { DesktopCommandName } from "./generated-desktop-protocol.ts";
import { parseTaskArtifactDiscovery } from "./task-artifacts.ts";
import {
  assert,
  numbers,
  record,
  strings,
} from "./desktop-result-validation-primitives.ts";

/** Owns result validation for the task-execution and authorization protocol family. */
export function validateTaskExecutionDesktopResult(
  validator: string,
  value: unknown,
  command: DesktopCommandName,
): boolean {
  switch (validator) {
    case "workspaceTrustResult": {
      const result = record(value, command);
      numbers(result, command, "protocolVersion");
      strings(result, command, "workspaceRoot", "pluginId");
      assert(result.protocolVersion === 1, command, "expected workspace trust protocol version 1");
      assert(result.state === "unknown" || result.state === "trusted" || result.state === "denied", command, "invalid workspace trust state");
      return true;
    }
    case "taskConfirmationResult": {
      const result = record(value, command);
      numbers(result, command, "protocolVersion");
      strings(result, command, "reviewId");
      assert(result.protocolVersion === 1, command, "expected task confirmation protocol version 1");
      assert(typeof result.remembered === "boolean", command, "invalid remembered task confirmation");
      return true;
    }
    case "taskExecutionReview": {
      const result = record(value, command);
      numbers(result, command, "protocolVersion");
      strings(result, command, "reviewId", "workspaceRoot", "pluginId", "providerId", "taskId", "label", "executablePath", "canonicalExecutablePath", "cwd");
      assert(result.protocolVersion === 1, command, "expected task review protocol version 1");
      assert(
        Array.isArray(result.args) && result.args.every((argument) => typeof argument === "string"),
        command,
        "args must contain only strings",
      );
      assert(result.trust === "unknown" || result.trust === "trusted" || result.trust === "denied", command, "invalid task review trust state");
      return true;
    }
    case "taskExecutionStarted": {
      const result = record(value, command);
      numbers(result, command, "protocolVersion");
      strings(result, command, "runId", "reviewId", "workspaceRoot");
      assert(result.protocolVersion === 1, command, "expected task execution protocol version 1");
      return true;
    }
    case "taskArtifactDiscovery":
      parseTaskArtifactDiscovery(value);
      return true;
    default:
      return false;
  }
}
