import {
  createCommandSurfaceState,
  type CommandSurfaceState,
} from "./workbench/navigation.ts";

export interface AppState {
  commandSurface: CommandSurfaceState;
  loading: boolean;
  error: string | null;
}

export function createAppState(): AppState {
  return {
    commandSurface: createCommandSurfaceState(),
    loading: false,
    error: null,
  };
}
