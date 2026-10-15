export type TaskTerminalSessionStatus =
  | "starting"
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "crashed";

export interface TaskTerminalSessionDescriptor {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly taskKey: string;
  readonly label: string;
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly cancel: () => void | Promise<void>;
}

export interface TaskTerminalOutputFrame {
  readonly stream: "stdout" | "stderr";
  readonly dataBase64: string;
}

/** Host-private projection of one reviewed task into the integrated Terminal surface. */
export interface TaskTerminalSessionPort {
  begin(session: TaskTerminalSessionDescriptor): void;
  append(sessionId: string, frame: TaskTerminalOutputFrame): void;
  update(
    sessionId: string,
    status: TaskTerminalSessionStatus,
    error: string | null,
    outputTruncated: boolean,
  ): void;
  reveal(sessionId: string): boolean;
}

export function isActiveTaskTerminalStatus(status: TaskTerminalSessionStatus): boolean {
  return status === "starting" || status === "queued" || status === "running" || status === "cancelling";
}

export function isTerminalTaskTerminalStatus(status: TaskTerminalSessionStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "crashed";
}
