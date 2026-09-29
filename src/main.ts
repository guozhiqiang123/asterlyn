import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./styles.css";
import "./shared/layout.css";
import "./shared/controls.css";
import "./shared/select-control.css";
import "./shared/presentation.css";
import "./shared/content.css";
import "./shared/overlays.css";
import "./shared/context-menu/context-menu.css";
import "./shell/shell.css";
import "./features/settings/settings.css";
import "./features/changes-commit/changes-commit.css";
import "./features/files-editor/project-files.css";
import "./features/files-editor/files-editor.css";
import "./features/files-editor/editable-diff.css";
import "./features/files-editor/workspace-search.css";
import "./features/git-history/git-history.css";
import "./features/git-history/history.css";
import "./features/git-history/branches.css";
import "./features/git-history/branch-mutation.css";
import "./features/git-history/git-reset.css";
import "./features/git-history/commit-file-restore.css";
import "./features/git-history/details.css";
import "./features/git-stash/stash.css";
import "./features/git-operations/git-operation-controls.css";
import "./features/git-operations/conflict-editor.css";
import "./features/remote-push/remote-push.css";
import "./features/remote-push/push-dialog-layout.css";
import "./features/remote-push/remote-authentication.css";
import "./features/remote-push/remote-management.css";
import "./shared/responsive.css";
import { AsterlynApp } from "./app";
import { BRAND } from "./brand";
import type { LocaleCatalog } from "./localization/catalog.ts";
import { ThemedSelectHost } from "./shared/themed-select-host.ts";

interface ApplicationRuntime { dispose(): void; }
let activeRuntime: ApplicationRuntime | null = null;

export function startApplication(catalog: LocaleCatalog): ApplicationRuntime {
  activeRuntime?.dispose();
  document.title = BRAND.name;
  document
    .querySelector<HTMLMetaElement>('meta[name="description"]')
    ?.setAttribute("content", catalog.documentDescription);

  const root = document.querySelector<HTMLElement>("#app");
  if (!root) throw new Error("Application root was not found.");

  const themedSelects = new ThemedSelectHost(document, window);
  const app = new AsterlynApp(root, catalog);
  let disposed = false;
  const runtime: ApplicationRuntime = {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("pagehide", runtime.dispose);
      themedSelects.dispose();
      app.dispose();
      if (activeRuntime === runtime) activeRuntime = null;
    },
  };
  activeRuntime = runtime;
  window.addEventListener("pagehide", runtime.dispose, { once: true });
  void app.start();
  return runtime;
}
