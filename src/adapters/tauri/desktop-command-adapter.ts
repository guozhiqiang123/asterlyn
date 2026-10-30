import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  DesktopCommandMap,
  DesktopCommandName,
} from "../../protocol/generated-desktop-protocol";
import { validateDesktopResult } from "../../protocol/validate-desktop-result";
import { DESKTOP_DIAGNOSTIC_CONTEXT_COMMANDS } from "../../protocol/generated-desktop-protocol";
import { observeDesktopCommand } from "../../application/diagnostics.ts";

const contextCommands: ReadonlySet<string> = new Set(DESKTOP_DIAGNOSTIC_CONTEXT_COMMANDS);

export const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export { openDialog };

export async function invokeDesktopCommand<
  Result,
  Command extends DesktopCommandName = DesktopCommandName,
>(
  command: Command,
  args?: DesktopCommandMap[Command]["args"],
): Promise<Result> {
  return observeDesktopCommand(command, async (traceId) => {
    const value = await invokeTauri<unknown>(command, contextCommands.has(command) ? { ...args, diagnosticTraceId: traceId } : args);
    return validateDesktopResult(command, value) as Result;
  }, contextCommands.has(command));
}

/** Reserved for feature-scoped validators that are intentionally loaded with their feature chunk. */
export function invokeDesktopCommandUnvalidated<Command extends DesktopCommandName>(
  command: Command,
  args?: DesktopCommandMap[Command]["args"],
  expectedFailure?: (error:unknown)=>boolean,
): Promise<unknown> {
  return observeDesktopCommand(command, (traceId) => invokeTauri<unknown>(command,
    contextCommands.has(command) ? { ...args, diagnosticTraceId: traceId } : args), contextCommands.has(command),expectedFailure);
}
