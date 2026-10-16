import { invoke as invokeTauri } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  DesktopCommandMap,
  DesktopCommandName,
} from "../../protocol/generated-desktop-protocol";
import { validateDesktopResult } from "../../protocol/validate-desktop-result";

export const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export { openDialog };

export async function invokeDesktopCommand<
  Result,
  Command extends DesktopCommandName = DesktopCommandName,
>(
  command: Command,
  args?: DesktopCommandMap[Command]["args"],
): Promise<Result> {
  const value = await invokeTauri<unknown>(command, args);
  return validateDesktopResult(command, value) as Result;
}

/** Reserved for feature-scoped validators that are intentionally loaded with their feature chunk. */
export function invokeDesktopCommandUnvalidated<Command extends DesktopCommandName>(
  command: Command,
  args?: DesktopCommandMap[Command]["args"],
): Promise<unknown> {
  return invokeTauri<unknown>(command, args);
}
