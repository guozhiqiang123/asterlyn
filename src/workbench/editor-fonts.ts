export const DEFAULT_EDITOR_FONT_ID = "jetbrains-mono" as const;

export const EDITOR_FONT_IDS = [
  DEFAULT_EDITOR_FONT_ID,
  "cascadia-code",
  "fira-code",
  "source-code-pro",
  "ibm-plex-mono",
] as const;

export type EditorFontId = (typeof EDITOR_FONT_IDS)[number];

interface DownloadableFontAsset {
  url: string;
  sha256: string;
  weight: string;
}

export interface EditorFontDefinition {
  id: EditorFontId;
  label: string;
  cssFamily: string;
  sourceVersion: string;
  license: "OFL-1.1";
  bundled: boolean;
  asset?: DownloadableFontAsset;
}

const FONT_CDN_ORIGIN = "https://cdn.jsdelivr.net";
const MAX_FONT_BYTES = 256 * 1024;
const CACHE_VERSION = 1;

export const EDITOR_FONTS: readonly EditorFontDefinition[] = [
  {
    id: DEFAULT_EDITOR_FONT_ID,
    label: "JetBrains Mono",
    cssFamily: "JetBrains Mono Variable",
    sourceVersion: "5.3.0",
    license: "OFL-1.1",
    bundled: true,
  },
  {
    id: "cascadia-code",
    label: "Cascadia Code",
    cssFamily: "Asterlyn Cascadia Code",
    sourceVersion: "5.3.0",
    license: "OFL-1.1",
    bundled: false,
    asset: {
      url: `${FONT_CDN_ORIGIN}/npm/@fontsource-variable/cascadia-code@5.3.0/files/cascadia-code-latin-wght-normal.woff2`,
      sha256: "a3018c0c6b4ed21b123349cc6c8d4d35d32cb11f91fe5e960aa4886eb27a9209",
      weight: "200 700",
    },
  },
  {
    id: "fira-code",
    label: "Fira Code",
    cssFamily: "Asterlyn Fira Code",
    sourceVersion: "5.3.0",
    license: "OFL-1.1",
    bundled: false,
    asset: {
      url: `${FONT_CDN_ORIGIN}/npm/@fontsource-variable/fira-code@5.3.0/files/fira-code-latin-wght-normal.woff2`,
      sha256: "771bf4b79a97fc005d12866168bd39d868a9dd3d5903008fe8b796723c8a56f4",
      weight: "300 700",
    },
  },
  {
    id: "source-code-pro",
    label: "Source Code Pro",
    cssFamily: "Asterlyn Source Code Pro",
    sourceVersion: "5.3.0",
    license: "OFL-1.1",
    bundled: false,
    asset: {
      url: `${FONT_CDN_ORIGIN}/npm/@fontsource-variable/source-code-pro@5.3.0/files/source-code-pro-latin-wght-normal.woff2`,
      sha256: "8b774aaa5137a38ef40f4ac9d36db9a5eee152b2f66589dfdc82ff007fc87135",
      weight: "200 900",
    },
  },
  {
    id: "ibm-plex-mono",
    label: "IBM Plex Mono",
    cssFamily: "Asterlyn IBM Plex Mono",
    sourceVersion: "5.3.0",
    license: "OFL-1.1",
    bundled: false,
    asset: {
      url: `${FONT_CDN_ORIGIN}/npm/@fontsource/ibm-plex-mono@5.3.0/files/ibm-plex-mono-latin-400-normal.woff2`,
      sha256: "08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7",
      weight: "400",
    },
  },
] as const;

interface FontCacheEnvelope {
  version: number;
  id: EditorFontId;
  sha256: string;
  data: string;
}

interface FontStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type EditorFontLoadSource =
  | "bundled"
  | "memory"
  | "cache"
  | "download"
  | "download-uncached";

export class EditorFontLoader {
  private readonly loading = new Map<EditorFontId, Promise<EditorFontLoadSource>>();
  private readonly loaded = new Set<EditorFontId>([DEFAULT_EDITOR_FONT_ID]);
  private readonly storage: FontStorage;

  constructor(storage: FontStorage) {
    this.storage = storage;
  }

  isLoaded(id: EditorFontId): boolean {
    return this.loaded.has(id);
  }

  async load(id: EditorFontId): Promise<EditorFontLoadSource> {
    if (id === DEFAULT_EDITOR_FONT_ID) {
      await document.fonts.load(`400 14px "${editorFont(id).cssFamily}"`);
      return "bundled";
    }
    if (this.loaded.has(id)) return "memory";

    const existing = this.loading.get(id);
    if (existing) return existing;

    const request = this.loadDownloadableFont(editorFont(id)).catch((error) => {
      this.loading.delete(id);
      throw error;
    });
    this.loading.set(id, request);
    return request;
  }

