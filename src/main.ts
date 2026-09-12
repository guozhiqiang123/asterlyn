import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "./styles.css";
import "./shared/layout.css";
import "./shared/controls.css";
import "./shared/presentation.css";
import "./shared/content.css";
import "./shared/overlays.css";
import "./shell/shell.css";
import "./features/settings/settings.css";
import "./features/changes-commit/changes-commit.css";
import "./features/files-editor/project-files.css";
import "./features/files-editor/files-editor.css";
import "./features/files-editor/workspace-search.css";
import "./features/git-history/git-history.css";
import "./features/git-history/history.css";
import "./features/git-history/branches.css";
import "./features/git-history/details.css";
import "./features/remote-push/remote-push.css";
import "./shared/responsive.css";
import { AsterlynApp } from "./app";
import { BRAND } from "./brand";

document.title = BRAND.name;

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root was not found.");

const app = new AsterlynApp(root);
void app.start();
