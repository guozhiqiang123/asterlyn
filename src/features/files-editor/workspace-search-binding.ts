import type { WorkspaceSearchControls } from "./workspace-search";

type ControlReader = () => WorkspaceSearchControls;
type ControlUpdater = (controls: WorkspaceSearchControls, focusTargetId: string) => void;

export function bindWorkspaceSearchOptionControls(
  root: HTMLElement,
  read: ControlReader,
  update: ControlUpdater,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-workspace-search-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const controls = read();
      const option = button.dataset.workspaceSearchOption;
      const next = option === "new-line"
        ? { ...controls, newLine: !controls.newLine }
        : option === "case"
          ? { ...controls, caseSensitive: !controls.caseSensitive }
          : option === "word"
            ? { ...controls, wholeWord: !controls.wholeWord }
            : { ...controls, mode: controls.mode === "literal" ? "regex" as const : "literal" as const };
      update(next, button.id);
    });
  });
  root.querySelector<HTMLInputElement>("#command-surface-exclude-ignored")
    ?.addEventListener("change", (event) => {
      const target = event.currentTarget as HTMLInputElement;
      update({ ...read(), excludeIgnored: target.checked }, target.id);
    });
}
