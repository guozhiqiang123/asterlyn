export const MARKDOWN_PREVIEW_MAX_BYTES = 512 * 1024;

export interface MarkdownPreviewResult {
  status: "ready" | "too-large";
  html: string;
  byteLength: number;
}

interface MarkdownToken {
  content: string;
  attrGet(name: string): string | null;
}

interface MarkdownRenderer {
  rules: Record<
    string,
    ((tokens: MarkdownToken[], index: number) => string) | undefined
  >;
}

interface MarkdownParser {
  renderer: MarkdownRenderer;
  render(source: string): string;
}

type MarkdownParserConstructor = new (options: {
  html: boolean;
  linkify: boolean;
  typographer: boolean;
}) => MarkdownParser;

let parserPromise: Promise<MarkdownParser> | null = null;

export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mkd)$/iu.test(path);
}

export async function renderMarkdownPreview(
  source: string,
): Promise<MarkdownPreviewResult> {
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (byteLength > MARKDOWN_PREVIEW_MAX_BYTES) {
    return { status: "too-large", html: "", byteLength };
  }
  const parser = await markdownParser();
  return { status: "ready", html: parser.render(source), byteLength };
}

async function markdownParser(): Promise<MarkdownParser> {
  parserPromise ??= import("markdown-it").then((module) => {
    const MarkdownIt = module.default as unknown as MarkdownParserConstructor;
    const parser = new MarkdownIt({
      html: false,
      linkify: false,
      typographer: false,
    });
    parser.renderer.rules.image = (tokens, index) => {
      const label = tokens[index]?.content.trim() || "image";
      return `<span class="markdown-image-placeholder" role="img" aria-label="Image preview blocked">[Image: ${escapeHtml(label)}]</span>`;
    };
    parser.renderer.rules.link_open = (tokens, index) => {
      const href = tokens[index]?.attrGet("href") ?? "";
      return `<span class="markdown-link" title="Link opening is not available in preview" data-markdown-href="${escapeAttribute(href)}">`;
    };
    parser.renderer.rules.link_close = () => "</span>";
    return parser;
  });
  return parserPromise;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>]/gu,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!,
  );
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/gu, "&quot;");
}
