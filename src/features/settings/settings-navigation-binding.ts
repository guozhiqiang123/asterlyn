import type { SettingsSection } from "./settings-controller.ts";

export function bindSettingsNavigation(
  root: HTMLElement,
  select: (section: SettingsSection) => void,
): void {
  root.querySelectorAll<HTMLButtonElement>("[data-settings-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.dataset.settingsSection as SettingsSection;
      select(section);
      queueMicrotask(() => root
        .querySelector<HTMLButtonElement>(`[data-settings-section="${section}"]`)
        ?.focus());
    });
  });
}
