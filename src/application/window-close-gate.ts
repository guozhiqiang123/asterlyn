export interface ProjectWindowCloseActions {
  readonly isLastProjectWindow: () => Promise<boolean>;
  readonly confirmLastProjectWindow: () => Promise<boolean>;
  readonly confirmUnsavedChanges: () => Promise<boolean>;
}

export function interceptNativeCloseRequest(
  event: { preventDefault(): void },
  requestClose: () => void,
): void {
  event.preventDefault();
  requestClose();
}

/** Keeps the final-window warning ahead of any save side effects. */
export async function approveProjectWindowClose(
  actions: ProjectWindowCloseActions,
): Promise<boolean> {
  if (
    (await actions.isLastProjectWindow()) &&
    !(await actions.confirmLastProjectWindow())
  ) return false;
  return actions.confirmUnsavedChanges();
}
