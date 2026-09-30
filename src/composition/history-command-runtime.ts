import type { CommandRegistry } from "../application/commands/command-service.ts";
import { HISTORY_DOM_COMMANDS } from "../presentation/history-command-targets.ts";
import { registerDomCommands, type DomCommandRuntimeOptions } from "./dom-command-runtime.ts";

export type HistoryCommandRuntimeOptions = DomCommandRuntimeOptions;

export function registerHistoryCommands(
  registry: CommandRegistry,
  options: HistoryCommandRuntimeOptions,
): () => void {
  return registerDomCommands(registry, HISTORY_DOM_COMMANDS, options);
}
