export function hideWorkspaceToolWindows(root: HTMLElement): void {
  const workbench = root.querySelector<HTMLElement>("#workbench");
  workbench?.classList.remove("left-tool-open", "bottom-tool-open");
  for (const selector of ["#left-tool", "#left-splitter", "#bottom-tool", "#bottom-splitter"]) {
    root.querySelector<HTMLElement>(selector)?.setAttribute("hidden", "");
  }
}
