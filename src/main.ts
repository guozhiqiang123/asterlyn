import "@fontsource-variable/source-code-pro/wght.css";
import "@fontsource-variable/source-code-pro/wght-italic.css";
import "./styles.css";
import { AsterlynApp } from "./app";
import { BRAND } from "./brand";

document.title = BRAND.name;

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Application root was not found.");

const app = new AsterlynApp(root);
void app.start();
