/** Diagnostic categories remain in native logs; task surfaces show the actionable message. */
export function taskFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^gradle\.(?:runtime|failure)\.[A-Za-z]+:\s*/u, "");
}
