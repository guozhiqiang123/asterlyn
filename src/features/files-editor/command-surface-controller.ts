import {
  clampCommandSurfaceSelection,
  closeCommandSurface,
  createCommandSurfaceState,
  moveCommandSurfaceSelection,
  openCommandSurface,
  updateCommandSurfaceQuery,
  type CommandSurfaceState,
  type NavigationMode,
} from "../../workbench/navigation.ts";

export class CommandSurfaceController {
  private value: CommandSurfaceState = createCommandSurfaceState();

  get state(): Readonly<CommandSurfaceState> {
    return this.value;
  }

  open(mode: NavigationMode, query = ""): void {
    this.value = openCommandSurface(this.value, mode, query);
  }

  close(): void {
    this.value = closeCommandSurface(this.value);
  }

  updateQuery(query: string): void {
    this.value = updateCommandSurfaceQuery(this.value, query);
  }

  moveSelection(delta: number, resultCount: number): void {
    this.value = moveCommandSurfaceSelection(this.value, delta, resultCount);
  }

  clampSelection(resultCount: number): void {
    this.value = clampCommandSurfaceSelection(this.value, resultCount);
  }

  select(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || this.value.selectedIndex === index) return false;
    this.value = { ...this.value, selectedIndex: index };
    return true;
  }
}
