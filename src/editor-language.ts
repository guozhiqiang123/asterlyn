import {
  LanguageDescription,
  type LanguageSupport,
} from "@codemirror/language";

export type EditorLanguageStatus = "plain" | "ready" | "failed";

export interface EditorLanguageResult {
  name: string;
  status: EditorLanguageStatus;
  support: LanguageSupport | null;
}

export interface EditorLanguageCandidate {
  name: string;
  load(): Promise<LanguageSupport>;
}

export type EditorLanguageResolver = (
  path: string,
) => Promise<EditorLanguageCandidate | null>;

function basename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

export async function editorLanguageDescription(
  path: string,
): Promise<LanguageDescription | null> {
  const { languages } = await import("@codemirror/language-data");
  const filename = basename(path);
  const exact = LanguageDescription.matchFilename(languages, filename);
  if (exact) return exact;

  const extension = /\.([^.]+)$/.exec(filename);
  const suffix = extension?.[1];
  if (!extension || !suffix || suffix === suffix.toLowerCase()) return null;
  const normalized = `${filename.slice(0, extension.index + 1)}${suffix.toLowerCase()}`;
  return LanguageDescription.matchFilename(languages, normalized);
}

export async function editorLanguageDescriptionByName(
  name: string,
): Promise<LanguageDescription | null> {
  const normalized = name.trim().split(/\s/u, 1)[0]?.toLowerCase() ?? "";
  if (!normalized || !/^[a-z0-9_+.#-]{1,40}$/u.test(normalized)) return null;
  const { languages } = await import("@codemirror/language-data");
  return LanguageDescription.matchLanguageName(languages, normalized, false);
}

export async function editorLanguageName(path: string): Promise<string> {
  return (await editorLanguageDescription(path))?.name ?? "Plain Text";
}

/**
 * Ensures a parser that finishes loading for an old tab can never reconfigure
 * the editor that replaced it. Language package failures remain a readable
 * plain-text editor instead of becoming file-open failures.
 */
export class EditorLanguageLoader {
  private generation = 0;
  private readonly resolve: EditorLanguageResolver;

  constructor(resolve: EditorLanguageResolver = editorLanguageDescription) {
    this.resolve = resolve;
  }

  async load(path: string): Promise<EditorLanguageResult | null> {
    const generation = ++this.generation;
    let candidate: EditorLanguageCandidate | null;
    try {
      candidate = await this.resolve(path);
    } catch {
      return generation === this.generation
        ? { name: "Plain Text", status: "failed", support: null }
        : null;
    }
    if (generation !== this.generation) return null;
    if (!candidate) {
      return { name: "Plain Text", status: "plain", support: null };
    }

    try {
      const support = await candidate.load();
      return generation === this.generation
        ? { name: candidate.name, status: "ready", support }
        : null;
    } catch {
      return generation === this.generation
        ? { name: candidate.name, status: "failed", support: null }
        : null;
    }
  }

  cancel(): void {
    this.generation += 1;
  }
}
