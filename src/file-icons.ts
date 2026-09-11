export type FileIconKind =
  | "archive"
  | "build"
  | "config"
  | "data"
  | "dart"
  | "docker"
  | "generic"
  | "git"
  | "go"
  | "groovy"
  | "image"
  | "java"
  | "javascript"
  | "kotlin"
  | "markup"
  | "markdown"
  | "native"
  | "python"
  | "rust"
  | "shell"
  | "styles"
  | "swift"
  | "text"
  | "typescript";

export interface FileIconDescriptor {
  kind: FileIconKind;
  label: string;
}

const namedFiles: Record<string, FileIconDescriptor> = {
  ".dockerignore": { kind: "docker", label: "D" },
  ".editorconfig": { kind: "config", label: "E" },
  ".env": { kind: "config", label: "E" },
  ".gitattributes": { kind: "git", label: "G" },
  ".gitignore": { kind: "git", label: "G" },
  "cmakelists.txt": { kind: "build", label: "C" },
  "cargo.lock": { kind: "rust", label: "RS" },
  "cargo.toml": { kind: "rust", label: "RS" },
  dockerfile: { kind: "docker", label: "D" },
  gemfile: { kind: "build", label: "RB" },
  gradlew: { kind: "build", label: "G" },
  "gradlew.bat": { kind: "build", label: "G" },
  jenkinsfile: { kind: "groovy", label: "GR" },
  makefile: { kind: "build", label: "M" },
  "package-lock.json": { kind: "javascript", label: "JS" },
  "package.json": { kind: "javascript", label: "JS" },
  "pom.xml": { kind: "build", label: "M" },
};

const extensionFiles: Record<string, FileIconDescriptor> = {
  bat: { kind: "shell", label: ">_" },
  bmp: { kind: "image", label: "" },
  bz2: { kind: "archive", label: "ZIP" },
  c: { kind: "native", label: "C" },
  cc: { kind: "native", label: "C+" },
  cjs: { kind: "javascript", label: "JS" },
  cpp: { kind: "native", label: "C+" },
  cs: { kind: "native", label: "C#" },
  css: { kind: "styles", label: "#" },
  csv: { kind: "data", label: "CSV" },
  cxx: { kind: "native", label: "C+" },
  dart: { kind: "dart", label: "DA" },
  gif: { kind: "image", label: "" },
  go: { kind: "go", label: "GO" },
  gradle: { kind: "groovy", label: "GR" },
  groovy: { kind: "groovy", label: "GR" },
  gz: { kind: "archive", label: "ZIP" },
  h: { kind: "native", label: "H" },
  hpp: { kind: "native", label: "H+" },
  htm: { kind: "markup", label: "<>" },
  html: { kind: "markup", label: "<>" },
  ico: { kind: "image", label: "" },
  java: { kind: "java", label: "J" },
  jpeg: { kind: "image", label: "" },
  jpg: { kind: "image", label: "" },
  js: { kind: "javascript", label: "JS" },
  json: { kind: "config", label: "{}" },
  json5: { kind: "config", label: "{}" },
  jsonc: { kind: "config", label: "{}" },
  jsx: { kind: "javascript", label: "JX" },
  kts: { kind: "kotlin", label: "KT" },
  kt: { kind: "kotlin", label: "KT" },
  less: { kind: "styles", label: "#" },
  lock: { kind: "config", label: "L" },
  log: { kind: "text", label: "TXT" },
  lua: { kind: "native", label: "LU" },
  md: { kind: "markdown", label: "MD" },
  mdx: { kind: "markdown", label: "MD" },
  mjs: { kind: "javascript", label: "JS" },
  png: { kind: "image", label: "" },
  properties: { kind: "config", label: "P" },
  ps1: { kind: "shell", label: ">_" },
  py: { kind: "python", label: "PY" },
  rb: { kind: "native", label: "RB" },
  rs: { kind: "rust", label: "RS" },
  sass: { kind: "styles", label: "#" },
  scss: { kind: "styles", label: "#" },
  sh: { kind: "shell", label: ">_" },
  sql: { kind: "data", label: "DB" },
  svg: { kind: "image", label: "" },
  swift: { kind: "swift", label: "SW" },
  tar: { kind: "archive", label: "ZIP" },
  toml: { kind: "config", label: "T" },
  ts: { kind: "typescript", label: "TS" },
  tsx: { kind: "typescript", label: "TX" },
  txt: { kind: "text", label: "TXT" },
  webp: { kind: "image", label: "" },
  xhtml: { kind: "markup", label: "<>" },
  xml: { kind: "markup", label: "<>" },
  yaml: { kind: "config", label: "Y" },
  yml: { kind: "config", label: "Y" },
  zip: { kind: "archive", label: "ZIP" },
  zsh: { kind: "shell", label: ">_" },
};

export function fileIconDescriptor(path: string): FileIconDescriptor {
  const name = basename(path).toLocaleLowerCase();
  const named = namedFiles[name];
  if (named) return named;
  const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return extensionFiles[extension] ?? { kind: "generic", label: "" };
}

export function fileTypeIcon(path: string): string {
  const descriptor = fileIconDescriptor(path);
  const mark =
    descriptor.kind === "image"
      ? '<path class="file-type-icon-mark" d="m4.5 11 2.2-2.5 1.6 1.7 1.4-1.4 1.8 2.2"/><circle class="file-type-icon-mark" cx="9.8" cy="6.1" r="1"/>'
      : descriptor.kind === "archive"
        ? '<path class="file-type-icon-mark" d="M7.1 4.3h2M7.1 6.2h2M7.1 8.1h2M7.1 10h2v2.2h-2Z"/>'
        : descriptor.label
          ? `<text class="file-type-icon-label" x="8" y="11.2">${descriptor.label}</text>`
          : '<path class="file-type-icon-mark" d="M5.2 7.2h5.6M5.2 9.3h5.6M5.2 11.4h3.8"/>';
  return `<svg class="file-type-icon file-icon-${descriptor.kind}" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path class="file-type-icon-sheet" d="M3 1.5h6.2L13 5.3v9.2H3Z"/><path class="file-type-icon-fold" d="M9.2 1.5v3.8H13"/>${mark}</svg>`;
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/$/u, "");
  return normalized.split("/").pop() ?? normalized;
}