  private async loadDownloadableFont(
    definition: EditorFontDefinition,
  ): Promise<EditorFontLoadSource> {
    const asset = definition.asset;
    if (!asset) throw new Error(`${definition.label} has no downloadable font asset.`);

    const cached = await this.readCache(definition);
    const bytes = cached ?? (await downloadFontBytes(definition));
    const face = new FontFace(definition.cssFamily, bytes, {
      display: "swap",
      style: "normal",
      weight: asset.weight,
    });
    try {
      await face.load();
    } catch {
      throw new Error(`${definition.label} could not be loaded after verification.`);
    }
    document.fonts.add(face);
    this.loaded.add(definition.id);
    this.loading.delete(definition.id);

    if (cached) return "cache";
    return this.writeCache(definition, bytes) ? "download" : "download-uncached";
  }

  private async readCache(
    definition: EditorFontDefinition,
  ): Promise<ArrayBuffer | null> {
    const asset = definition.asset;
    if (!asset) return null;
    const key = fontCacheKey(definition);
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return null;
      const envelope = JSON.parse(raw) as FontCacheEnvelope;
      if (
        envelope.version !== CACHE_VERSION ||
        envelope.id !== definition.id ||
        envelope.sha256 !== asset.sha256 ||
        typeof envelope.data !== "string"
      ) {
        this.storage.removeItem(key);
        return null;
      }
      const bytes = decodeBase64(envelope.data);
      await verifyFontBytes(definition, bytes);
      return bytes;
    } catch {
      try {
        this.storage.removeItem(key);
      } catch {
        // An unavailable profile cache must not prevent a fresh bounded download.
      }
      return null;
    }
  }

  private writeCache(definition: EditorFontDefinition, bytes: ArrayBuffer): boolean {
    const asset = definition.asset;
    if (!asset) return false;
    const envelope: FontCacheEnvelope = {
      version: CACHE_VERSION,
      id: definition.id,
      sha256: asset.sha256,
      data: encodeBase64(bytes),
    };
    try {
      this.storage.setItem(fontCacheKey(definition), JSON.stringify(envelope));
      return true;
    } catch {
      // The loaded face remains usable for this window when profile storage is full.
      return false;
    }
  }
}

export function editorFont(id: EditorFontId): EditorFontDefinition {
  return EDITOR_FONTS.find((definition) => definition.id === id) ?? EDITOR_FONTS[0]!;
}

export function isEditorFontId(value: unknown): value is EditorFontId {
  return typeof value === "string" && EDITOR_FONT_IDS.includes(value as EditorFontId);
}

export function editorFontFamilyStack(id: EditorFontId): string {
  return `"${editorFont(id).cssFamily}", "Noto Sans Mono CJK SC", "Noto Sans Mono", monospace`;
}

export function editorFontOptionLabel(definition: EditorFontDefinition): string {
  return definition.bundled
    ? `${definition.label} · Bundled`
    : `${definition.label} · Download on first use`;
}

async function downloadFontBytes(
  definition: EditorFontDefinition,
): Promise<ArrayBuffer> {
  const asset = definition.asset;
  if (!asset) throw new Error(`${definition.label} has no downloadable font asset.`);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(asset.url, {
      cache: "no-cache",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${definition.label} download failed with HTTP ${response.status}.`);
    }
    const announcedLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(announcedLength) && announcedLength > MAX_FONT_BYTES) {
      throw new Error(`${definition.label} download exceeded the allowed size.`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FONT_BYTES) {
      throw new Error(`${definition.label} returned an invalid font file size.`);
    }
    await verifyFontBytes(definition, bytes);
    return bytes;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${definition.label} download timed out. Check the network and try again.`);
    }
    if (error instanceof TypeError) {
      throw new Error(`${definition.label} could not be downloaded. Check the network and try again.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function verifyFontBytes(
  definition: EditorFontDefinition,
  bytes: ArrayBuffer,
): Promise<void> {
  const asset = definition.asset;
  if (!asset) return;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== asset.sha256) {
    throw new Error(`${definition.label} failed integrity verification.`);
  }
}

function fontCacheKey(definition: EditorFontDefinition): string {
  return `asterlyn.editorFont.v1.${definition.id}.${definition.asset?.sha256 ?? "bundled"}`;
}

function encodeBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
